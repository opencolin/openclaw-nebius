const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const crypto = require('crypto');
const { execSync, exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const IS_VERCEL = !!process.env.VERCEL;

// Trust reverse proxy (nginx) for X-Forwarded-* headers
app.set('trust proxy', true);

// ── Input validation ──────────────────────────────────────────────────────
function validateId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error('Invalid ID format');
  }
  return value;
}

function validateIp(value) {
  if (typeof value !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) {
    throw new Error('Invalid IP format');
  }
  return value;
}

// ── Session ───────────────────────────────────────────────────────────────
// Set SESSION_SECRET env var for persistent sessions across restarts
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure sessions directory exists for file-based persistence
const sessionsDir = path.join(__dirname, 'data', 'sessions');
if (!IS_VERCEL && !fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

const sessionMiddleware = session({
  store: IS_VERCEL ? undefined : new FileStore({
    path: sessionsDir,
    ttl: 86400,
    retries: 0,
    logFn: () => {}
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

// ── OAuth2 PKCE + Constants ──────────────────────────────────────────────
const NEBIUS_AUTH_URL = 'https://auth.nebius.com/oauth2/authorize';
const NEBIUS_TOKEN_URL = 'https://auth.nebius.com/oauth2/token';
const NEBIUS_CLIENT_ID = process.env.NEBIUS_CLIENT_ID || 'nebius-cli';
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'https://claw.moi/api/auth/callback';

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ── Admin / Event Logger ────────────────────────────────────────────────────
// Must be defined before loadNebiusConfig() is called at module load time.
const ADMIN_PASSWORD    = process.env.ADMIN_PASSWORD || null;
const ADMIN_ENABLED     = !IS_VERCEL && !!ADMIN_PASSWORD;
const EVENT_BUFFER_SIZE = 2000;
const eventBuffer       = [];
let   eventIdCounter    = 0;
const adminSseClients   = new Set();

const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'token', 'password', 'secret',
  'TOKEN_FACTORY_API_KEY', 'OPENCLAW_WEB_PASSWORD',
  'OPENROUTER_API_KEY', 'HUGGINGFACE_API_KEY', 'HF_TOKEN',
  'webPassword', 'gatewayToken', 'authToken',
]);

function sanitizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const out = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > 80 && /key|token|secret|password/i.test(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeContext(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emitEvent(level, category, message, context) {
  const record = {
    id: ++eventIdCounter,
    timestamp: new Date().toISOString(),
    level, category, message,
    context: sanitizeContext(context) || null,
  };
  if (eventBuffer.length >= EVENT_BUFFER_SIZE) eventBuffer.shift();
  eventBuffer.push(record);
  if (level === 'error') trackError();
  const pfx = `[${category}]`;
  if (level === 'error')     console.error(pfx, message, record.context || '');
  else if (level === 'warn') console.warn(pfx, message, record.context || '');
  else                       console.log(pfx, message, record.context || '');
  if (adminSseClients.size > 0) {
    const payload = `data: ${JSON.stringify(record)}\n\n`;
    for (const client of adminSseClients) {
      try { client.write(payload); } catch (_) { adminSseClients.delete(client); }
    }
  }
}

const eventLog = {
  debug: (cat, msg, ctx) => emitEvent('debug', cat, msg, ctx),
  info:  (cat, msg, ctx) => emitEvent('info',  cat, msg, ctx),
  warn:  (cat, msg, ctx) => emitEvent('warn',  cat, msg, ctx),
  error: (cat, msg, ctx) => emitEvent('error', cat, msg, ctx),
};

// ── Analytics ────────────────────────────────────────────────────────────────
const ANALYTICS_FILE = path.join(__dirname, 'data', 'analytics.json');
const ANALYTICS_RETENTION_DAYS = 90;
const analytics = { days: {} };

function analyticsToday() { return new Date().toISOString().slice(0, 10); }

function dayBucket(date) {
  if (!analytics.days[date]) {
    analytics.days[date] = {
      visitors: [], _vSet: new Set(),
      pageViews: 0, logins: 0, loginFails: 0, deploys: 0, errors: 0,
      deploysByAgent: {}, deploysByRegion: {}, deploysByPlatform: {},
      pages: {}, browsers: {},
    };
  }
  return analytics.days[date];
}

function hashVisitor(ip) {
  return crypto.createHash('sha256')
    .update(`${ip}:${analyticsToday()}:${SESSION_SECRET}`)
    .digest('hex').slice(0, 12);
}

function parseBrowser(ua) {
  if (!ua) return 'other';
  if (/Edg\//.test(ua))   return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua))  return 'safari';
  return 'other';
}

function trackPageView(req) {
  const day = dayBucket(analyticsToday());
  const hash = hashVisitor(req.ip || req.connection?.remoteAddress || '?');
  day.pageViews++;
  if (!day._vSet.has(hash)) { day._vSet.add(hash); day.visitors.push(hash); }
  const pg = req.path.replace(/\?.*/,'');
  day.pages[pg] = (day.pages[pg] || 0) + 1;
  day.browsers[parseBrowser(req.headers['user-agent'])] =
    (day.browsers[parseBrowser(req.headers['user-agent'])] || 0) + 1;
}

function trackLogin(ok)  { const d = dayBucket(analyticsToday()); ok ? d.logins++ : d.loginFails++; }
function trackError()    { dayBucket(analyticsToday()).errors++; }
function trackDeploy(imageType, region, platform) {
  const d = dayBucket(analyticsToday());
  d.deploys++;
  d.deploysByAgent[imageType]  = (d.deploysByAgent[imageType]  || 0) + 1;
  d.deploysByRegion[region]    = (d.deploysByRegion[region]    || 0) + 1;
  d.deploysByPlatform[platform]= (d.deploysByPlatform[platform]|| 0) + 1;
}

function loadAnalytics() {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8'));
      analytics.days = data.days || {};
      for (const day of Object.values(analytics.days)) {
        day._vSet = new Set(day.visitors || []);
      }
      eventLog.info('SYSTEM', 'Analytics loaded', { days: Object.keys(analytics.days).length });
    }
  } catch (e) {
    eventLog.warn('SYSTEM', 'Failed to load analytics', { error: e.message });
  }
}

function saveAnalytics() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ANALYTICS_RETENTION_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const date of Object.keys(analytics.days)) {
      if (date < cutoffStr) delete analytics.days[date];
    }
    const out = { days: {} };
    for (const [date, day] of Object.entries(analytics.days)) {
      const { _vSet, ...rest } = day;
      out.days[date] = rest;
    }
    fs.mkdirSync(path.dirname(ANALYTICS_FILE), { recursive: true });
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(out));
  } catch (e) {
    eventLog.warn('SYSTEM', 'Failed to save analytics', { error: e.message });
  }
}

if (!IS_VERCEL) {
  loadAnalytics();
  setInterval(saveAnalytics, 60000);
}

// ── Per-request API logging (debug level, skipped on Vercel) ───────────────
if (!IS_VERCEL) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/admin/api/stream')) return next(); // SSE — too noisy
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/admin/')) return next();
    const start = Date.now();
    res.on('finish', () => {
      emitEvent('debug', 'API', `${req.method} ${req.path}`, {
        status: res.statusCode,
        duration: Date.now() - start,
        session: req.session?.authenticated ? 'auth' : 'anon',
      });
    });
    next();
  });

  // Analytics: track page views (skip static assets and admin SSE)
  app.use((req, res, next) => {
    if (/\.(js|css|ico|png|svg|woff2?|map|json)$/i.test(req.path) ||
        req.path === '/health' ||
        req.path.startsWith('/admin/api/')) return next();
    trackPageView(req);
    next();
  });
}

// ── Auto-detect Nebius config from CLI ────────────────────────────────────
const REGION_META = {
  'eu-north1':   { name: 'EU North (Finland)', flag: '🇫🇮', registry: 'cr.eu-north1.nebius.cloud',   cpuPlatform: 'cpu-e2' },
  'eu-west1':    { name: 'EU West (Paris)',     flag: '🇫🇷', registry: 'cr.eu-west1.nebius.cloud',    cpuPlatform: 'cpu-d3' },
  'us-central1': { name: 'US Central',          flag: '🇺🇸', registry: 'cr.us-central1.nebius.cloud', cpuPlatform: 'cpu-e2' }
};

function loadNebiusConfig() {
  const configPath = process.env.NEBIUS_CONFIG_PATH || path.join(process.env.HOME, '.nebius', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    eventLog.warn('SYSTEM', 'No Nebius CLI config found', { configPath, hint: 'Run: nebius iam login' });
    return { regions: {}, profiles: {}, tenantId: null };
  }

  try {
    const config = yaml.load(fs.readFileSync(configPath, 'utf-8'));
    const regions = {};
    const profiles = {};
    let tenantId = null;

    // Track seen project IDs to avoid duplicate regions
    const seenProjects = new Set();

    for (const [profileName, profile] of Object.entries(config.profiles || {})) {
      const parentId = profile['parent-id'] || '';

      // Skip profiles without a valid project ID
      if (!parentId.startsWith('project-')) continue;

      // Deduplicate — skip if we already have a region for this project
      if (seenProjects.has(parentId)) continue;
      seenProjects.add(parentId);

      // Match profile to a known region by name or by trying the nebius CLI
      let regionKey = Object.keys(REGION_META).find(r =>
        profileName === r || profileName.includes(r)
      );

      // If no region match, try to detect region from the project
      if (!regionKey) {
        try {
          const projInfo = JSON.parse(
            execSync(`nebius --profile ${profileName} iam project get --id ${parentId} --format json`, { encoding: 'utf-8', timeout: 10000 })
          );
          const detectedRegion = projInfo.status?.region || projInfo.spec?.region;
          if (detectedRegion && REGION_META[detectedRegion]) {
            regionKey = detectedRegion;
          }
        } catch (e) {
          // Fall back to profile name
        }
      }

      regionKey = regionKey || profileName;

      const meta = REGION_META[regionKey] || {
        name: regionKey,
        flag: '🌐',
        registry: `cr.${regionKey}.nebius.cloud`,
        cpuPlatform: 'cpu-e2'
      };

      regions[regionKey] = {
        ...meta,
        projectId: parentId
      };
      profiles[regionKey] = profileName;

      if (!tenantId && profile['tenant-id']) {
        tenantId = profile['tenant-id'];
      }
    }

    eventLog.info('SYSTEM', 'Nebius config loaded', { regionCount: Object.keys(regions).length, configPath });
    return { regions, profiles, tenantId };
  } catch (err) {
    eventLog.error('SYSTEM', 'Failed to parse Nebius config', { error: err.message });
    return { regions: {}, profiles: {}, tenantId: null };
  }
}

const nebiusConfig = IS_VERCEL ? { regions: {}, profiles: {}, tenantId: null } : loadNebiusConfig();
const REGIONS = nebiusConfig.regions;
const REGION_PROFILES = nebiusConfig.profiles;
const TENANT_ID = nebiusConfig.tenantId;

// ── Demo mode (Vercel) ──────────────────────────────────────────────────
// Regions with their own Token Factory endpoint; all others use the global URL
const TF_REGIONAL_ENDPOINTS = new Set(['us-central1']);
function tokenFactoryUrl(region) {
  if (region && TF_REGIONAL_ENDPOINTS.has(region)) {
    return `https://api.tokenfactory.${region}.nebius.com/v1`;
  }
  return 'https://api.tokenfactory.nebius.com/v1';
}

const DEMO_REGIONS = {
  'eu-north1':   { name: 'EU North (Finland)', flag: '🇫🇮', registry: 'cr.eu-north1.nebius.cloud',   cpuPlatform: 'cpu-e2' },
  'eu-west1':    { name: 'EU West (Paris)',     flag: '🇫🇷', registry: 'cr.eu-west1.nebius.cloud',    cpuPlatform: 'cpu-d3' },
  'us-central1': { name: 'US Central',          flag: '🇺🇸', registry: 'cr.us-central1.nebius.cloud', cpuPlatform: 'cpu-e2' }
};

const DEMO_MODELS = [
  { id: 'deepseek-ai/DeepSeek-R1-0528', owned_by: 'deepseek-ai' },
  { id: 'zai-org/GLM-5', owned_by: 'zai-org' },
  { id: 'MiniMaxAI/MiniMax-M2.5', owned_by: 'MiniMaxAI' },
  { id: 'Qwen/Qwen3-235B-A22B', owned_by: 'Qwen' },
  { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct', owned_by: 'meta-llama' },
  { id: 'google/gemma-3-27b-it', owned_by: 'google' },
  { id: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506', owned_by: 'mistralai' }
];

const DEMO_ENDPOINTS = [
  {
    id: 'demo-ep-1', name: 'openclaw-eu-north1-demo', state: 'RUNNING',
    publicIp: '203.0.113.10', image: 'cr.eu-north1.nebius.cloud/demo/openclaw-serverless:latest',
    platform: 'cpu-e2', region: 'eu-north1', regionName: 'EU North (Finland)', regionFlag: '🇫🇮',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    health: { status: 'healthy', service: 'openclaw-serverless', model: 'zai-org/GLM-5', inference: 'token-factory', gateway_port: 18789 },
    dashboardToken: null
  },
  {
    id: 'demo-ep-2', name: 'nemoclaw-us-central1-demo', state: 'DEPLOYING',
    publicIp: null, image: 'cr.us-central1.nebius.cloud/demo/nemoclaw-serverless:latest',
    platform: 'cpu-e2', region: 'us-central1', regionName: 'US Central', regionFlag: '🇺🇸',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    health: null, dashboardToken: null
  }
];

// ── Image config ──────────────────────────────────────────────────────────
// Public GHCR images (fallback if user's registry doesn't have the image)
const GHCR_IMAGES = {
  openclaw: 'ghcr.io/colygon/openclaw-serverless:latest',
  nemoclaw: 'ghcr.io/colygon/nemoclaw-serverless:latest'
};

const IMAGES = {
  'openclaw': {
    name: 'OpenClaw',
    description: 'Lightweight AI agent — OpenClaw only',
    icon: '🦞',
    getImage: (registryId, region) =>
      registryId
        ? `cr.${region}.nebius.cloud/${registryId}/openclaw-serverless:latest`
        : GHCR_IMAGES.openclaw
  },
  'nemoclaw': {
    name: 'NemoClaw',
    description: 'Full agent — OpenClaw + NVIDIA NemoClaw plugin',
    icon: '🔱',
    getImage: (registryId, region) =>
      registryId
        ? `cr.${region}.nebius.cloud/${registryId}/nemoclaw-serverless:latest`
        : GHCR_IMAGES.nemoclaw
  },
  'custom': {
    name: 'Custom Image',
    description: 'Provide your own Docker image URL',
    icon: '🐳',
    getImage: (registryId, region, customUrl) => customUrl
  }
};

// ── Auth middleware ─────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ── SSH key finder ─────────────────────────────────────────────────────────
// ── Crustacean name generator ─────────────────────────────────────────────
const CRUSTACEAN_ADJECTIVES = [
  'swift', 'brave', 'calm', 'bold', 'keen', 'warm', 'cool', 'wild',
  'wise', 'kind', 'fair', 'deep', 'glad', 'cozy', 'lazy', 'fuzzy',
  'tiny', 'snug', 'zany', 'rosy', 'plucky', 'peppy', 'jolly', 'lucky',
  'sunny', 'misty', 'frosty', 'sandy', 'coral', 'golden', 'silver', 'crimson'
];
const CRUSTACEAN_NAMES = [
  'crab', 'lobster', 'shrimp', 'prawn', 'crayfish', 'krill', 'barnacle',
  'hermit', 'mantis', 'fiddler', 'horseshoe', 'coconut', 'spider-crab',
  'yeti-crab', 'king-crab', 'snow-crab', 'blue-crab', 'mud-crab',
  'dungeness', 'langoustine', 'crawdad', 'pistol-shrimp', 'cleaner-shrimp',
  'rock-lobster', 'squat-lobster', 'slipper-lobster', 'reef-crab', 'pea-crab',
  'porcelain-crab', 'velvet-crab', 'stone-crab', 'ghost-shrimp'
];

function generateCrustaceanName() {
  const adj = CRUSTACEAN_ADJECTIVES[Math.floor(Math.random() * CRUSTACEAN_ADJECTIVES.length)];
  const name = CRUSTACEAN_NAMES[Math.floor(Math.random() * CRUSTACEAN_NAMES.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${name}-${num}`;
}

// ── SSH key finder ─────────────────────────────────────────────────────────
function findSshKey() {
  const customPath = process.env.SSH_KEY_PATH;
  if (customPath && fs.existsSync(customPath)) return customPath;

  const candidates = [
    path.join(process.env.HOME, '.ssh', 'id_ed25519'),
    path.join(process.env.HOME, '.ssh', 'id_ed25519_vm'),
    path.join(process.env.HOME, '.ssh', 'id_rsa')
  ];
  return candidates.find(k => fs.existsSync(k)) || candidates[1];
}

// ── Nebius CLI helper ──────────────────────────────────────────────────────
// iamToken: when provided, injects NEBIUS_IAM_TOKEN env var (per-user auth).
//           when null/undefined, uses service account from CLI profile.
function nebius(cmd, profile, iamToken) {
  if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error('Invalid profile name');
  }
  const profileFlag = profile ? `--profile ${profile}` : '';

  // Sanitize command for logging — redact --env "KEY=VALUE" pairs
  const safeCmd = cmd.replace(
    /--env\s+"([^"]*(?:KEY|TOKEN|PASSWORD|SECRET)[^"=]*)=[^"]+"/gi,
    (_, name) => `--env "${name}=[REDACTED]"`
  );
  const cmdLabel = safeCmd.split(' ').slice(0, 4).join(' ');

  const start = Date.now();
  const execEnv = { ...process.env, PATH: process.env.PATH };
  if (iamToken) execEnv.NEBIUS_IAM_TOKEN = iamToken;

  try {
    const result = execSync(`nebius ${profileFlag} ${cmd}`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: execEnv
    });
    emitEvent('debug', 'NEBIUS', cmdLabel, { duration: Date.now() - start, profile: profile || null });
    return result.trim();
  } catch (err) {
    const fullStderr = err.stderr || err.message;
    emitEvent('error', 'NEBIUS', `CLI error: ${cmdLabel}`, {
      duration: Date.now() - start,
      profile: profile || null,
      error: fullStderr,
    });
    throw new Error(fullStderr);
  }
}

function nebiusJson(cmd, profile, iamToken) {
  const raw = nebius(`${cmd} --format json`, profile, iamToken);
  return JSON.parse(raw);
}

// Build env object for exec/spawn calls that invoke nebius CLI directly
function nebiusExecEnv(iamToken) {
  const env = { ...process.env, PATH: process.env.PATH };
  if (iamToken) env.NEBIUS_IAM_TOKEN = iamToken;
  return env;
}

// Extract user's Nebius IAM token from session (null = use service account)
function getUserToken(req) {
  return req.session?.nebiusToken || null;
}

// ── Deploy-time secrets (password stored per endpoint name) ────────────────
const MAX_PASSWORDS = 200;
const PASSWORDS_FILE = path.join(__dirname, '..', 'endpoint-passwords.json');
const endpointPasswords = {}; // { endpointName: password }

// Load saved passwords from disk on startup
try {
  if (fs.existsSync(PASSWORDS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PASSWORDS_FILE, 'utf-8'));
    Object.assign(endpointPasswords, saved);
    eventLog.info('SYSTEM', 'Endpoint passwords loaded', { count: Object.keys(saved).length });
  }
} catch (e) {
  eventLog.error('SYSTEM', 'Failed to load endpoint passwords', { error: e.message });
}

function storePassword(name, password) {
  const keys = Object.keys(endpointPasswords);
  if (keys.length >= MAX_PASSWORDS) {
    delete endpointPasswords[keys[0]]; // evict oldest
  }
  endpointPasswords[name] = password;
  // Persist to disk
  try { fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(endpointPasswords, null, 2)); } catch (e) { /* ignore */ }
}

// ── Routes: Auth (OAuth2 PKCE) ────────────────────────────────────────────

// Check authentication status from session
app.get('/api/auth/status', (req, res) => {
  if (IS_VERCEL) {
    req.session.authenticated = true;
    return res.json({ authenticated: true, user: 'Demo User', demo: true });
  }

  if (req.session.authenticated) {
    // Check if token has expired (non-demo only)
    if (req.session.tokenExpiresAt && Date.now() > req.session.tokenExpiresAt) {
      req.session.destroy();
      return res.json({ authenticated: false, expired: true });
    }

    const result = {
      authenticated: true,
      user: req.session.user || 'Nebius User',
      demo: req.session.isDemo || false
    };

    if (req.session.tokenExpiresAt) {
      result.tokenExpiresAt = req.session.tokenExpiresAt;
      result.tokenExpiresIn = Math.max(0, Math.floor((req.session.tokenExpiresAt - Date.now()) / 1000));
    }

    return res.json(result);
  }

  res.json({ authenticated: false });
});

// Token-paste login — user runs `nebius iam get-access-token` locally and pastes it
app.post('/api/auth/token', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string' || token.trim().length < 10) {
    return res.status(400).json({ error: 'A valid access token is required' });
  }

  const trimmedToken = token.trim();

  try {
    // Verify the token by running whoami
    const whoami = execSync('nebius iam whoami --format json', {
      encoding: 'utf-8',
      timeout: 10000,
      env: nebiusExecEnv(trimmedToken)
    }).trim();
    const identity = JSON.parse(whoami);
    const attrs = identity.user_profile?.attributes || {};
    const user = attrs.name || attrs.given_name || attrs.email || identity.user_profile?.id || 'Nebius User';

    // Store token in session (~12h lifetime, no refresh tokens)
    req.session.nebiusToken = trimmedToken;
    req.session.tokenExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
    req.session.authenticated = true;
    req.session.isDemo = false;
    req.session.user = user;

    eventLog.info('AUTH', 'User logged in via token paste', { user });
    trackLogin(true);

    res.json({ authenticated: true, user });
  } catch (err) {
    eventLog.error('AUTH', 'Token verification failed', { error: err.message });
    trackLogin(false);
    res.status(401).json({
      error: 'Invalid token. Run "nebius iam login" first, then "nebius iam get-access-token".'
    });
  }
});

// Demo mode — use service account (no user token)
app.get('/demo', (req, res) => {
  req.session.authenticated = true;
  req.session.isDemo = true;
  req.session.nebiusToken = null;
  req.session.user = 'Demo User';
  req.session.tokenExpiresAt = null;
  eventLog.info('AUTH', 'Demo mode session started');
  trackLogin(true);
  res.redirect('/');
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// ── Token expiry middleware ───────────────────────────────────────────────
// Check user token hasn't expired before processing API requests
app.use('/api', (req, res, next) => {
  // Skip auth-related routes
  if (req.path.startsWith('/auth/')) return next();
  // Skip if not authenticated or demo mode (demo uses service account)
  if (!req.session?.authenticated || req.session.isDemo) return next();
  // Check token expiry
  if (req.session.tokenExpiresAt && Date.now() > req.session.tokenExpiresAt) {
    req.session.destroy();
    return res.status(401).json({ error: 'Session expired. Please log in again.', expired: true });
  }
  next();
});

// ── Routes: MysteryBox Secrets ─────────────────────────────────────────────

app.get('/api/secrets', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json([{ id: 'demo-secret', name: 'token-factory-key', description: 'Demo API key', state: 'ACTIVE' }]);

  try {
    const token = getUserToken(req);
    const data = nebiusJson('mysterybox secret list', null, token);
    const secrets = (data.items || []).map(s => ({
      id: s.metadata.id,
      name: s.metadata.name,
      description: s.spec?.description || '',
      state: s.status?.state || 'UNKNOWN'
    }));
    res.json(secrets);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/secrets/:id/payload', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json({ TOKEN_FACTORY_API_KEY: 'demo-key-not-real' });

  try {
    const id = validateId(req.params.id);
    const token = getUserToken(req);
    const data = nebiusJson(`mysterybox payload get --secret-id ${id}`, null, token);
    // Return all key-value pairs from the secret
    const payload = {};
    for (const entry of (data.data || [])) {
      payload[entry.key] = entry.string_value || entry.binary_value || '';
    }
    res.json(payload);
  } catch (err) {
    const isPermDenied = err.message.includes('PermissionDenied') || err.message.includes('Permission denied');
    if (isPermDenied) {
      eventLog.error('MYSTERYBOX', 'Secret payload access denied', { secretId: req.params.id });
      return res.status(403).json({
        error: 'Permission denied: the service account cannot read secret payloads. Run: nebius iam access-permit create --parent-id serviceaccount-e00e26wydmhyd6qdsn --resource-id project-e00r2jeapr00j2q7e7n3yn --role viewer'
      });
    }
    res.status(500).json({ error: `Failed to retrieve secret: ${err.message.split('\n')[0]}` });
  }
});

// Create a new secret in MysteryBox
app.post('/api/secrets', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json({ id: 'demo-new-secret', name: req.body.name });

  const { name, key, value } = req.body;
  if (!name || !key || !value) {
    return res.status(400).json({ error: 'name, key, and value are required' });
  }

  // Sanitize name (alphanumeric, hyphens, underscores only)
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 64);

  // Find a project ID to use as parent
  const projectId = Object.values(REGIONS)[0]?.projectId;
  if (!projectId) {
    return res.status(500).json({ error: 'No project configured. Check Nebius CLI setup.' });
  }

  const token = getUserToken(req);

  try {
    const payloadJson = JSON.stringify([{ key, string_value: value }]);
    const result = nebius(
      `mysterybox secret create --name "${safeName}" --parent-id ${projectId} --secret-version-payload '${payloadJson}' --format json`,
      null, token
    );
    const parsed = JSON.parse(result);
    res.json({
      id: parsed.metadata?.id || 'unknown',
      name: safeName,
      message: 'Secret created'
    });
  } catch (err) {
    // If secret already exists, try to update it instead
    if (err.message.includes('AlreadyExists')) {
      try {
        // Find the existing secret ID
        const existing = nebiusJson('mysterybox secret list', null, token);
        const found = (existing.items || []).find(s => s.metadata?.name === safeName);
        if (found) {
          const payloadJson = JSON.stringify([{ key, string_value: value }]);
          nebius(`mysterybox secret-version create --parent-id ${found.metadata.id} --payload '${payloadJson}' --set-primary --format json`, null, token);
          return res.json({ id: found.metadata.id, name: safeName, message: 'Secret updated (new version)' });
        }
      } catch (updateErr) {
        return res.status(500).json({ error: `Failed to update existing secret: ${updateErr.message.split('\n')[0]}` });
      }
    }
    res.status(500).json({ error: `Failed to create secret: ${err.message.split('\n')[0]}` });
  }
});

// Update an existing secret's payload (creates new version)
app.put('/api/secrets/:id', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json({ message: 'Secret updated (demo)' });

  const { key, value } = req.body;
  if (!key || !value) {
    return res.status(400).json({ error: 'key and value are required' });
  }

  try {
    const id = validateId(req.params.id);
    const token = getUserToken(req);
    const payloadJson = JSON.stringify([{ key, string_value: value }]);
    nebius(`mysterybox secret-version create --parent-id ${id} --payload '${payloadJson}' --set-primary --format json`, null, token);
    res.json({ message: 'Secret updated' });
  } catch (err) {
    res.status(500).json({ error: `Failed to update secret: ${err.message.split('\n')[0]}` });
  }
});

// ── Routes: Config ─────────────────────────────────────────────────────────

app.get('/api/regions', (req, res) => {
  res.json(IS_VERCEL ? DEMO_REGIONS : REGIONS);
});

app.get('/api/images', (req, res) => {
  res.json(Object.fromEntries(
    Object.entries(IMAGES).map(([k, v]) => [k, {
      name: v.name,
      description: v.description,
      icon: v.icon,
      sourceUrl: GHCR_IMAGES[k] || null,
      github: k === 'openclaw' ? 'https://github.com/AiChatBot/OpenClaw'
            : k === 'nemoclaw' ? 'https://github.com/NVIDIA/NemoClaw'
            : null
    }])
  ));
});

// ── Routes: Docker Registry ──────────────────────────────────────────────

app.get('/api/registries', requireAuth, async (req, res) => {
  if (IS_VERCEL) {
    return res.json([{
      id: 'registry-demo', name: 'openclaw', region: 'eu-north1',
      regionName: 'EU North (Finland)', regionFlag: '🇫🇮',
      registryUrl: 'cr.eu-north1.nebius.cloud', imagesCount: 2,
      createdAt: new Date().toISOString()
    }]);
  }

  const results = [];
  const regionEntries = Object.entries(REGIONS);
  const token = getUserToken(req);

  await Promise.all(regionEntries.map(async ([regionKey, regionConfig]) => {
    try {
      const data = nebiusJson('registry list', regionConfig.profile, token);
      for (const reg of (data.items || [])) {
        results.push({
          id: reg.metadata.id,
          name: reg.metadata.name || 'unnamed',
          region: regionKey,
          regionName: regionConfig.name,
          regionFlag: regionConfig.flag,
          registryUrl: `cr.${regionKey}.nebius.cloud`,
          imagesCount: reg.spec?.images_count || 0,
          createdAt: reg.metadata.created_at || ''
        });
      }
    } catch (e) {
      // Skip regions that fail
    }
  }));

  res.json(results);
});

app.get('/api/registries/:id/images', requireAuth, (req, res) => {
  if (IS_VERCEL) {
    return res.json([
      { name: 'openclaw-serverless', tags: ['latest'], size: '450 MB', createdAt: new Date().toISOString() },
      { name: 'nemoclaw-serverless', tags: ['latest'], size: '620 MB', createdAt: new Date().toISOString() }
    ]);
  }

  try {
    const id = validateId(req.params.id);
    const profile = req.query.profile || undefined;
    const token = getUserToken(req);
    const data = nebiusJson(`registry image list --parent-id ${id}`, profile, token);
    const images = (data.items || []).map(img => {
      const fullName = img.name || img.metadata?.name || '';
      // Image name format: "registryId/imageName" — extract just the image name
      const shortName = fullName.includes('/') ? fullName.split('/').slice(1).join('/') : fullName;
      return {
        id: img.metadata?.id || img.id || '',
        name: shortName || 'unknown',
        tags: img.tags || [],
        size: img.size ? `${(img.size / (1024 * 1024)).toFixed(0)} MB` : 'unknown',
        createdAt: img.metadata?.created_at || img.created_at || ''
      };
    });
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: `Failed to list images: ${err.message.split('\n')[0]}` });
  }
});

// Docker image build tracking
const builds = new Map();

app.post('/api/build', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json({ buildId: 'demo-build', status: 'running' });

  const { imageType, region, githubUrl } = req.body;
  if (!imageType || !region) {
    return res.status(400).json({ error: 'imageType and region are required' });
  }

  if (imageType === 'custom' && !githubUrl) {
    return res.status(400).json({ error: 'githubUrl is required for custom builds' });
  }

  // Validate GitHub URL for custom builds
  if (imageType === 'custom') {
    try {
      const parsed = new URL(githubUrl);
      if (parsed.hostname !== 'github.com') {
        return res.status(400).json({ error: 'Only GitHub repository URLs are supported' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
  }

  const regionConfig = REGIONS[region];
  if (!regionConfig) {
    return res.status(400).json({ error: `Unknown region: ${region}` });
  }

  // Find registry
  let registryId;
  try {
    const registries = nebiusJson('registry list', regionConfig.profile);
    registryId = registries.items?.[0]?.metadata?.id;
    if (registryId) registryId = registryId.replace(/^registry-/, '');
  } catch (e) {}

  if (!registryId) {
    return res.status(400).json({ error: `No container registry found in ${region}. Create one first.` });
  }

  const buildId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let imageName, buildCmd, env;

  if (imageType === 'custom') {
    // Extract repo name from URL for image name
    const repoPath = new URL(githubUrl).pathname.replace(/^\//, '').replace(/\.git$/, '');
    imageName = repoPath.split('/').pop() || 'custom-image';
    // Sanitize image name for Docker
    imageName = imageName.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const imageUrl = `cr.${region}.nebius.cloud/${registryId}/${imageName}:latest`;

    builds.set(buildId, { status: 'running', log: '', image: imageUrl, startedAt: Date.now() });

    const tmpDir = `/tmp/custom-build-${buildId}`;
    // Clone repo, find Dockerfile, build and push
    buildCmd = `set -e
echo "=== Cloning ${githubUrl} ==="
git clone --depth 1 "${githubUrl}" "${tmpDir}" 2>&1
cd "${tmpDir}"
if [ ! -f Dockerfile ]; then
  echo "ERROR: No Dockerfile found in repository root"
  ls -la
  exit 1
fi
echo "=== Found Dockerfile ==="
echo "=== Authenticating with registry ==="
nebius container registry configure-docker --profile ${regionConfig.profile} 2>&1 || true
echo "=== Building Docker image ==="
docker build -t "${imageUrl}" . 2>&1
echo "=== Pushing image to registry ==="
docker push "${imageUrl}" 2>&1
echo "=== Cleaning up ==="
rm -rf "${tmpDir}"
echo "=== Done ==="`;

    env = { ...process.env };
    res.json({ buildId, status: 'running', image: imageUrl });
  } else {
    imageName = imageType === 'nemoclaw' ? 'nemoclaw-serverless' : 'openclaw-serverless';
    const imageUrl = `cr.${region}.nebius.cloud/${registryId}/${imageName}:latest`;

    builds.set(buildId, { status: 'running', log: '', image: imageUrl, startedAt: Date.now() });

    // Run build script asynchronously
    const scriptPath = imageType === 'nemoclaw'
      ? path.resolve(__dirname, '../install-nemoclaw-serverless.sh')
      : path.resolve(__dirname, '../install-openclaw-serverless.sh');

    // Check if script exists, if not use inline Dockerfile
    buildCmd = fs.existsSync(scriptPath)
      ? `bash "${scriptPath}" 2>&1`
      : `echo "Build script not found: ${scriptPath}"`;

    env = {
      ...process.env,
      REGION: region,
      PROJECT_ID: regionConfig.projectId || '',
      TOKEN_FACTORY_API_KEY: 'placeholder', // Just for the build, not used at build time
      SKIP_DEPLOY: '1' // We only want build+push, not endpoint creation
    };

    res.json({ buildId, status: 'running', image: imageUrl });
  }

  const buildProc = exec(buildCmd, { env, timeout: 600000 }, (err, stdout, stderr) => {
    const build = builds.get(buildId);
    if (build) {
      build.status = err ? 'failed' : 'success';
      build.log += stderr || '';
      build.finishedAt = Date.now();
    }
  });

  buildProc.stdout?.on('data', (data) => {
    const build = builds.get(buildId);
    if (build) build.log += data.toString();
  });

  buildProc.stderr?.on('data', (data) => {
    const build = builds.get(buildId);
    if (build) build.log += data.toString();
  });
});

// Return Dockerfile source for a given build type
app.get('/api/build/source/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  if (type !== 'openclaw' && type !== 'nemoclaw') {
    return res.status(400).json({ error: 'Unknown build type' });
  }

  const scriptPath = type === 'nemoclaw'
    ? path.resolve(__dirname, '../install-nemoclaw-serverless.sh')
    : path.resolve(__dirname, '../install-openclaw-serverless.sh');

  try {
    const script = fs.readFileSync(scriptPath, 'utf-8');

    // Extract Dockerfile from heredoc: cat > ... << 'DOCKERFILE' ... DOCKERFILE
    const dockerMatch = script.match(/cat > [^\n]*Dockerfile[^\n]*<<\s*'DOCKERFILE'\n([\s\S]*?)\nDOCKERFILE/);
    const dockerfile = dockerMatch ? dockerMatch[1] : null;

    // Extract entrypoint from heredoc: cat > ... << 'ENTRYPOINT' ... ENTRYPOINT
    const entryMatch = script.match(/cat > [^\n]*entrypoint\.sh[^\n]*<<\s*'ENTRYPOINT'\n([\s\S]*?)\nENTRYPOINT/);
    const entrypoint = entryMatch ? entryMatch[1] : null;

    const repo = type === 'nemoclaw'
      ? 'https://github.com/colygon/openclaw-deploy'
      : 'https://github.com/colygon/openclaw-deploy';

    res.json({ dockerfile, entrypoint, scriptPath: `install-${type}-serverless.sh`, repo });
  } catch (e) {
    res.status(500).json({ error: 'Could not read build script' });
  }
});

app.get('/api/build/:id', requireAuth, (req, res) => {
  const build = builds.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });

  // Return last 100 lines of log
  const logLines = build.log.split('\n');
  const tailLog = logLines.slice(-100).join('\n');

  res.json({
    status: build.status,
    image: build.image,
    log: tailLog,
    startedAt: build.startedAt,
    finishedAt: build.finishedAt
  });
});

// ── Routes: Platforms ──────────────────────────────────────────────────────

app.get('/api/platforms', requireAuth, (req, res) => {
  const region = req.query.region;
  const profile = region ? (REGION_PROFILES[region] || Object.values(REGION_PROFILES).find(Boolean)) : Object.values(REGION_PROFILES).find(Boolean);

  try {
    const token = getUserToken(req);
    const data = nebiusJson('compute platform list', profile, token);
    const platforms = (data.items || []).map(p => ({
      id: p.metadata.name,
      presets: (p.spec?.presets || []).map(pr => ({
        name: pr.name,
        vcpu: pr.resources?.vcpu_count || 0,
        memory_gib: pr.resources?.memory_gib || 0,
        gpu_count: pr.resources?.gpu_count || 0
      }))
    }));
    res.json(platforms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Routes: Models (Token Factory) ────────────────────────────────────────
let cachedModels = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// POST to keep API key out of query params / server logs
app.post('/api/models', requireAuth, async (req, res) => {
  if (IS_VERCEL) return res.json(DEMO_MODELS);

  // Return cached if fresh
  if (cachedModels && Date.now() - modelsCacheTime < MODELS_CACHE_TTL) {
    return res.json(cachedModels);
  }

  try {
    const tfRegion = req.body.region || '';
    const tfBase = tokenFactoryUrl(tfRegion);
    const tfUrl = `${tfBase}/models`;

    // Try user-provided API key first, then env var, then MysteryBox
    let authToken = req.body.apiKey || process.env.TOKEN_FACTORY_API_KEY || '';
    const userIamToken = getUserToken(req);
    if (!authToken) {
      try {
        const secretsJson = execSync('nebius mysterybox secret list --format json', { encoding: 'utf-8', timeout: 15000, env: nebiusExecEnv(userIamToken) });
        const secrets = JSON.parse(secretsJson);
        const tfSecret = (secrets.items || []).find(s =>
          (s.metadata?.name || '').toLowerCase().includes('token') && (s.metadata?.name || '').toLowerCase().includes('key')
        );
        if (tfSecret) {
          const payloadJson = execSync(`nebius mysterybox payload get --secret-id ${validateId(tfSecret.metadata.id)} --format json`, { encoding: 'utf-8', timeout: 15000, env: nebiusExecEnv(userIamToken) });
          const payload = JSON.parse(payloadJson);
          const entry = (payload.data || [])[0];
          if (entry) authToken = entry.string_value || entry.text_value || '';
        }
      } catch (e) {
        eventLog.warn('MYSTERYBOX', 'Could not fetch TF key from MysteryBox', { error: e.message });
      }
    }

    if (!authToken) {
      throw new Error('Enter your Token Factory API key above, then click Load Models');
    }

    const response = await fetch(tfUrl, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token Factory API returned ${response.status}: ${body}`);
    }

    const data = await response.json();
    cachedModels = (data.data || data.models || [])
      .map(m => ({ id: m.id, owned_by: m.owned_by || '' }))
      .sort((a, b) => a.id.localeCompare(b.id));
    modelsCacheTime = Date.now();

    res.json(cachedModels);
  } catch (err) {
    eventLog.error('API', 'Failed to fetch models', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Routes: Endpoints ──────────────────────────────────────────────────────

app.get('/api/endpoints', requireAuth, async (req, res) => {
  if (IS_VERCEL) return res.json(DEMO_ENDPOINTS);

  const allEndpoints = [];
  const token = getUserToken(req);

  for (const [region, profile] of Object.entries(REGION_PROFILES)) {
    if (!profile) continue;
    try {
      const data = nebiusJson('ai endpoint list', profile, token);
      const regionInfo = REGIONS[region] || {};

      for (const ep of (data.items || [])) {
        // Also try to extract region from image URL as fallback
        let detectedRegion = region;
        const imageMatch = (ep.spec.image || '').match(/cr\.([^.]+)\.nebius\.cloud/);
        if (imageMatch) detectedRegion = imageMatch[1];
        const ri = REGIONS[detectedRegion] || regionInfo;

        // Extract model from env vars
        const envVars = ep.spec.environment_variables || [];
        const modelEnv = envVars.find(v => v.name === 'INFERENCE_MODEL');

        allEndpoints.push({
          id: ep.metadata.id,
          name: ep.metadata.name,
          state: ep.status.state,
          publicIp: ep.status.instances?.[0]?.public_ip || null,
          privateIp: ep.status.instances?.[0]?.private_ip || null,
          image: ep.spec.image,
          platform: ep.spec.platform,
          preset: ep.spec.preset || null,
          model: modelEnv?.value || null,
          region: detectedRegion,
          regionName: ri.name || detectedRegion || 'Unknown',
          regionFlag: ri.flag || '🌐',
          createdAt: ep.metadata.created_at,
          health: null, // filled in below
          dashboardToken: endpointPasswords[ep.metadata.name] || null
        });
      }
    } catch (err) {
      // Region query failed — skip silently
      eventLog.warn('NEBIUS', 'Region query failed, skipping', { region, profile, error: err.message.split('\n')[0] });
    }
  }

  // Fetch health status from each running endpoint (in parallel, non-blocking)
  await Promise.all(allEndpoints.map(async (ep) => {
    const healthIp = ep.publicIp || ep.privateIp;
    if (healthIp && ep.state === 'RUNNING') {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(`http://${healthIp}:8080`, { signal: controller.signal });
        clearTimeout(timeout);
        ep.health = await resp.json();
      } catch (e) {
        ep.health = null;
      }
    }
  }));

  res.json(allEndpoints);
});

// ── Routes: Deploy ─────────────────────────────────────────────────────────

app.post('/api/deploy', requireAuth, async (req, res) => {
  if (IS_VERCEL) {
    return res.status(400).json({
      error: 'Demo mode — deploy is only available when running locally. Run: npx nemoclaw or git clone + npm start'
    });
  }

  const { imageType, model, region, platform, platformPreset, provider, customImage, endpointName, apiKey, usePublicIp } = req.body;

  if (!imageType || !region) {
    return res.status(400).json({ error: 'imageType and region are required' });
  }

  const regionConfig = REGIONS[region];
  if (!regionConfig) {
    return res.status(400).json({ error: `Unknown region: ${region}` });
  }

  const isGpuPlatform = platform === 'gpu' || (platform === 'custom' && platformPreset && platformPreset.startsWith('gpu-'));
  if (!isGpuPlatform && !apiKey) {
    const providerLabels = { 'token-factory': 'Token Factory', 'openrouter': 'OpenRouter', 'huggingface': 'HuggingFace' };
    return res.status(400).json({ error: `${providerLabels[provider] || 'API'} key is required` });
  }

  const name = endpointName || generateCrustaceanName();
  eventLog.info('DEPLOY', 'Deploy request received', { imageType, model, region, platform, provider, name });
  trackDeploy(imageType, region, platform);
  const token = getUserToken(req);

  try {
    // Pre-flight: check public IPv4 quota before attempting deploy (only for public IP)
    const wantPublicIp = usePublicIp !== false; // default true for backward compat
    if (wantPublicIp && TENANT_ID) {
      try {
        const quota = nebiusJson(
          `quotas quota-allowance get-by-name --name vpc.ipv4-address.public.count --parent-id ${TENANT_ID} --region ${region}`,
          null, token
        );
        const limit = parseInt(quota.spec?.limit || '0', 10);
        const usage = parseInt(quota.status?.usage || '0', 10);
        if (usage >= limit) {
          eventLog.warn('DEPLOY', 'Public IP quota exhausted', { region, limit, usage });
          return res.status(400).json({
            error: `No public IPv4 addresses available in ${regionConfig.name}. You are using ${usage}/${limit}. Delete or stop an existing endpoint to free up an IP, or request a quota increase from Nebius.`,
            quotaExhausted: true,
            limit,
            usage
          });
        }
        eventLog.debug('DEPLOY', 'IP quota check passed', { region, limit, usage });
      } catch (quotaErr) {
        // Don't block deploy if quota check itself fails — let it fail naturally
        eventLog.warn('DEPLOY', 'IP quota check skipped', { region, error: quotaErr.message.split('\n')[0] });
      }
    }

    // Find or create project for this region
    let projectId = regionConfig.projectId;
    if (!projectId) {
      try {
        if (!TENANT_ID) {
          return res.status(500).json({ error: 'No tenant ID found. Check your Nebius CLI config.' });
        }
        const projName = `openclaw-${region}`;
        eventLog.info('DEPLOY', 'Setting up project for region', { region });

        // List all projects at tenant level and find one in the right region
        const firstProfile = Object.values(REGION_PROFILES)[0];
        const projects = nebiusJson(
          `iam project list --parent-id ${TENANT_ID}`, firstProfile, token
        );
        // Prefer default-project-<region>, then openclaw-<region>, then any match
        const allInRegion = (projects.items || []).filter(
          p => p.status?.region === region || p.spec?.region === region
        );
        const defaultProj = allInRegion.find(p => p.metadata.name === `default-project-${region}`);
        const oclawProj = allInRegion.find(p => p.metadata.name === projName);
        const picked = defaultProj || oclawProj || allInRegion[0];

        if (picked) {
          projectId = picked.metadata.id;
          eventLog.info('DEPLOY', 'Using existing project', { name: picked.metadata.name, projectId, region });
        } else {
          eventLog.info('DEPLOY', 'Creating new project', { projName, region });
          const projResult = nebius(
            `iam project create --name "${projName}" --parent-id ${TENANT_ID} --format json`,
            firstProfile, token
          );
          projectId = JSON.parse(projResult).metadata.id;
        }
        regionConfig.projectId = projectId;

        // Write the profile directly into ~/.nebius/config.yaml
        const configPath = process.env.NEBIUS_CONFIG_PATH || path.join(process.env.HOME, '.nebius', 'config.yaml');
        let config = fs.readFileSync(configPath, 'utf-8');

        if (!config.includes(`    ${region}:`)) {
          // Insert new profile after "profiles:" line
          const profileBlock = [
            `    ${region}:`,
            `        endpoint: api.nebius.cloud`,
            `        auth-type: federation`,
            `        federation-endpoint: auth.nebius.com`,
            `        parent-id: ${projectId}`,
            `        tenant-id: ${TENANT_ID}`
          ].join('\n');

          config = config.replace(
            /^profiles:\n/m,
            `profiles:\n${profileBlock}\n`
          );
          fs.writeFileSync(configPath, config, 'utf-8');
          eventLog.info('SYSTEM', 'Wrote new profile to Nebius config', { region });
        }

        // Update REGION_PROFILES so endpoint polling picks it up
        REGION_PROFILES[region] = region;

        eventLog.info('DEPLOY', 'Created project', { projectId, region });
      } catch (err) {
        return res.status(500).json({
          error: `Failed to create project in ${region}: ${err.message.split('\n')[0]}`
        });
      }
    }

    // Determine which CLI profile to use for this region
    const profile = REGION_PROFILES[region] || Object.values(REGION_PROFILES)[0];
    const profileFlag = `--profile ${profile}`;

    // Resolve platform and preset based on user selection
    if (platform === 'custom' && platformPreset) {
      // User picked a specific platform:preset from the dropdown
      const [customPlat, customPreset] = platformPreset.split(':');
      regionConfig.cpuPlatform = customPlat;
      regionConfig.cpuPreset = customPreset;
      eventLog.info('DEPLOY', 'Custom platform selected', { platform: customPlat, preset: customPreset });
    } else if (platform === 'gpu') {
      // Auto-detect cheapest single-GPU platform in this region
      try {
        const platforms = nebiusJson('compute platform list', profile, token);
        const gpuPlatforms = (platforms.items || []).filter(p => p.metadata.name.startsWith('gpu-'));
        let cheapestGpu = null;
        let cheapestGpuCount = Infinity;

        for (const plat of gpuPlatforms) {
          for (const pr of (plat.spec?.presets || [])) {
            const gpuCount = pr.resources?.gpu_count || Infinity;
            if (gpuCount < cheapestGpuCount) {
              cheapestGpuCount = gpuCount;
              cheapestGpu = { platform: plat.metadata.name, preset: pr.name };
            }
          }
        }
        if (cheapestGpu) {
          regionConfig.cpuPlatform = cheapestGpu.platform;
          regionConfig.cpuPreset = cheapestGpu.preset;
          eventLog.info('DEPLOY', 'Auto-detected cheapest GPU', { region, platform: cheapestGpu.platform, preset: cheapestGpu.preset });
        }
      } catch (err) {
        eventLog.warn('DEPLOY', 'GPU platform detection failed', { region, error: err.message.split('\n')[0] });
      }
    } else {
      // Default: auto-detect cheapest CPU platform in this region
      try {
        const platforms = nebiusJson('compute platform list', profile, token);
        const cpuPlatforms = (platforms.items || []).filter(p => p.metadata.name.startsWith('cpu-'));

        if (cpuPlatforms.length > 0) {
          let cheapest = null;
          let cheapestVcpu = Infinity;

          for (const plat of cpuPlatforms) {
            for (const pr of (plat.spec?.presets || [])) {
              const vcpu = pr.resources?.vcpu_count || Infinity;
              if (vcpu < cheapestVcpu) {
                cheapestVcpu = vcpu;
                cheapest = { platform: plat.metadata.name, preset: pr.name };
              }
            }
          }

          if (cheapest) {
            regionConfig.cpuPlatform = cheapest.platform;
            regionConfig.cpuPreset = cheapest.preset;
            eventLog.info('DEPLOY', 'Auto-detected cheapest CPU', { region, platform: cheapest.platform, preset: cheapest.preset, vcpu: cheapestVcpu });
          }
        }
      } catch (err) {
        eventLog.warn('DEPLOY', 'CPU platform detection failed', { region, error: err.message.split('\n')[0] });
      }
    }

    // Find or create registry in this region
    let registryId;
    try {
      const registries = nebiusJson('registry list', profile, token);
      registryId = registries.items?.[0]?.metadata?.id;
      // Strip "registry-" prefix — image URLs use just the ID
      if (registryId) registryId = registryId.replace(/^registry-/, '');
    } catch (e) {}

    if (!registryId) {
      try {
        eventLog.info('DEPLOY', 'Creating container registry', { region });
        const regResult = nebius(
          `registry create --name openclaw --parent-id ${projectId} --format json`,
          null, token
        );
        registryId = JSON.parse(regResult).metadata.id;
        eventLog.info('DEPLOY', 'Container registry created', { registryId, region });
      } catch (err) {
        return res.status(500).json({
          error: `Failed to create registry in ${region}: ${err.message.split('\n')[0]}`
        });
      }
    }

    // Resolve image URL
    const imageConfig = IMAGES[imageType];
    if (!imageConfig) {
      return res.status(400).json({ error: `Unknown image type: ${imageType}` });
    }

    let image = imageConfig.getImage(registryId, region, customImage);
    if (!image) {
      return res.status(400).json({ error: 'Could not resolve image URL' });
    }

    // Check if the image exists in the registry; fall back to public GHCR if not
    if (imageType !== 'custom' && registryId) {
      try {
        // Use user's IAM token if available, otherwise get one from CLI
        const regCheckToken = token || execSync('nebius iam get-access-token', { encoding: 'utf-8' }).trim();
        const registryUrl = `cr.${region}.nebius.cloud`;
        const repoPath = `${registryId}/${imageType === 'nemoclaw' ? 'nemoclaw' : 'openclaw'}-serverless`;
        const checkResult = execSync(
          `curl -sf -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${regCheckToken}" "https://${registryUrl}/v2/${repoPath}/tags/list"`,
          { encoding: 'utf-8', timeout: 10000 }
        ).trim();
        if (checkResult === '404' || checkResult === '401') {
          // Image not in user's registry — fall back to public GHCR image
          const ghcrImage = GHCR_IMAGES[imageType];
          if (ghcrImage) {
            eventLog.info('DEPLOY', 'Image not in registry, falling back to public GHCR', { ghcrImage });
            image = ghcrImage;
          }
        }
      } catch (e) {
        eventLog.warn('DEPLOY', 'Image registry check skipped', { error: e.message.split('\n')[0] });
      }
    }

    // Build env vars based on provider
    const envFlags = [];
    envFlags.push(`--env "INFERENCE_MODEL=${model || 'zai-org/GLM-5'}"`);

    // Generate a dashboard password and store it for later use
    const webPassword = crypto.randomBytes(24).toString('base64url');
    envFlags.push(`--env "OPENCLAW_WEB_PASSWORD=${webPassword}"`);

    if (!isGpuPlatform) {
      switch (provider) {
        case 'openrouter':
          envFlags.push(`--env "OPENROUTER_API_KEY=${apiKey}"`);
          envFlags.push('--env "INFERENCE_URL=https://openrouter.ai/api/v1"');
          envFlags.push('--env "INFERENCE_PROVIDER=openrouter"');
          envFlags.push('--env "OPENROUTER_PROVIDER_ONLY=nebius"');
          break;
        case 'huggingface':
          envFlags.push(`--env "HUGGINGFACE_API_KEY=${apiKey}"`);
          envFlags.push('--env "INFERENCE_PROVIDER=huggingface"');
          envFlags.push('--env "HUGGINGFACE_PROVIDER=nebius"');
          envFlags.push(`--env "HF_TOKEN=${apiKey}"`);
          break;
        case 'token-factory':
        default:
          envFlags.push(`--env "TOKEN_FACTORY_API_KEY=${apiKey}"`);
          envFlags.push(`--env "TOKEN_FACTORY_URL=${tokenFactoryUrl(region)}"`);
          break;
      }
    }

    // Find SSH public key to authorize on the endpoint
    const sshKey = findSshKey();
    let sshPubKey = '';
    if (sshKey) {
      const pubPath = sshKey + '.pub';
      // Generate .pub from private key if it doesn't exist
      if (!fs.existsSync(pubPath)) {
        try {
          execSync(`ssh-keygen -y -f "${sshKey}" > "${pubPath}"`, { encoding: 'utf-8' });
        } catch (e) { /* ignore */ }
      }
      if (fs.existsSync(pubPath)) {
        sshPubKey = fs.readFileSync(pubPath, 'utf-8').trim();
      }
    }

    // Deploy endpoint
    const cmd = [
      `${profileFlag} ai endpoint create`,
      `--name "${name}"`,
      `--image "${image}"`,
      `--platform ${regionConfig.cpuPlatform || 'cpu-e2'}`,
      regionConfig.cpuPreset ? `--preset ${regionConfig.cpuPreset}` : '',
      '--container-port 8080',
      '--container-port 18789',
      '--disk-size 100Gi',
      ...envFlags,
      wantPublicIp ? '--public' : '',
      sshPubKey ? `--ssh-key "${sshPubKey}"` : ''
    ].filter(Boolean).join(' ');

    // Store the dashboard password keyed by endpoint name
    storePassword(name, webPassword);
    eventLog.info('DEPLOY', 'Deploy queued', { name, region, image, platform: regionConfig.cpuPlatform, preset: regionConfig.cpuPreset });

    // Run async so we don't block
    exec(`nebius ${cmd}`, { timeout: 120000, env: nebiusExecEnv(token) }, (err, stdout, stderr) => {
      if (err) {
        eventLog.error('DEPLOY', 'Deploy failed', { region, name, error: stderr || err.message });
      } else {
        eventLog.info('DEPLOY', 'Deploy succeeded', { region, name });
      }
    });

    res.json({
      status: 'deploying',
      name,
      image,
      region: regionConfig.name,
      platform: regionConfig.cpuPlatform || 'cpu-e2',
      preset: regionConfig.cpuPreset || 'default',
      publicIp: wantPublicIp,
      message: `Deploying ${imageConfig.name} to ${regionConfig.name} (${regionConfig.cpuPlatform || 'cpu-e2'} / ${regionConfig.cpuPreset || 'default'}${wantPublicIp ? '' : ' / private IP'})...`
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Routes: Manage ─────────────────────────────────────────────────────────

app.delete('/api/endpoints/:id', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json({ status: 'demo — delete not available', id: req.params.id });

  try {
    const id = validateId(req.params.id);
    const token = getUserToken(req);
    exec(`nebius ai endpoint delete --id ${id}`, { timeout: 60000, env: nebiusExecEnv(token) }, (err) => {
      if (err) eventLog.error('DEPLOY', 'Endpoint delete failed', { id: req.params.id, error: err.message });
    });
    res.json({ status: 'deleting', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/endpoints/:id/stop', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json({ status: 'demo' });
  try {
    const id = validateId(req.params.id);
    const token = getUserToken(req);
    exec(`nebius ai endpoint stop --id ${id}`, { timeout: 120000, env: nebiusExecEnv(token) }, (err) => {
      if (err) eventLog.error('DEPLOY', 'Endpoint stop failed', { error: err.message });
    });
    res.json({ status: 'stopping', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/endpoints/:id/start', requireAuth, (req, res) => {
  if (IS_VERCEL) return res.json({ status: 'demo' });
  try {
    const id = validateId(req.params.id);
    const token = getUserToken(req);
    exec(`nebius ai endpoint start --id ${id}`, { timeout: 120000, env: nebiusExecEnv(token) }, (err) => {
      if (err) eventLog.error('DEPLOY', 'Endpoint start failed', { error: err.message });
    });
    res.json({ status: 'starting', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Routes: SSH Tunnel for Dashboard ──────────────────────────────────────
const activeTunnels = {}; // { ip: { proc, localPort } }
let nextTunnelPort = 19000;

app.post('/api/tunnel', requireAuth, (req, res) => {
  let ip;
  try {
    ip = validateIp(req.body.ip);
  } catch (e) {
    return res.status(400).json({ error: 'Valid IP address is required' });
  }
  const { endpointName } = req.body;

  const sshKey = findSshKey();

  // Determine the tunnel URL scheme and host
  // When running remotely behind HTTPS nginx, use https + nginx dashboard proxy port
  // When running locally, use http://localhost
  const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
  const serverHost = isLocal ? 'localhost' : req.hostname;
  const tunnelScheme = isLocal ? 'http' : 'https';
  // nginx listens on 19443 and proxies to the tunnel port (19000)
  const DASHBOARD_HTTPS_PORT = 19443;

  // Reuse existing tunnel if alive
  if (activeTunnels[ip]) {
    const existing = activeTunnels[ip];
    if (!existing.proc.killed) {
      const reusePort = isLocal ? existing.localPort : DASHBOARD_HTTPS_PORT;
      return res.json({ url: `${tunnelScheme}://${serverHost}:${reusePort}`, localPort: existing.localPort, token: existing.gatewayToken || null, reused: true });
    }
    // Dead tunnel — clean up
    delete activeTunnels[ip];
  }

  const localPort = nextTunnelPort++;

  eventLog.info('TUNNEL', 'Creating SSH tunnel', { ip, localPort });

  // Step 1: Try to get dashboard token
  // First check our stored passwords (set during deploy), then SSH extract as fallback
  let gatewayToken = null;

  if (endpointName && endpointPasswords[endpointName]) {
    gatewayToken = endpointPasswords[endpointName];
    eventLog.info('TUNNEL', 'Using stored dashboard password', { endpointName });
  } else {
    // Fallback: SSH in and extract token from multiple sources
    try {
      // Try multiple extraction methods:
      // 1. Docker env vars (OPENCLAW_WEB_PASSWORD or OPENCLAW_GATEWAY_TOKEN)
      // 2. OpenClaw config file (gateway.auth.token)
      // 3. Process command line (OPENCLAW_GATEWAY_TOKEN=xxx set inline)
      const tokenCmd = `ssh -i ${sshKey} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 nebius@${ip} "` +
        `CID=\\$(sudo docker ps -q | head -1); ` +
        `TOKEN=\\$(sudo docker exec \\$CID env 2>/dev/null | grep -E 'OPENCLAW_WEB_PASSWORD|OPENCLAW_GATEWAY_TOKEN' | head -1 | cut -d= -f2-); ` +
        `if [ -z \\"\\$TOKEN\\" ]; then ` +
        `  TOKEN=\\$(sudo docker exec \\$CID cat /home/openclaw/.openclaw/openclaw.json 2>/dev/null | python3 -c \\"import sys,json;d=json.load(sys.stdin);print(d.get('gateway',{}).get('auth',{}).get('token',''))\\" 2>/dev/null); ` +
        `fi; ` +
        `echo \\$TOKEN"`;
      eventLog.info('TUNNEL', 'Fetching gateway token via SSH', { ip });
      gatewayToken = execSync(tokenCmd, { timeout: 20000, encoding: 'utf-8' }).trim();
      if (gatewayToken) {
        eventLog.info('TUNNEL', 'Gateway token retrieved via SSH', { ip });
      } else {
        eventLog.warn('TUNNEL', 'No gateway token found in container env', { ip });
      }
    } catch (err) {
      eventLog.warn('TUNNEL', 'Could not fetch gateway token', { ip, error: err.message });
    }
  }

  // Step 2: Create the SSH tunnel with socat bridge
  // Port 18789 is inside the Docker container but not mapped to the host.
  // So we SSH in and run socat to bridge host port → container port,
  // then forward our local port to that.
  const remoteProxyPort = 28789;
  const proc = spawn('ssh', [
    '-tt',
    '-L', `0.0.0.0:${localPort}:localhost:${remoteProxyPort}`,
    '-i', sshKey,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ConnectTimeout=10',
    '-o', 'ExitOnForwardFailure=yes',
    `nebius@${ip}`,
    // On the remote host: get the container's IP, then use socat to proxy
    `CONTAINER_IP=$(sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(sudo docker ps -q | head -1)); `
    + `echo "Proxying to container at $CONTAINER_IP:18789"; `
    + `sudo socat TCP-LISTEN:${remoteProxyPort},fork,reuseaddr TCP:$CONTAINER_IP:18789 || `
    + `sudo apt-get install -y socat > /dev/null 2>&1 && sudo socat TCP-LISTEN:${remoteProxyPort},fork,reuseaddr TCP:$CONTAINER_IP:18789`
  ]);

  proc.on('close', (code) => {
    eventLog.info('TUNNEL', 'SSH tunnel closed', { ip, localPort, code });
    delete activeTunnels[ip];
  });

  proc.on('error', (err) => {
    eventLog.error('TUNNEL', 'SSH tunnel process error', { ip, error: err.message });
    delete activeTunnels[ip];
  });

  activeTunnels[ip] = { proc, localPort, gatewayToken };

  // Give SSH a moment to establish the tunnel
  setTimeout(() => {
    if (proc.killed) {
      res.status(500).json({ error: 'SSH tunnel failed to start' });
    } else {
      const urlPort = isLocal ? localPort : DASHBOARD_HTTPS_PORT;
      res.json({ url: `${tunnelScheme}://${serverHost}:${urlPort}`, localPort, token: gatewayToken || null, reused: false });
    }
  }, 2000);
});

// ── Routes: Auto-approve device pairing ──────────────────────────────────
app.post('/api/pair-approve', requireAuth, (req, res) => {
  let ip;
  try { ip = validateIp(req.body.ip); } catch (e) {
    return res.status(400).json({ error: 'Valid IP address is required' });
  }
  const token = req.body.token || '';
  const sshKey = findSshKey();

  eventLog.info('TUNNEL', 'Auto-approving device pairing', { ip });

  // Run approve in background with retries — the pairing request may arrive after a short delay
  const tokenFlag = token ? `--token ${token}` : '';
  const approveCmd = `ssh -i ${sshKey} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 nebius@${ip} ` +
    `"for i in 1 2 3 4 5 6; do ` +
    `  RESULT=\\$(sudo docker exec \\$(sudo docker ps -q | head -1) openclaw devices approve --latest ${tokenFlag} 2>&1); ` +
    `  if echo \\"\\$RESULT\\" | grep -q 'Approved'; then echo \\"\\$RESULT\\"; exit 0; fi; ` +
    `  sleep 3; ` +
    `done; echo 'No pending pairing requests found'"`;

  exec(approveCmd, { timeout: 30000, encoding: 'utf-8' }, (err, stdout, stderr) => {
    if (stdout && stdout.includes('Approved')) {
      eventLog.info('TUNNEL', 'Device pairing approved', { ip, result: stdout.trim() });
    } else {
      eventLog.warn('TUNNEL', 'Device pairing result', { ip, result: (stdout || stderr || err?.message || 'unknown').trim() });
    }
  });

  // Return immediately — approval happens in the background
  res.json({ status: 'approving', message: 'Auto-approving pairing in background (up to 18s)' });
});

app.delete('/api/tunnel/:ip', requireAuth, (req, res) => {
  let ip;
  try { ip = validateIp(req.params.ip); } catch (e) {
    return res.status(400).json({ error: 'Invalid IP' });
  }
  const tunnel = activeTunnels[ip];
  if (tunnel) {
    tunnel.proc.kill('SIGTERM');
    delete activeTunnels[ip];
    eventLog.info('TUNNEL', 'Tunnel manually closed', { ip });
  }
  res.json({ status: 'closed' });
});

app.get('/api/tunnels', requireAuth, (req, res) => {
  const tunnels = {};
  for (const [ip, t] of Object.entries(activeTunnels)) {
    tunnels[ip] = { localPort: t.localPort, alive: !t.proc.killed };
  }
  res.json(tunnels);
});

// ── WebSocket SSH Terminal ─────────────────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawIp = url.searchParams.get('ip');

  let ip;
  try {
    ip = validateIp(rawIp);
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', data: 'Invalid IP address' }));
    ws.close();
    return;
  }

  eventLog.info('TERMINAL', 'SSH terminal connecting', { ip });

  const sshKey = findSshKey();
  eventLog.debug('TERMINAL', 'SSH key resolved', { sshKey });

  if (!sshKey) {
    ws.send(JSON.stringify({ type: 'error', data: 'No SSH key found. Check ~/.ssh/ for id_ed25519 or id_ed25519_vm.' }));
    ws.close();
    return;
  }

  ws.send(JSON.stringify({ type: 'status', data: `Connecting to ${ip}...\r\n` }));

  // SSH into the endpoint, then exec into the container to run openclaw
  const sshProc = spawn('ssh', [
    '-tt',
    '-i', sshKey,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ConnectTimeout=30',
    '-o', 'ConnectionAttempts=2',
    `nebius@${ip}`,
    // After SSH connects, find the running container and exec openclaw tui
    'sudo docker exec -it $(sudo docker ps -q | head -1) openclaw tui 2>/dev/null || echo "No container running — dropping to shell"; bash'
  ], {
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  sshProc.stdout.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      // Send SSH data as JSON with base64 encoding to avoid frame corruption
      try {
        ws.send(JSON.stringify({ type: 'data', data: Buffer.from(data).toString('base64'), encoding: 'base64' }));
      } catch (e) { /* skip bad frame */ }
    }
  });

  sshProc.stderr.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'data', data: Buffer.from(data).toString('base64'), encoding: 'base64' }));
      } catch (e) { /* skip bad frame */ }
    }
  });

  sshProc.on('close', (code, signal) => {
    eventLog.info('TERMINAL', 'SSH process closed', { ip, code, signal });
    if (ws.readyState === WebSocket.OPEN) {
      const msg = code === 255
        ? 'SSH connection failed. The endpoint may not have SSH enabled, or the connection timed out.'
        : null;
      if (msg) ws.send(JSON.stringify({ type: 'error', data: msg }));
      ws.send(JSON.stringify({ type: 'exit', code }));
      // Small delay before closing so the client receives the messages
      setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.close(); }, 500);
    }
  });

  sshProc.on('error', (err) => {
    eventLog.error('TERMINAL', 'SSH process error', { ip, error: err.message });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', data: `SSH error: ${err.message}` }));
      ws.close();
    }
  });

  // Forward input from browser to SSH stdin
  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'input' && sshProc.stdin.writable) {
        sshProc.stdin.write(parsed.data);
      }
    } catch (e) {
      // Raw string fallback
      if (sshProc.stdin.writable) {
        sshProc.stdin.write(msg);
      }
    }
  });

  ws.on('close', () => {
    eventLog.info('TERMINAL', 'WebSocket closed', { ip });
    sshProc.kill('SIGTERM');
  });
});

// ── WebSocket Logs Stream ─────────────────────────────────────────────────
const wssLogs = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

wssLogs.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const endpointId = url.searchParams.get('id');

  if (!endpointId || !/^[a-zA-Z0-9_-]+$/.test(endpointId)) {
    ws.send(JSON.stringify({ type: 'error', data: 'Invalid endpoint ID' }));
    ws.close();
    return;
  }

  // Get user token from session (parsed during WS upgrade)
  const wsToken = req.session?.nebiusToken || null;

  // Find the profile for this endpoint
  let profile = null;
  for (const [region, info] of Object.entries(REGIONS)) {
    if (info.profile) {
      try {
        const data = nebiusJson('ai endpoint list', info.profile, wsToken);
        if ((data.items || []).some(ep => ep.metadata.id === endpointId)) {
          profile = info.profile;
          break;
        }
      } catch (e) { /* skip */ }
    }
  }

  eventLog.info('TERMINAL', 'Log stream started', { endpointId });
  ws.send(JSON.stringify({ type: 'status', data: `Connecting to logs for ${endpointId}...\r\n` }));

  const args = ['ai', 'endpoint', 'logs', endpointId, '--follow', '--timestamps', '--tail', '100'];
  if (profile) args.push('--profile', profile);

  const logProc = spawn('nebius', args, { env: nebiusExecEnv(wsToken) });

  logProc.stdout.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: data.toString('utf-8') }));
    }
  });

  logProc.stderr.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: data.toString('utf-8') }));
    }
  });

  logProc.on('close', (code) => {
    eventLog.info('TERMINAL', 'Log stream ended', { endpointId, code });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
      ws.close();
    }
  });

  logProc.on('error', (err) => {
    eventLog.error('TERMINAL', 'Log stream error', { endpointId, error: err.message });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', data: `Logs error: ${err.message}` }));
      ws.close();
    }
  });

  ws.on('close', () => {
    eventLog.info('TERMINAL', 'Log stream WebSocket closed', { endpointId });
    logProc.kill('SIGTERM');
  });
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'openclaw-deploy', uptime: process.uptime() });
});

// ── Proxy: single-IP routing to endpoints ─────────────────────────────────
// /proxy/<endpoint-name>/... → http://<endpoint-ip>:8080/...
// /proxy/<endpoint-name>/dashboard/... → http://<endpoint-ip>:18789/...
let proxyEndpointCache = {}; // { name: { ip, dashboardToken } }

// Refresh proxy cache from endpoint list
async function refreshProxyCache() {
  try {
    for (const [region, info] of Object.entries(REGIONS)) {
      const profile = REGION_PROFILES[region];
      if (!profile) continue;
      try {
        const data = nebiusJson('ai endpoint list', profile);
        for (const ep of (data.items || [])) {
          const ip = ep.status.instances?.[0]?.public_ip || ep.status.instances?.[0]?.private_ip;
          if (ip) {
            proxyEndpointCache[ep.metadata.name] = {
              ip,
              dashboardToken: endpointPasswords[ep.metadata.name] || null
            };
          }
        }
      } catch (e) {
        eventLog.warn('PROXY', 'Region skipped in proxy cache refresh', { region, error: e.message.split('\n')[0] });
      }
    }
    eventLog.info('PROXY', 'Proxy cache refreshed', { endpointCount: Object.keys(proxyEndpointCache).length });
  } catch (e) {
    eventLog.error('PROXY', 'Proxy cache refresh error', { error: e.message });
  }
}

// Refresh cache periodically (every 2 min)
if (!IS_VERCEL) {
  refreshProxyCache();
  setInterval(refreshProxyCache, 120000);
}

app.use('/proxy/:endpointName', (req, res) => {
  const name = req.params.endpointName;
  const endpoint = proxyEndpointCache[name];

  if (!endpoint) {
    return res.status(404).json({ error: `Endpoint "${name}" not found or has no public IP` });
  }

  // Determine target port: /proxy/name/dashboard/* → :18789, else → :8080
  const subPath = req.url;
  let targetPort = 8080;
  let targetPath = subPath;

  if (subPath.startsWith('/dashboard')) {
    targetPort = 18789;
    targetPath = subPath.replace(/^\/dashboard/, '') || '/';
  }

  const targetUrl = `http://${endpoint.ip}:${targetPort}${targetPath}`;

  // Proxy the request
  const proxyReq = http.request(targetUrl, {
    method: req.method,
    headers: {
      ...req.headers,
      host: `${endpoint.ip}:${targetPort}`,
      'x-forwarded-for': req.ip,
      'x-forwarded-proto': req.protocol,
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    eventLog.error('PROXY', 'HTTP proxy error', { targetUrl, error: err.message });
    if (!res.headersSent) {
      res.status(502).json({ error: `Proxy error: ${err.message}` });
    }
  });

  // Pipe request body for POST/PUT
  req.pipe(proxyReq, { end: true });
});

// API to list proxy URLs
app.get('/api/proxy-urls', requireAuth, (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const urls = {};
  for (const [name, ep] of Object.entries(proxyEndpointCache)) {
    urls[name] = {
      api: `${baseUrl}/proxy/${name}/`,
      dashboard: `${baseUrl}/proxy/${name}/dashboard/`,
      health: `${baseUrl}/proxy/${name}/`,
    };
  }
  res.json(urls);
});

// ── Admin routes ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_ENABLED) return res.status(404).json({ error: 'Not found' });
  if (!req.session?.isAdmin) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

// POST /admin/api/auth
app.post('/admin/api/auth', (req, res) => {
  if (!ADMIN_ENABLED) return res.status(404).json({ error: 'Not found' });
  if (!req.body.password || req.body.password !== ADMIN_PASSWORD) {
    eventLog.warn('AUTH', 'Admin login failed');
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  req.session.isAdmin = true;
  eventLog.info('AUTH', 'Admin login successful');
  res.json({ ok: true });
});

// POST /admin/api/logout
app.post('/admin/api/logout', (req, res) => {
  req.session.isAdmin = false;
  eventLog.info('AUTH', 'Admin logged out');
  res.json({ ok: true });
});

// GET /admin/api/status
app.get('/admin/api/status', requireAdmin, (req, res) => {
  res.json({
    authenticated: true,
    summary: {
      wssTerminalClients: wss.clients.size,
      wssLogsClients: wssLogs.clients.size,
      activeTunnels: Object.keys(activeTunnels).length,
      proxyEndpoints: Object.keys(proxyEndpointCache).length,
      eventBufferSize: eventBuffer.length,
      uptime: Math.floor(process.uptime()),
      recentDeploys: eventBuffer
        .filter(e => e.category === 'DEPLOY')
        .slice(-10).reverse(),
    }
  });
});

// GET /admin/api/events?level=&category=&search=&limit=200
app.get('/admin/api/events', requireAdmin, (req, res) => {
  const { level, category, search, limit = 200 } = req.query;
  const cap = Math.min(parseInt(limit, 10) || 200, EVENT_BUFFER_SIZE);
  let results = eventBuffer.slice();
  if (level)    results = results.filter(e => e.level === level);
  if (category) results = results.filter(e => e.category === category);
  if (search) {
    const q = search.toLowerCase();
    results = results.filter(e =>
      e.message.toLowerCase().includes(q) ||
      JSON.stringify(e.context || '').toLowerCase().includes(q)
    );
  }
  res.json(results.slice(-cap).reverse()); // newest first
});

// GET /admin/api/stream  (SSE)
app.get('/admin/api/stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay full buffer to new client
  for (const record of eventBuffer) res.write(`data: ${JSON.stringify(record)}\n\n`);

  adminSseClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);
  req.on('close', () => { clearInterval(heartbeat); adminSseClients.delete(res); });
});

// GET /admin/api/analytics
app.get('/admin/api/analytics', requireAdmin, (req, res) => {
  const range = Math.min(parseInt(req.query.days, 10) || 30, ANALYTICS_RETENTION_DAYS);
  const result = {};
  const now = new Date();
  for (let i = 0; i < range; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const day = analytics.days[ds];
    if (day) {
      const { _vSet, visitors, ...rest } = day;
      result[ds] = { ...rest, uniqueVisitors: (visitors || []).length };
    } else {
      result[ds] = { pageViews: 0, uniqueVisitors: 0, logins: 0, loginFails: 0,
        deploys: 0, errors: 0, deploysByAgent: {}, deploysByRegion: {},
        deploysByPlatform: {}, pages: {}, browsers: {} };
    }
  }
  res.json(result);
});

// GET /admin.html — serve admin panel
app.get('/admin.html', (req, res) => {
  if (!ADMIN_ENABLED) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── SPA fallback ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSocket upgrade handler (manual routing to avoid middleware interference) ──
server.on('upgrade', (request, socket, head) => {
  // Parse Express session from cookie so WS handlers can access user tokens
  sessionMiddleware(request, {}, () => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/ws/terminal') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/logs') {
    wssLogs.handleUpgrade(request, socket, head, (ws) => {
      wssLogs.emit('connection', ws, request);
    });
  } else if (pathname.startsWith('/proxy/')) {
    // Proxy WebSocket to endpoint's gateway (port 18789)
    const parts = pathname.split('/');
    const endpointName = decodeURIComponent(parts[2]);
    const endpoint = proxyEndpointCache[endpointName];

    if (!endpoint) {
      socket.destroy();
      return;
    }

    // Use a dedicated WebSocket.Server to handle the client upgrade,
    // then bridge to the target gateway via a second WebSocket
    const proxyWss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });
    proxyWss.handleUpgrade(request, socket, head, (clientWs) => {
      const targetUrl = `ws://${endpoint.ip}:18789`;
      eventLog.info('PROXY', 'WS proxy bridge initiated', { targetUrl });

      const targetWs = new WebSocket(targetUrl, {
        perMessageDeflate: false,
        headers: {
          origin: request.headers.origin || `https://${request.headers.host}`,
          'x-forwarded-for': request.headers['x-forwarded-for'] || request.socket.remoteAddress,
        }
      });

      targetWs.on('open', () => {
        eventLog.info('PROXY', 'WS proxy bridge connected', { targetUrl });
      });

      // Bridge: client → target
      clientWs.on('message', (data, isBinary) => {
        if (targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(data, { binary: isBinary });
        }
      });

      // Bridge: target → client
      targetWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      clientWs.on('close', () => targetWs.close());
      targetWs.on('close', () => clientWs.close());
      clientWs.on('error', () => targetWs.close());
      targetWs.on('error', (err) => {
        eventLog.error('PROXY', 'WS proxy target error', { error: err.message });
        clientWs.close();
      });
    });
  } else {
    socket.destroy();
  }
  }); // end sessionMiddleware callback
});

// ── Start server ───────────────────────────────────────────────────────────
if (!IS_VERCEL) {
  server.listen(PORT, () => {
    process.stdout.write(`\n  🦞 OpenClaw Deploy UI\n  http://localhost:${PORT}\n`);
    if (ADMIN_ENABLED) process.stdout.write(`  Admin panel: http://localhost:${PORT}/admin.html\n`);
    process.stdout.write('\n');
    eventLog.info('SYSTEM', 'Server started', { port: PORT, adminEnabled: ADMIN_ENABLED });
  });
}

// Export for Vercel serverless
module.exports = app;

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal) {
  eventLog.info('SYSTEM', `Received ${signal}, shutting down...`);
  saveAnalytics();

  // Close all SSH tunnels
  for (const [ip, tunnel] of Object.entries(activeTunnels)) {
    tunnel.proc.kill('SIGTERM');
    eventLog.info('SYSTEM', `Closed tunnel to ${ip}`);
  }

  // Close WebSocket connections
  wss.clients.forEach(ws => ws.close());

  server.close(() => {
    eventLog.info('SYSTEM', 'Server closed');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => process.exit(1), 5000);
}

if (!IS_VERCEL) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
