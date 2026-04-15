// ── State ────────────────────────────────────────────────────────────────────
let state = {
  selectedTarget: 'cloud',      // 'cloud' | 'local' | 'docker'
  selectedImage: null,
  selectedModel: null,
  selectedRegion: null,
  selectedProject: null,
  selectedProjectName: null,
  selectedPlatform: 'cpu',      // 'gpu' | 'cpu' | 'custom'
  customPlatformValue: null,    // 'platform:preset' e.g. 'gpu-h100-sxm:1gpu-16vcpu-200gb'
  selectedProvider: 'token-factory',
  selectedNetwork: 'private',    // 'public' | 'private'
  selectedStorage: 'filesystem', // 'bucket' | 'filesystem' | 'postgresql' | null (none)
  storageSize: 100,              // disk size in GB
  authenticated: false,
  canOAuth: false                // true when running on localhost
};

// Terminal state
let terminal = null;
let fitAddon = null;
let terminalWs = null;
let currentTerminalIp = null;
let currentTerminalName = null;
let currentTerminalEndpointId = null;
let currentTerminalHasPublicIp = false;

// Endpoints search/filter state
let endpointsCache = [];
let endpointFilter = 'all';
let endpointSearch = '';

// ── HTML escape helper (XSS prevention) ──────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ── Formatting helpers ──────────────────────────────────────────────────────
function formatState(state) {
  if (!state) return 'Unknown';
  return state.charAt(0) + state.slice(1).toLowerCase();
}

function formatPlatform(platform) {
  const names = { 'cpu-e2': 'Non-GPU Intel Ice Lake', 'cpu-d3': 'Non-GPU AMD EPYC' };
  return names[platform] || platform || 'Standard';
}

function formatPreset(preset) {
  // "2vcpu-8gb" → "2 vCPUs, 8 GiB"
  const m = preset.match(/^(\d+)vcpu-(\d+)gb$/i);
  if (m) return `${m[1]} vCPU${m[1] === '1' ? '' : 's'}, ${m[2]} GiB`;
  return preset;
}

function formatDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso), now = new Date(), diff = now - d;
  const mins = Math.floor(diff / 60000), hrs = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  if (hrs < 24) return hrs + 'h ago';
  if (days < 7) return days + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
}

function toggleKebab(btn) {
  const dd = btn.nextElementSibling;
  document.querySelectorAll('.kebab-dropdown').forEach(d => { if (d !== dd) d.classList.add('hidden'); });
  dd.classList.toggle('hidden');
}

// Close kebab menus on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.kebab-menu')) {
    document.querySelectorAll('.kebab-dropdown').forEach(d => d.classList.add('hidden'));
  }
});

// ── Theme Toggle ────────────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcons(next);
}

function updateThemeIcons(theme) {
  document.querySelectorAll('.theme-icon').forEach(el => {
    el.textContent = theme === 'dark' ? '☀️' : '🌙';
  });
}

// ── Toast Notifications ────────────────────────────────────────────────────
let _lastToastMsg = '';
let _lastToastTime = 0;
function showToast(message, type = 'info') {
  // Deduplicate rapid identical toasts
  const now = Date.now();
  if (message === _lastToastMsg && now - _lastToastTime < 3000) return;
  _lastToastMsg = message;
  _lastToastTime = now;

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const colors = { success: 'var(--green)', warning: 'var(--orange)', error: 'var(--red)', info: 'var(--text-dim)' };
  toast.style.cssText = `pointer-events:auto;padding:0.6rem 1rem;border-radius:var(--radius-sm);background:var(--bg-card);border:1px solid ${colors[type] || colors.info};color:var(--text);font-size:0.85rem;box-shadow:0 4px 12px rgba(0,0,0,0.2);opacity:0;transition:opacity 0.3s;`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateThemeIcons(document.documentElement.getAttribute('data-theme') || 'light');
  checkAuth();
  setupDelegatedListeners();
});

// ── Delegated event listeners (avoids inline onclick with user data) ──────────
function setupDelegatedListeners() {
  // Endpoint action buttons (Terminal, Dashboard, Delete)
  const endpointsList = document.getElementById('unified-instances-list') || document.getElementById('endpoints-list');
  if (!endpointsList) return;
  endpointsList.addEventListener('click', (e) => {
    // Handle copy button
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      e.stopPropagation();
      copyToClipboard(copyBtn.dataset.copy);
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const ip = btn.dataset.ip;
    const name = btn.dataset.name;
    const id = btn.dataset.id;
    const endpointId = btn.dataset.endpointId || null;
    const hasPublicIp = btn.dataset.hasPublicIp === 'true';
    const token = btn.dataset.token || null;

    switch (action) {
      case 'terminal': openTerminal(ip, name, endpointId, hasPublicIp); break;
      case 'dashboard': openDashboard(ip, name, token); break;
      case 'logs': openLogs(id, name); break;
      case 'stop': stopEndpoint(id, name); break;
      case 'start': startEndpoint(id, name); break;
      case 'delete': deleteEndpoint(id, name); break;
    }
  });

  // Endpoint search input
  const searchInput = document.getElementById('endpoint-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      endpointSearch = e.target.value.toLowerCase();
      renderEndpoints();
    });
  }

  // Endpoint filter tabs
  const filterContainer = document.getElementById('endpoint-filters');
  if (filterContainer) {
    filterContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-filter]');
      if (!tab) return;
      endpointFilter = tab.dataset.filter;
      filterContainer.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderEndpoints();
    });
  }

  // Model picker items
  document.getElementById('model-picker-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-model-id]');
    if (!item) return;
    selectTokenFactoryModel(item.dataset.modelId, item);
  });

  // MysteryBox secret items (delegated across all provider secret lists)
  document.addEventListener('click', (e) => {
    const item = e.target.closest('[data-secret-id]');
    if (!item || !item.closest('.mb-secrets-list')) return;
    selectMysteryBoxSecret(item.dataset.secretId, item);
  });

  // Copy button clicks
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      copyToClipboard(copyBtn.dataset.copy);
    }
  });

}

// ── Auth-aware fetch (auto re-authenticates on 401) ─────────────────────────
async function authFetch(url, options = {}) {
  let res = await fetch(url, options);
  if (res.status === 401) {
    try {
      const body = await res.clone().json();
      if (body.expired) {
        state.authenticated = false;
        updateIamStatus(false, null, 'Session expired — please reconnect your Nebius token.');
        showToast('Session expired. Reconnect on the Quick Start page.', 'warning');
        switchPage('deploy');
        return res;
      }
    } catch (e) {}
    const authRes = await fetch('/api/auth/status');
    const authData = await authRes.json();
    if (authData.authenticated) {
      res = await fetch(url, options);
    } else {
      state.authenticated = false;
      updateIamStatus(false, null, 'Not authenticated — connect your Nebius token to continue.');
      showToast('Connect your Nebius IAM token on the Quick Start page.', 'warning');
      switchPage('deploy');
    }
  }
  return res;
}

// ── CLI Login ────────────────────────────────────────────────────────────────
async function loginWithNebius() {
  showToast('Logging in via Nebius CLI...', 'info');
  try {
    const res = await fetch('/api/auth/cli-login', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.ok) {
      showToast('Logged in as ' + data.user, 'success');
      await checkAuth();
      await Promise.all([loadEndpoints(), loadRegistries()]);
    } else {
      showToast(data.error || 'Login failed', 'error');
    }
  } catch (err) {
    showToast('Login failed: ' + err.message, 'error');
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function checkAuth() {
  // Always show main app — no login screen
  show('main-app');
  show('bottom-dock');

  // Check for OAuth error in URL (redirect from callback)
  const params = new URLSearchParams(window.location.search);
  const authError = params.get('auth_error');
  if (authError) {
    showToast('Login failed: ' + authError, 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Check if OAuth login is available (localhost)
  try {
    const oauthRes = await fetch('/api/auth/can-oauth');
    const oauthData = await oauthRes.json();
    state.canOAuth = !!oauthData.canOAuth;
  } catch (e) { state.canOAuth = false; }

  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();

    if (data.authenticated) {
      state.authenticated = true;
      state.demo = !!data.demo;
      document.getElementById('user-info').textContent = data.user;
      const initials = (data.user || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      document.getElementById('user-avatar').textContent = initials;

      if (data.tokenExpiresIn != null && data.tokenExpiresIn < 1800 && !data.demo) {
        const mins = Math.floor(data.tokenExpiresIn / 60);
        showToast(`Session expires in ${mins} min`, 'warning');
      }

      if (state.demo) {
        showDemoBanner();
      } else {
        showPrototypeBanner();
      }

      updateIamStatus(true, data.user);
    } else {
      state.authenticated = false;
      state.demo = false;
      updateIamStatus(false);
    }
  } catch (err) {
    state.authenticated = false;
    updateIamStatus(false, null, 'Cannot reach server');
  }

  updateSidebarFooter();
  syncGsIamStatus();
  syncEpIamStatus();

  // Load UI config (these don't need auth)
  loadTargetCards();
  loadImages();
  loadModels();
  loadRegions();
  loadPlatformCards();
  loadStorageCards();
  loadSearchProviderCards();
  loadProviders();
  updateTargetVisibility();

  // Only load data that needs auth if actually authenticated
  if (state.authenticated) {
    loadEndpoints();
    loadMysteryBoxSecrets();
  }
}

// ── IAM Token (inline on Quick Start page) ─────────────────────────────────
function updateIamStatus(connected, user, error) {
  const el = document.getElementById('iam-token-status');
  const input = document.getElementById('iam-token-input');
  const btn = document.getElementById('iam-token-submit');
  const oauthRow = document.getElementById('deploy-oauth-row');
  const tokenRow = document.getElementById('deploy-token-row');
  const formHint = document.getElementById('deploy-form-hint');
  if (!el) return;

  if (connected) {
    el.innerHTML = `<span class="iam-connected"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Connected as <strong>${esc(user)}</strong></span>`;
    el.classList.remove('hidden');
    if (oauthRow) oauthRow.style.display = 'none';
    if (tokenRow) tokenRow.style.display = 'none';
    if (formHint) formHint.style.display = 'none';
    btn.textContent = 'Reconnect';
    btn.onclick = () => { if (tokenRow) tokenRow.style.display = ''; if (formHint) formHint.style.display = ''; input.value = ''; input.focus(); btn.textContent = 'Connect'; btn.onclick = submitIamToken; };
    // Add disconnect button if not already present
    let disconnectBtn = btn.parentElement.querySelector('.btn-disconnect');
    if (!disconnectBtn) {
      disconnectBtn = document.createElement('button');
      disconnectBtn.className = 'btn btn-sm btn-ghost btn-disconnect';
      disconnectBtn.textContent = 'Disconnect';
      disconnectBtn.onclick = logout;
      btn.parentElement.appendChild(disconnectBtn);
    }
    disconnectBtn.style.display = '';
  } else {
    if (error) {
      el.innerHTML = `<span class="iam-error">${esc(error)}</span>`;
      el.classList.remove('hidden');
    } else {
      el.innerHTML = '<span class="iam-hint">Connect your Nebius account to deploy endpoints</span>';
      el.classList.remove('hidden');
    }
    // Always show Login button as primary, token paste as fallback
    if (oauthRow) oauthRow.style.display = '';
    if (tokenRow) tokenRow.style.display = 'none';
    if (formHint) formHint.style.display = 'none';
    btn.textContent = 'Connect';
    btn.onclick = submitIamToken;
    const disconnectBtn = btn.parentElement?.querySelector('.btn-disconnect');
    if (disconnectBtn) disconnectBtn.style.display = 'none';
  }
}

async function submitIamToken() {
  const input = document.getElementById('iam-token-input');
  const token = input.value.trim();
  if (!token) { input.focus(); return; }

  const btn = document.getElementById('iam-token-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verifying...';

  try {
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (data.authenticated) {
      input.value = '';
      state.authenticated = true;
      state.demo = false;
      document.getElementById('user-info').textContent = data.user;
      const initials = (data.user || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      document.getElementById('user-avatar').textContent = initials;
      updateIamStatus(true, data.user);
      updateSidebarFooter();
      showToast('Connected to Nebius', 'success');
      loadEndpoints();
      loadMysteryBoxSecrets();
    } else {
      updateIamStatus(false, null, data.error || 'Invalid token');
    }
  } catch (err) {
    updateIamStatus(false, null, 'Connection error: ' + err.message);
  }

  btn.disabled = false;
  btn.innerHTML = 'Connect';
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.authenticated = false;
  state.demo = false;
  updateIamStatus(false);
  updateSidebarFooter();
  showToast('Disconnected from Nebius', 'info');
}

// ── Getting Started IAM Token ──────────────────────────────────────────────
async function submitGsIamToken() {
  const input = document.getElementById('gs-iam-token-input');
  const token = input.value.trim();
  if (!token) { input.focus(); return; }

  const btn = document.getElementById('gs-iam-token-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (data.authenticated) {
      input.value = '';
      state.authenticated = true;
      state.demo = false;
      document.getElementById('user-info').textContent = data.user;
      const initials = (data.user || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      document.getElementById('user-avatar').textContent = initials;
      updateIamStatus(true, data.user);
      updateSidebarFooter();
      syncGsIamStatus();
      showToast('Connected to Nebius', 'success');
      loadEndpoints();
      loadMysteryBoxSecrets();
    } else {
      const el = document.getElementById('gs-iam-token-status');
      if (el) el.innerHTML = `<span class="iam-error">${esc(data.error || 'Invalid token')}</span>`;
    }
  } catch (err) {
    const el = document.getElementById('gs-iam-token-status');
    if (el) el.innerHTML = `<span class="iam-error">Connection error: ${esc(err.message)}</span>`;
  }

  btn.disabled = false;
  btn.innerHTML = 'Connect';
}

function syncGsIamStatus() {
  const el = document.getElementById('gs-iam-token-status');
  const input = document.getElementById('gs-iam-token-input');
  const btn = document.getElementById('gs-iam-token-submit');
  const oauthRow = document.getElementById('gs-oauth-row');
  const tokenRow = document.getElementById('gs-token-row');
  if (!el) return;

  if (state.authenticated) {
    const user = document.getElementById('user-info')?.textContent || 'Connected';
    el.innerHTML = `<span class="iam-connected"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Connected as <strong>${esc(user)}</strong></span>`;
    if (oauthRow) oauthRow.style.display = 'none';
    if (tokenRow) tokenRow.style.display = 'none';
    if (btn) {
      btn.textContent = 'Reconnect';
      btn.onclick = () => { if (tokenRow) tokenRow.style.display = ''; input.value = ''; input.focus(); btn.textContent = 'Connect'; btn.onclick = submitGsIamToken; };
      let dc = btn.parentElement.querySelector('.btn-disconnect');
      if (!dc) { dc = document.createElement('button'); dc.className = 'btn btn-sm btn-ghost btn-disconnect'; dc.textContent = 'Disconnect'; dc.onclick = logout; btn.parentElement.appendChild(dc); }
      dc.style.display = '';
    }
  } else {
    el.innerHTML = '';
    // Always show Login button as primary, token paste as fallback
    if (oauthRow) oauthRow.style.display = '';
    if (tokenRow) tokenRow.style.display = 'none';
    if (btn) { btn.textContent = 'Connect'; btn.onclick = submitGsIamToken; const dc = btn.parentElement?.querySelector('.btn-disconnect'); if (dc) dc.style.display = 'none'; }
  }
}

// ── Sidebar Footer State ───────────────────────────────────────────────────
function updateSidebarFooter() {
  const connected = document.getElementById('sidebar-footer-connected');
  const disconnected = document.getElementById('sidebar-footer-disconnected');
  if (!connected || !disconnected) return;
  if (state.authenticated) {
    connected.style.display = '';
    disconnected.style.display = 'none';
  } else {
    connected.style.display = 'none';
    disconnected.style.display = '';
  }
}

// ── Section Toggle ─────────────────────────────────────────────────────────
function toggleSection(sectionId) {
  const body = document.getElementById(sectionId);
  if (!body) return;
  const header = body.previousElementSibling;
  body.classList.toggle('collapsed');
  if (header) header.classList.toggle('collapsed');
}

// ── Endpoints Page IAM Token ───────────────────────────────────────────────
function syncEpIamStatus() {
  const el = document.getElementById('ep-iam-token-status');
  const input = document.getElementById('ep-iam-token-input');
  const btn = document.getElementById('ep-iam-token-submit');
  const connStatus = document.getElementById('nebius-connection-status');
  const oauthRow = document.getElementById('ep-oauth-row');
  const tokenRow = document.getElementById('ep-token-row');
  if (!el) return;

  const formHint = document.getElementById('ep-form-hint');

  if (state.authenticated) {
    const user = document.getElementById('user-info')?.textContent || 'Connected';
    el.innerHTML = `<span class="iam-connected"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Connected as <strong>${esc(user)}</strong></span>`;
    if (oauthRow) oauthRow.style.display = 'none';
    if (tokenRow) tokenRow.style.display = 'none';
    if (formHint) formHint.style.display = 'none';
    if (btn) {
      btn.textContent = 'Reconnect';
      btn.onclick = () => { if (tokenRow) tokenRow.style.display = ''; if (formHint) formHint.style.display = ''; input.value = ''; input.focus(); btn.textContent = 'Connect'; btn.onclick = submitEpIamToken; };
      let dc = btn.parentElement.querySelector('.btn-disconnect');
      if (!dc) { dc = document.createElement('button'); dc.className = 'btn btn-sm btn-ghost btn-disconnect'; dc.textContent = 'Disconnect'; dc.onclick = logout; btn.parentElement.appendChild(dc); }
      dc.style.display = '';
    }
    if (connStatus) connStatus.innerHTML = '<span class="status-dot status-dot-green"></span> Connected';
  } else {
    el.innerHTML = '<span class="iam-hint">Connect your Nebius account to manage cloud endpoints</span>';
    // Show Login button as primary, token paste as fallback
    if (oauthRow) oauthRow.style.display = '';
    if (tokenRow) tokenRow.style.display = 'none';
    if (formHint) formHint.style.display = 'none';
    if (btn) { btn.textContent = 'Connect'; btn.onclick = submitEpIamToken; const dc = btn.parentElement?.querySelector('.btn-disconnect'); if (dc) dc.style.display = 'none'; }
    if (connStatus) connStatus.innerHTML = '<span class="status-dot status-dot-dim"></span> Not connected';
  }
}

async function submitEpIamToken() {
  const input = document.getElementById('ep-iam-token-input');
  const token = input.value.trim();
  if (!token) { input.focus(); return; }

  const btn = document.getElementById('ep-iam-token-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (data.authenticated) {
      input.value = '';
      state.authenticated = true;
      state.demo = false;
      document.getElementById('user-info').textContent = data.user;
      const initials = (data.user || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      document.getElementById('user-avatar').textContent = initials;
      updateIamStatus(true, data.user);
      syncEpIamStatus();
      updateSidebarFooter();
      showToast('Connected to Nebius', 'success');
      loadEndpoints();
      loadMysteryBoxSecrets();
    } else {
      const el = document.getElementById('ep-iam-token-status');
      el.innerHTML = `<span class="iam-error">${esc(data.error || 'Invalid token')}</span>`;
    }
  } catch (err) {
    const el = document.getElementById('ep-iam-token-status');
    el.innerHTML = `<span class="iam-error">Connection error: ${esc(err.message)}</span>`;
  }

  btn.disabled = false;
  btn.innerHTML = 'Connect';
}

// ── Local Instances ────────────────────────────────────────────────────────
let localInstancesCache = [];
let localGatewayAvailable = false;

let localGatewayInfo = null;

function updateGatewayBadge() {
  const total = endpointsCache.length + localInstancesCache.length + (localGatewayAvailable ? 1 : 0);
  const badge = document.getElementById('endpoints-count');
  const dockBadge = document.getElementById('dock-endpoints-count');
  if (total > 0) {
    if (badge) { badge.textContent = total; badge.classList.remove('hidden'); }
    if (dockBadge) { dockBadge.textContent = total; dockBadge.classList.remove('hidden'); }
  } else {
    if (badge) badge.classList.add('hidden');
    if (dockBadge) dockBadge.classList.add('hidden');
  }
}

async function loadLocalInstances() {
  const list = document.getElementById('unified-instances-list');
  if (!list) return;
  if (endpointsCache.length === 0 && localInstancesCache.length === 0) {
    list.innerHTML = '<div class="mb-loading"><span class="spinner"></span> Scanning...</div>';
  }

  try {
    const res = await fetch('/api/local-instances');
    const data = await res.json();
    localGatewayAvailable = data.gatewayAvailable;
    localGatewayInfo = data.gateway || null;
    localInstancesCache = data.instances || [];
    updateGatewayBadge();
    loadChatGateways();
    renderUnifiedInstances();
  } catch (err) {
    renderUnifiedInstances();
  }
}

function loadChatGateways() {
  const select = document.getElementById('chat-gateway-select');
  if (!select) return;

  // Remember current selection
  const prev = select.value;

  // Clear and add default option
  select.innerHTML = '<option value="">Deploy Assistant</option>';

  // Add local gateway
  if (localGatewayAvailable && localGatewayInfo) {
    const h = localGatewayInfo.health || {};
    const val = JSON.stringify({ type: 'local', name: 'Local Gateway', ip: '127.0.0.1', model: h.model || '' });
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `🖥️ Local Gateway${h.model ? ' — ' + h.model : ''}`;
    select.appendChild(opt);
  }

  // Add local presence instances
  localInstancesCache.forEach(inst => {
    if (inst.mode === 'gateway' || inst.mode === 'webchat') {
      const val = JSON.stringify({ type: 'local', name: inst.instanceId || inst.ip, ip: inst.ip, model: inst.modelIdentifier || '' });
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = `💬 ${inst.instanceId || inst.ip}${inst.modelIdentifier ? ' — ' + inst.modelIdentifier : ''}`;
      select.appendChild(opt);
    }
  });

  // Add cloud endpoints
  endpointsCache.forEach(ep => {
    if (ep.state !== 'RUNNING') return;
    const ip = ep.publicIp || ep.privateIp;
    if (!ip) return;
    const val = JSON.stringify({ type: 'cloud', name: ep.name, ip, model: ep.model || '', region: ep.region || '' });
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `☁️ ${ep.name}${ep.model ? ' — ' + ep.model : ''}${ep.regionFlag ? ' ' + ep.regionFlag : ''}`;
    select.appendChild(opt);
  });

  // Restore previous selection if still available
  if (prev) {
    for (const opt of select.options) {
      if (opt.value === prev) { select.value = prev; return; }
    }
  }
}

function renderUnifiedInstances() {
  const list = document.getElementById('unified-instances-list');
  if (!list) return;

  const cards = [];

  // Local gateway card
  if (localGatewayAvailable && localGatewayInfo) {
    const gwUrl = esc(localGatewayInfo.url || `http://${localGatewayInfo.host}:${localGatewayInfo.port}`);
    const gwHost = esc(localGatewayInfo.host || '127.0.0.1');
    cards.push(`
      <div class="instance-card" onclick="toggleInstanceExpand(this, event)">
        <div class="instance-icon">🖥️</div>
        <div class="instance-info">
          <div class="instance-name">${gwHost} <span class="instance-ip">(${esc(localGatewayInfo.host)}:${esc(String(localGatewayInfo.port))})</span></div>
          <div class="instance-meta">
            <span class="instance-status"><span class="status-dot status-dot-green"></span> Active</span>
            <span class="instance-meta-sep">·</span>
            <span class="instance-role role-gateway">gateway</span>
            <span class="instance-meta-sep">·</span> local
          </div>
        </div>
        <div class="instance-actions">
          <button class="btn btn-sm btn-action-pill btn-terminal" onclick="openTerminal('${esc(localGatewayInfo.host)}','gateway')">Terminal</button>
          <a href="${gwUrl}" target="_blank" class="btn btn-sm btn-action-pill btn-dashboard">Dashboard</a>
        </div>
        <div class="instance-details">
          <div class="instance-details-grid">
            <div class="instance-detail"><span class="instance-detail-label">Type</span><span class="instance-detail-value">Gateway</span></div>
            <div class="instance-detail"><span class="instance-detail-label">Host</span><span class="instance-detail-value"><code>${esc(localGatewayInfo.host)}</code></span></div>
            <div class="instance-detail"><span class="instance-detail-label">Port</span><span class="instance-detail-value"><code>${esc(String(localGatewayInfo.port))}</code></span></div>
            <div class="instance-detail"><span class="instance-detail-label">URL</span><span class="instance-detail-value"><code>${gwUrl}</code> <button class="copy-btn" onclick="navigator.clipboard.writeText('${gwUrl}');event.stopPropagation()">📋</button></span></div>
            ${localGatewayInfo.health?.status ? `<div class="instance-detail"><span class="instance-detail-label">Health</span><span class="instance-detail-value">${esc(localGatewayInfo.health.status)}</span></div>` : ''}
          </div>
        </div>
      </div>`);
  }

  // Local presence instances
  cards.push(...localInstancesCache.map(inst => {
    const name = esc(inst.host || inst.instanceId || 'Unknown');
    const ip = esc(inst.ip || '');
    const version = esc(inst.version || '');
    const device = esc(inst.deviceFamily || '');
    const model = esc(inst.modelIdentifier || '');
    const mode = esc(inst.mode || 'unknown');
    const ageMs = inst.ts ? Date.now() - inst.ts : null;
    const isActive = ageMs !== null && ageMs < 300000;
    const statusClass = isActive ? 'status-dot-green' : 'status-dot-dim';
    const statusText = isActive ? 'Active' : 'Stale';

    const icon = mode === 'gateway' ? '🖥️' : mode === 'webchat' ? '💬' : mode === 'node' ? '📱' : '💻';
    const roleColors = { gateway: 'role-gateway', node: 'role-node', webchat: 'role-webchat', local: 'role-local', ui: 'role-ui' };
    const roleClass = roleColors[mode] || 'role-default';
    const metaParts = [version, device && model ? `${device} · ${model}` : device || model].filter(Boolean);

    const ageFmt = ageMs !== null ? (ageMs < 60000 ? Math.floor(ageMs / 1000) + 's ago' : Math.floor(ageMs / 60000) + 'm ago') : '';

    return `
      <div class="instance-card" onclick="toggleInstanceExpand(this, event)">
        <div class="instance-icon">${icon}</div>
        <div class="instance-info">
          <div class="instance-name">${name}${ip ? ` <span class="instance-ip">(${ip})</span>` : ''}</div>
          <div class="instance-meta">
            <span class="instance-status"><span class="status-dot ${statusClass}"></span> ${statusText}</span>
            ${metaParts.length ? '<span class="instance-meta-sep">·</span> ' + esc(metaParts.join(' · ')) : ''}
            <span class="instance-role ${roleClass}">${mode}</span>
            <span class="instance-meta-sep">·</span> local
          </div>
        </div>
        <div class="instance-actions">
          ${ip ? `<button class="btn btn-sm btn-action-pill btn-terminal" onclick="openTerminal('${ip}','${name}')">Terminal</button>` : ''}
          ${ip ? `<a href="http://${ip}:18789/" target="_blank" class="btn btn-sm btn-action-pill btn-dashboard">Dashboard</a>` : ''}
        </div>
        <div class="instance-details">
          <div class="instance-details-grid">
            <div class="instance-detail"><span class="instance-detail-label">Mode</span><span class="instance-detail-value">${mode}</span></div>
            ${ip ? `<div class="instance-detail"><span class="instance-detail-label">IP</span><span class="instance-detail-value"><code>${ip}</code> <button class="copy-btn" onclick="navigator.clipboard.writeText('${ip}');event.stopPropagation()">📋</button></span></div>` : ''}
            ${version ? `<div class="instance-detail"><span class="instance-detail-label">Version</span><span class="instance-detail-value">${version}</span></div>` : ''}
            ${device ? `<div class="instance-detail"><span class="instance-detail-label">Device</span><span class="instance-detail-value">${device}${model ? ' · ' + model : ''}</span></div>` : ''}
            ${ageFmt ? `<div class="instance-detail"><span class="instance-detail-label">Last Seen</span><span class="instance-detail-value">${ageFmt}</span></div>` : ''}
          </div>
        </div>
      </div>`;
  }));

  // Cloud endpoints as instance cards
  cards.push(...endpointsCache.map(ep => {
    const name = esc(ep.name || ep.id);
    const ip = esc(ep.publicIp || ep.privateIp || '');
    const isRunning = ep.state === 'RUNNING';
    const statusClass = isRunning ? 'status-dot-green' : (ep.state === 'STARTING' || ep.state === 'CREATING') ? 'status-dot-orange' : 'status-dot-dim';
    const statusText = formatState(ep.state);
    const regionInfo = ep.regionFlag ? `${ep.regionFlag} ${esc(ep.regionName || ep.region)}` : esc(ep.region || '');
    const modelInfo = ep.health?.model || ep.model || '';

    const icon = (ep.image || '').includes('nemoclaw') ? '🔱' : '🦞';

    const platformInfo = ep.platform ? formatPlatform(ep.platform) : '';
    const presetInfo = ep.preset ? formatPreset(ep.preset) : '';
    const imageInfo = ep.image || '';
    const healthService = ep.health?.service || '';
    const healthInference = ep.health?.inference || '';

    return `
      <div class="instance-card" data-endpoint-id="${esc(ep.id)}" onclick="toggleInstanceExpand(this, event)">
        <div class="instance-icon">${icon}</div>
        <div class="instance-info">
          <div class="instance-name">${name}${ip ? ` <span class="instance-ip">(${ip})</span>` : ''}</div>
          <div class="instance-meta">
            <span class="instance-status"><span class="status-dot ${statusClass}"></span> ${statusText}</span>
            ${modelInfo ? `<span class="instance-meta-sep">·</span> ${esc(modelInfo)}` : ''}
            ${regionInfo ? `<span class="instance-meta-sep">·</span> ${regionInfo}` : ''}
            <span class="instance-role role-node">cloud</span>
            ${ep.createdAt ? `<span class="instance-meta-sep">·</span> <span class="instance-age">${formatDate(ep.createdAt)}</span>` : ''}
          </div>
        </div>
        <div class="instance-actions">
          ${isRunning && ip ? `<button class="btn btn-sm btn-action-pill btn-terminal" onclick="openTerminal('${esc(ip)}','${esc(ep.name)}','${esc(ep.id)}',${!!ep.publicIp})">Terminal</button>` : ''}
          ${isRunning && ip ? `<a href="http://${esc(ip)}:18789/" target="_blank" class="btn btn-sm btn-action-pill btn-dashboard">Dashboard</a>` : ''}
          <div class="instance-kebab">
            <button class="instance-kebab-btn" onclick="toggleInstanceMenu(this, event)">&#x22EE;</button>
            <div class="instance-menu hidden">
              ${isRunning
                ? `<button class="instance-menu-item" onclick="stopEndpoint('${esc(ep.id)}','${esc(ep.name)}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                    Stop
                  </button>`
                : `<button class="instance-menu-item" onclick="startEndpoint('${esc(ep.id)}','${esc(ep.name)}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Start
                  </button>`
              }
              <button class="instance-menu-item danger" onclick="deleteEndpoint('${esc(ep.id)}','${esc(ep.name)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                Delete
              </button>
            </div>
          </div>
        </div>
        <div class="instance-details">
          <div class="instance-details-grid">
            <div class="instance-detail"><span class="instance-detail-label">ID</span><span class="instance-detail-value"><code>${esc(ep.id)}</code> <button class="copy-btn" onclick="navigator.clipboard.writeText('${esc(ep.id)}');event.stopPropagation()">📋</button></span></div>
            ${ip ? `<div class="instance-detail"><span class="instance-detail-label">IP Address</span><span class="instance-detail-value"><code>${ip}</code> <button class="copy-btn" onclick="navigator.clipboard.writeText('${ip}');event.stopPropagation()">📋</button></span></div>` : ''}
            ${regionInfo ? `<div class="instance-detail"><span class="instance-detail-label">Region</span><span class="instance-detail-value">${regionInfo}</span></div>` : ''}
            ${platformInfo ? `<div class="instance-detail"><span class="instance-detail-label">Platform</span><span class="instance-detail-value">${esc(platformInfo)}</span></div>` : ''}
            ${presetInfo ? `<div class="instance-detail"><span class="instance-detail-label">Resources</span><span class="instance-detail-value">${esc(presetInfo)}</span></div>` : ''}
            ${modelInfo ? `<div class="instance-detail"><span class="instance-detail-label">Model</span><span class="instance-detail-value">${esc(modelInfo)}</span></div>` : ''}
            ${healthService ? `<div class="instance-detail"><span class="instance-detail-label">Service</span><span class="instance-detail-value">${esc(healthService)}</span></div>` : ''}
            ${healthInference ? `<div class="instance-detail"><span class="instance-detail-label">Inference</span><span class="instance-detail-value">${esc(healthInference)}</span></div>` : ''}
            ${imageInfo ? `<div class="instance-detail"><span class="instance-detail-label">Image</span><span class="instance-detail-value"><code style="font-size:0.65rem">${esc(imageInfo)}</code></span></div>` : ''}
            ${ep.createdAt ? `<div class="instance-detail"><span class="instance-detail-label">Created</span><span class="instance-detail-value">${formatDate(ep.createdAt)}</span></div>` : ''}
          </div>
        </div>
      </div>`;
  }));

  if (cards.length === 0) {
    list.innerHTML = '<p class="empty-state">No gateways found. Deploy one or start a local gateway.</p>';
  } else {
    list.innerHTML = cards.join('');
  }
}

function refreshAllEndpoints() {
  loadLocalInstances();
  if (state.authenticated) loadEndpoints();
}

function toggleInstanceExpand(card, event) {
  // Don't expand when clicking buttons, links, or menus
  if (event.target.closest('a, button, .instance-kebab, .instance-menu')) return;
  card.classList.toggle('expanded');
}

function toggleInstanceMenu(btn, event) {
  event.stopPropagation();
  const menu = btn.nextElementSibling;
  // Close all other menus
  document.querySelectorAll('.instance-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
  menu.classList.toggle('hidden');
}

// Close instance menus on outside click
document.addEventListener('click', () => {
  document.querySelectorAll('.instance-menu').forEach(m => m.classList.add('hidden'));
});

// ── Page Navigation ─────────────────────────────────────────────────────────
function switchPage(page) {
  // Update sidebar nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update bottom dock items
  document.querySelectorAll('.dock-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Show/hide pages
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove('hidden');

  // Refresh data when switching pages
  if (page === 'endpoints') {
    loadLocalInstances();
    if (state.authenticated) loadEndpoints();
    syncEpIamStatus();
  }
  if (page === 'chat') { loadChatGateways(); initChat(); }

}

// ── Load Images ──────────────────────────────────────────────────────────────
async function loadImages() {
  try {
    const res = await authFetch('/api/images');
    const images = await res.json();
    const grid = document.getElementById('image-cards');
    grid.innerHTML = '';

    const keys = Object.keys(images);
    for (const [key, img] of Object.entries(images)) {
      const card = document.createElement('div');
      card.className = 'select-card';
      card.dataset.key = key;
      const sourceHtml = img.sourceUrl
        ? `<div class="card-source">${esc(img.sourceUrl)}</div>`
        : '';
      card.innerHTML = `
        <div class="card-icon">${key === 'openclaw' ? '<img src="/favicon.svg" alt="OpenClaw" class="card-icon-img">' : key === 'nemoclaw' ? '<img src="/nvidia.svg" alt="NemoClaw" class="card-icon-img">' : key === 'custom' ? '<img src="/docker.png" alt="Custom" class="card-icon-img">' : esc(img.icon)}</div>
        <div class="card-title">${esc(img.name)}</div>
        <div class="card-desc">${esc(img.description)}</div>
        ${sourceHtml}
      `;
      card.onclick = () => selectImage(key);
      grid.appendChild(card);
    }

    // Default: select first image (OpenClaw)
    if (keys.length > 0 && !state.selectedImage) {
      selectImage(keys[0]);
    }
  } catch (err) {
    console.error('Failed to load images:', err);
  }
}

// NemoClaw minimum requirements (from docs.nvidia.com/nemoclaw)
const AGENT_REQUIREMENTS = {
  openclaw: {
    label: 'OpenClaw Minimum Requirements',
    minVcpu: 2,
    minRamGb: 4,
    minDiskGb: 10,
    recommendedRamGb: 8,
    recommendedDiskGb: 20,
    note: 'Image is ~400 MB compressed.'
  },
  nemoclaw: {
    label: 'NemoClaw Minimum Requirements',
    minVcpu: 4,
    minRamGb: 8,
    minDiskGb: 20,
    recommendedRamGb: 16,
    recommendedDiskGb: 40,
    note: 'Image is ~2.4 GB compressed. Machines with <8 GB RAM may need swap configured.'
  }
};

// Back-compat alias
const NEMOCLAW_REQUIREMENTS = AGENT_REQUIREMENTS.nemoclaw;

function selectImage(key) {
  state.selectedImage = key;

  // Update card selection
  document.querySelectorAll('#image-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.key === key);
  });

  // Show/hide custom image input
  const customInput = document.getElementById('custom-image-input');
  if (key === 'custom') {
    customInput.classList.remove('hidden');
    loadRegistryImagesForPicker();
    initBuildDialog();
  } else {
    customInput.classList.add('hidden');
  }

  updateAgentRequirements();
  updateDeployButton();
}

function updateAgentRequirements() {
  const notice = document.getElementById('agent-requirements');
  if (!notice) return;

  const agent = state.selectedImage; // 'openclaw' | 'nemoclaw' | 'custom' | ...
  const isCustomCompute = state.selectedPlatform === 'custom';
  const reqs = AGENT_REQUIREMENTS[agent];

  if (reqs && isCustomCompute) {
    notice.innerHTML = `
      <div class="nemoclaw-req-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <strong>${esc(reqs.label)}</strong>
      </div>
      <div class="nemoclaw-req-grid">
        <div class="nemoclaw-req-item"><span class="nemoclaw-req-label">CPU</span><span class="nemoclaw-req-value">${reqs.minVcpu}+ vCPU</span></div>
        <div class="nemoclaw-req-item"><span class="nemoclaw-req-label">RAM</span><span class="nemoclaw-req-value">${reqs.minRamGb} GB min · ${reqs.recommendedRamGb} GB recommended</span></div>
        <div class="nemoclaw-req-item"><span class="nemoclaw-req-label">Disk</span><span class="nemoclaw-req-value">${reqs.minDiskGb} GB min · ${reqs.recommendedDiskGb} GB recommended</span></div>
      </div>
      <p class="nemoclaw-req-note">${esc(reqs.note)}</p>
    `;
    notice.classList.remove('hidden');
  } else {
    notice.classList.add('hidden');
  }
}

async function loadRegistryImagesForPicker() {
  const list = document.getElementById('registry-image-list');
  list.innerHTML = '<div class="mb-loading"><span class="spinner"></span> Loading registry images...</div>';

  try {
    // First load registries if we don't have them cached
    if (registriesCache.length === 0) {
      const regRes = await authFetch('/api/registries');
      if (regRes.ok) registriesCache = await regRes.json();
    }

    if (registriesCache.length === 0) {
      list.innerHTML = '<div style="padding:0.5rem"><button class="btn btn-primary btn-sm btn-oauth-login" onclick="loginWithNebius()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Login with Nebius</button><div class="text-dim" style="font-size:0.75rem;margin-top:0.35rem">Login to see your container registries.</div></div>';
      return;
    }

    // Fetch images from all registries in parallel
    const allImages = [];
    await Promise.all(registriesCache.map(async (reg) => {
      try {
        const res = await authFetch(`/api/registries/${encodeURIComponent(reg.id)}/images?profile=${encodeURIComponent(reg.region)}`);
        if (!res.ok) return;
        const images = await res.json();
        for (const img of images) {
          const regId = reg.id.replace(/^registry-/, '');
          const fullUrl = `cr.${reg.region}.nebius.cloud/${regId}/${img.name}`;
          const taggedUrl = img.tags?.length ? `${fullUrl}:${img.tags[0]}` : `${fullUrl}:latest`;
          allImages.push({
            name: img.name,
            url: taggedUrl,
            tags: img.tags || [],
            region: reg.region,
            regionFlag: reg.regionFlag || '🌍',
            regionName: reg.regionName
          });
        }
      } catch (_) {}
    }));

    if (allImages.length === 0) {
      list.innerHTML = '<div class="text-dim" style="font-size:0.8rem;padding:0.5rem">No images found in registries. Build one on the Docker Registry page.</div>';
      return;
    }

    const currentUrl = document.getElementById('custom-image-url').value.trim();
    list.innerHTML = allImages.map(img => `
      <div class="reg-img-item${currentUrl === img.url ? ' selected' : ''}" onclick="selectRegistryImage(this, '${esc(img.url)}')">
        <span class="ri-icon">${img.regionFlag}</span>
        <div>
          <div class="ri-name">${esc(img.name)}</div>
          <div class="ri-url">${esc(img.url)}</div>
        </div>
        <div class="ri-tags">
          ${img.tags.slice(0, 3).map(t => `<span class="ri-tag">${esc(t)}</span>`).join('')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="text-dim" style="font-size:0.8rem;padding:0.5rem">Failed to load: ${esc(err.message)}</div>`;
  }
}

function selectRegistryImage(el, url) {
  document.getElementById('custom-image-url').value = url;
  document.querySelectorAll('.reg-img-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  updateDeployButton();
}

// ── Load Models ──────────────────────────────────────────────────────────────
const FEATURED_MODELS = {
  'zai-org/GLM-5': {
    name: 'GLM-5',
    icon: '🧠',
    description: 'GLM-5 — latest generation reasoning model from Zhipu AI'
  },
  'MiniMaxAI/MiniMax-M2.5': {
    name: 'MiniMax M2.5',
    icon: '⚡',
    description: 'MiniMax-M2.5 — fast, powerful open-source model'
  }
};

function loadModels() {
  const grid = document.getElementById('model-cards');
  grid.innerHTML = '';

  // Featured model cards
  for (const [modelId, info] of Object.entries(FEATURED_MODELS)) {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.dataset.key = modelId;
    card.innerHTML = `
      <div class="card-icon">${esc(info.icon)}</div>
      <div class="card-title">${esc(info.name)}</div>
      <div class="card-desc">${esc(info.description)}</div>
    `;
    card.onclick = () => selectModel(modelId);
    grid.appendChild(card);
  }

  // "Other" card
  const otherCard = document.createElement('div');
  otherCard.className = 'select-card';
  otherCard.dataset.key = '_other';
  otherCard.innerHTML = `
    <div class="card-icon">📋</div>
    <div class="card-title">Other</div>
    <div class="card-desc">Browse all Token Factory models</div>
  `;
  otherCard.onclick = () => selectModel('_other');
  grid.appendChild(otherCard);

  // Default: select GLM-5
  const defaultModel = Object.keys(FEATURED_MODELS)[0]; // 'zai-org/GLM-5'
  if (defaultModel && !state.selectedModel) {
    selectModel(defaultModel);
  }
}

function selectModel(key) {
  const picker = document.getElementById('model-picker');

  if (key === '_other') {
    // Show model picker, load models from Token Factory
    picker.classList.remove('hidden');
    loadTokenFactoryModels();
    // Don't set state yet — user picks from the list
    state.selectedModel = null;
  } else {
    picker.classList.add('hidden');
    state.selectedModel = key;
  }

  // Update card selection
  document.querySelectorAll('#model-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.key === key);
  });

  updateDeployButton();
}

async function loadTokenFactoryModels() {
  const list = document.getElementById('model-picker-list');
  list.innerHTML = '<div class="mb-loading"><span class="spinner"></span> Loading models from Token Factory...</div>';

  try {
    // Send API key via POST body (not query params) for security
    const apiKey = document.getElementById('tf-api-key')?.value || '';
    const res = await authFetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, region: state.selectedRegion || '' })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to load models');
    }
    const models = await res.json();

    if (models.length === 0) {
      list.innerHTML = '<div class="mb-empty">No models available</div>';
      return;
    }

    list.innerHTML = models.map(m => {
      // Extract org from model ID (e.g., "deepseek-ai/DeepSeek-R1" → "deepseek-ai")
      const org = m.id.includes('/') ? m.id.split('/')[0] : '';
      const shortName = m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id;
      // Show owned_by only if it's meaningful (not "system")
      const owner = m.owned_by && m.owned_by !== 'system' ? m.owned_by : org;
      return `
        <div class="model-item ${state.selectedModel === m.id ? 'selected' : ''}" data-model-id="${esc(m.id)}">
          <div class="model-item-info">
            <div class="model-item-name">${esc(shortName)}</div>
            ${owner ? `<div class="model-item-owner">${esc(owner)}</div>` : ''}
          </div>
          <span class="model-item-badge">select</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = `
      <div class="model-picker-auth">
        <p class="text-dim" style="font-size:0.85rem;margin:0 0 0.5rem">Enter your Token Factory API key to browse models</p>
        <div class="api-key-row" style="max-width:500px">
          <input type="password" id="model-picker-api-key" placeholder="Paste Token Factory API key (starts with v1.)" onkeydown="if(event.key==='Enter')retryLoadModelsWithKey()" autocomplete="off" />
          <button class="btn btn-sm btn-primary" onclick="retryLoadModelsWithKey()">Load Models</button>
        </div>
        <span class="form-hint" style="margin-top:0.25rem;display:block">Get a key at <strong>tokenfactory.nebius.com</strong></span>
      </div>`;
  }
}

function retryLoadModelsWithKey() {
  const keyInput = document.getElementById('model-picker-api-key');
  const key = keyInput?.value?.trim();
  if (!key) { keyInput?.focus(); return; }
  // Set the TF API key field so loadTokenFactoryModels picks it up
  const tfInput = document.getElementById('tf-api-key');
  if (tfInput) tfInput.value = key;
  loadTokenFactoryModels();
}

function selectTokenFactoryModel(modelId, el) {
  state.selectedModel = modelId;

  // Update selection in the list
  document.querySelectorAll('.model-item').forEach(item => {
    item.classList.remove('selected');
  });
  if (el) el.classList.add('selected');

  // Update badge
  const badge = el?.querySelector('.model-item-badge');
  if (badge) {
    badge.textContent = '\u2713 selected';
    badge.classList.add('active');
  }

  updateDeployButton();
}

// ── Load Regions ─────────────────────────────────────────────────────────────
const REGIONS = {
  'eu-north1':   { name: 'EU North (Finland)', flag: '🇫🇮' },
  'eu-west1':    { name: 'EU West (Paris)',     flag: '🇫🇷' },
  'us-central1': { name: 'US Central',          flag: '🇺🇸' }
};

function loadRegions() {
  const grid = document.getElementById('region-cards');
  if (!grid) return;
  grid.innerHTML = '';

  const keys = Object.keys(REGIONS);
  for (const [key, region] of Object.entries(REGIONS)) {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.dataset.key = key;
    card.innerHTML = `
      <div class="card-icon">${esc(region.flag)}</div>
      <div class="card-title">${esc(region.name)}</div>
      <div class="card-desc">${esc(key)}</div>
    `;
    card.onclick = () => selectRegion(key);
    grid.appendChild(card);
  }

  if (keys.length > 0 && !state.selectedRegion) {
    selectRegion(keys[0]);
  }
}

function selectRegion(key) {
  state.selectedRegion = key;
  state.selectedProject = null;

  document.querySelectorAll('#region-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.key === key);
  });

  loadProjects(key);
  updateDeployButton();
}

async function loadProjects(region) {
  const container = document.getElementById('region-projects');
  if (!container) return;
  container.classList.remove('hidden');

  if (!state.authenticated) {
    container.innerHTML = '<p class="projects-hint">Connect your Nebius IAM token to see projects</p>';
    return;
  }

  container.innerHTML = '<div class="mb-loading"><span class="spinner"></span> Loading projects...</div>';

  try {
    const res = await authFetch(`/api/projects/${encodeURIComponent(region)}`);
    const data = await res.json();
    const projects = data.projects || [];

    if (projects.length === 0) {
      container.innerHTML = '<p class="projects-hint">No projects found in this region</p>';
      return;
    }

    container.innerHTML = projects.map(p => `
      <div class="project-item${state.selectedProject === p.id ? ' selected' : ''}" data-id="${esc(p.id)}" onclick="selectProject('${esc(p.id)}', '${esc(p.name)}')">
        <span class="project-name">${esc(p.name)}</span>
        <span class="project-id">${esc(p.id)}</span>
      </div>
    `).join('');

    // Auto-select first project if none selected
    if (!state.selectedProject && projects.length > 0) {
      selectProject(projects[0].id, projects[0].name);
    }
  } catch (err) {
    container.innerHTML = '<p class="projects-hint">Failed to load projects</p>';
  }
}

function selectProject(id, name) {
  state.selectedProject = id;
  state.selectedProjectName = name;

  document.querySelectorAll('.project-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });

  updateDeployButton();
}

// ── Platform Selection ───────────────────────────────────────────────────────

// ── Deploy Target ──────────────────────────────────────────────────────────
const DEPLOY_TARGETS = {
  'cloud': {
    icon: '☁️',
    name: 'Serverless Cloud',
    desc: 'Deploy to Nebius Cloud infrastructure'
  },
  'local': {
    icon: '💻',
    name: 'Local Computer',
    desc: 'Run directly on this machine'
  },
  'docker': {
    icon: '<img src="/docker.png" alt="Docker" class="card-icon-img">',
    name: 'Docker Container',
    desc: 'Run in a local Docker container'
  }
};

function loadTargetCards() {
  const grid = document.getElementById('target-cards');
  if (!grid) return;
  grid.innerHTML = '';
  for (const [key, target] of Object.entries(DEPLOY_TARGETS)) {
    const card = document.createElement('div');
    card.className = 'select-card' + (key === state.selectedTarget ? ' selected' : '');
    card.dataset.key = key;
    card.innerHTML = `
      <div class="card-icon">${target.icon}</div>
      <div class="card-title">${esc(target.name)}</div>
      <div class="card-desc">${esc(target.desc)}</div>
    `;
    card.onclick = () => selectTarget(key);
    grid.appendChild(card);
  }
}

function selectTarget(key) {
  state.selectedTarget = key;
  document.querySelectorAll('#target-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.key === key);
  });
  updateTargetVisibility();
  updateDeployButton();
}

function updateTargetVisibility() {
  const isCloud = state.selectedTarget === 'cloud';

  // Platform, Region, Network, Storage steps — cloud only
  document.getElementById('step-platform')?.classList.toggle('hidden', !isCloud);
  document.getElementById('step-region')?.classList.toggle('hidden', !isCloud);
  document.getElementById('step-network')?.classList.toggle('hidden', !isCloud);
  document.getElementById('step-storage')?.classList.toggle('hidden', !isCloud);
  // Provider step is always visible (all targets need an API provider)

  // IAM token is cloud-only; API keys are needed for all targets
  document.getElementById('iam-token-group')?.classList.toggle('hidden', !isCloud);
}

const PLATFORMS = {
  'cpu': {
    icon: '⚡',
    name: 'CPU Only',
    desc: 'from ~$36/mo · Best for API models'
  },
  'gpu': {
    icon: '🚀',
    name: 'GPU',
    desc: 'from $1.55/hr (L40S) · H100 · H200'
  },
  'custom': {
    icon: '⚙️',
    name: 'Custom',
    desc: 'Choose vCPUs, RAM, GPU model'
  }
};

const PLATFORM_PRICES = {
  'gpu-l40s':     { perGpu: 1.55, label: 'L40S' },
  'gpu-l40s-a':   { perGpu: 1.82, label: 'L40S' },
  'gpu-h100-sxm': { perGpu: 2.95, label: 'H100' },
  'gpu-h100-b':   { perGpu: 2.95, label: 'H100' },
  'gpu-h200-sxm': { perGpu: 3.50, label: 'H200' },
  'cpu-e2':       { perVcpu: 0.025, label: 'Intel Ice Lake' },
  'cpu-d3':       { perVcpu: 0.025, label: 'AMD EPYC' }
};

function loadPlatformCards() {
  const grid = document.getElementById('platform-cards');
  grid.innerHTML = '';
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const card = document.createElement('div');
    card.className = 'select-card' + (key === state.selectedPlatform ? ' selected' : '');
    card.dataset.key = key;
    card.innerHTML = `
      <div class="card-icon">${platform.icon}</div>
      <div class="card-title">${esc(platform.name)}</div>
      <div class="card-desc">${esc(platform.desc)}</div>
    `;
    card.onclick = () => selectPlatform(key);
    grid.appendChild(card);
  }
}

function isGpuSelected() {
  if (state.selectedPlatform === 'gpu') return true;
  if (state.selectedPlatform === 'custom' && state.customPlatformValue) {
    return state.customPlatformValue.startsWith('gpu-');
  }
  return false;
}

function updateProviderStepVisibility() {
  const providerStep = document.getElementById('provider-step');
  if (!providerStep) return;
  providerStep.classList.remove('hidden');
}

async function selectPlatform(key) {
  state.selectedPlatform = key;
  state.customPlatformValue = null;

  document.querySelectorAll('#platform-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.key === key);
  });

  const picker = document.getElementById('custom-platform-picker');
  if (key === 'custom') {
    picker.classList.remove('hidden');
    await loadCustomPlatformOptions();
  } else {
    picker.classList.add('hidden');
  }

  updateProviderStepVisibility();
  updateApiKeyOptionalHint();
  updateAgentRequirements();
  updateDeployButton();
}

function updateApiKeyOptionalHint() {
  const gpu = isGpuSelected();
  document.querySelectorAll('#api-key-group-tf label, #api-key-group-openrouter label, #api-key-group-huggingface label').forEach(label => {
    const base = label.textContent.replace(/ \(optional.*\)/, '');
    label.textContent = gpu ? base + ' (optional for GPU)' : base;
  });
}

async function loadCustomPlatformOptions() {
  const select = document.getElementById('custom-platform-select');
  select.innerHTML = '<option value="">Loading...</option>';
  select.disabled = true;

  try {
    const region = state.selectedRegion || '';
    const res = await authFetch(`/api/platforms?region=${encodeURIComponent(region)}`);
    const platforms = await res.json();

    const cpuOpts = [];
    const gpuOpts = [];

    for (const p of platforms) {
      const isGpu = p.id.startsWith('gpu-');
      const gpuModel = p.id.replace('gpu-', '').replace(/-[a-z]$/, '').toUpperCase();
      for (const pr of p.presets) {
        const vcpu = pr.vcpu;
        const mem = pr.memory_gib;
        const gpu = pr.gpu_count;
        let label;
        const pricing = PLATFORM_PRICES[p.id];
        if (isGpu) {
          label = `${gpuModel} — ${gpu}× GPU, ${vcpu} vCPUs`;
          if (mem) label += `, ${mem} GiB`;
          if (pricing) label += ` — $${(pricing.perGpu * gpu).toFixed(2)}/hr`;
        } else {
          label = `${p.id.replace('cpu-', 'CPU ').toUpperCase()} — ${vcpu} vCPUs`;
          if (mem) label += `, ${mem} GiB`;
          if (pricing) label += ` — ~$${(pricing.perVcpu * vcpu).toFixed(2)}/hr`;
        }
        const value = `${p.id}:${pr.name}`;
        const opt = `<option value="${esc(value)}">${esc(label)}</option>`;
        (isGpu ? gpuOpts : cpuOpts).push(opt);
      }
    }

    let html = '';
    if (gpuOpts.length) html += `<optgroup label="GPU Platforms">${gpuOpts.join('')}</optgroup>`;
    if (cpuOpts.length) html += `<optgroup label="CPU Platforms">${cpuOpts.join('')}</optgroup>`;
    select.innerHTML = html || '<option value="">No platforms available</option>';
    select.disabled = false;

    // Auto-select first option
    if (select.options.length > 0) {
      select.selectedIndex = 0;
      selectCustomPlatformPreset(select.value);
    }
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load platforms</option>';
    select.disabled = false;
  }
}

function selectCustomPlatformPreset(value) {
  state.customPlatformValue = value || null;
  updateProviderStepVisibility();
  updateApiKeyOptionalHint();
  updateDeployButton();
}

// ── Provider Selection ──────────────────────────────────────────────────────
const PROVIDERS = {
  'token-factory': {
    name: 'Token Factory',
    icon: '🏭',
    description: 'Nebius native inference API'
  },
  'openrouter': {
    name: 'OpenRouter',
    icon: '🔀',
    description: 'Unified API for AI models'
  },
  'huggingface': {
    name: 'Hugging Face',
    icon: '🤗',
    description: 'HF Inference API — Nebius provider'
  }
};

function loadProviders() {
  const grid = document.getElementById('provider-cards');
  grid.innerHTML = '';

  for (const [key, info] of Object.entries(PROVIDERS)) {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.dataset.key = key;
    card.innerHTML = `
      <div class="card-icon">${esc(info.icon)}</div>
      <div class="card-title">${esc(info.name)}</div>
      <div class="card-desc">${esc(info.description)}</div>
    `;
    card.onclick = () => selectProvider(key);
    grid.appendChild(card);
  }

  // Default: select Token Factory
  selectProvider('token-factory');
}

function selectProvider(provider) {
  state.selectedProvider = provider;

  // Update card selection
  document.querySelectorAll('#provider-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.key === provider);
  });

  // Show/hide the correct API key group
  document.getElementById('api-key-group-tf').classList.toggle('hidden', provider !== 'token-factory');
  document.getElementById('api-key-group-openrouter').classList.toggle('hidden', provider !== 'openrouter');
  document.getElementById('api-key-group-huggingface').classList.toggle('hidden', provider !== 'huggingface');

  updateDeployButton();
}

// ── Network (Public / Private IP) ────────────────────────────────────────────
function selectNetwork(network) {
  state.selectedNetwork = network;
  document.querySelectorAll('#network-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.network === network);
  });
  updateDeployButton();
}

// ── Storage ─────────────────────────────────────────────────────────────────
const STORAGE_OPTIONS = {
  filesystem: { icon: '📁', name: 'Filesystem',  desc: 'Shared filesystem mount (NFS)' },
  bucket:     { icon: '🪣', name: 'Bucket',     desc: 'Object storage for files and media' },
  postgresql: { icon: '🐘', name: 'PostgreSQL',  desc: 'Managed relational database' }
};

function loadStorageCards() {
  const grid = document.getElementById('storage-cards');
  if (!grid) return;
  grid.innerHTML = '';

  for (const [key, info] of Object.entries(STORAGE_OPTIONS)) {
    const card = document.createElement('div');
    card.className = 'select-card' + (key === state.selectedStorage ? ' selected' : '');
    card.dataset.storage = key;
    card.innerHTML = `
      <div class="card-icon">${info.icon}</div>
      <div class="card-title">${esc(info.name)}</div>
      <div class="card-desc">${esc(info.desc)}</div>
    `;
    card.onclick = () => selectStorage(key);
    grid.appendChild(card);
  }
}

function selectStorage(key) {
  // Toggle — clicking the same card deselects it
  if (state.selectedStorage === key) {
    state.selectedStorage = null;
  } else {
    state.selectedStorage = key;
  }
  document.querySelectorAll('#storage-cards .select-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.storage === state.selectedStorage);
  });
  // Show/hide size row based on selection
  const sizeRow = document.getElementById('storage-size-row');
  if (sizeRow) sizeRow.style.display = state.selectedStorage ? '' : 'none';
  updateDeployButton();
}

function updateStorageSize(val) {
  const size = Math.max(10, Math.min(10000, parseInt(val) || 100));
  state.storageSize = size;
  const input = document.getElementById('storage-size-input');
  if (input && parseInt(input.value) !== size) input.value = size;
}

// ── Search Provider ──────────────────────────────────────────────────────────
const SEARCH_PROVIDERS = {
  tavily: { icon: '🔍', name: 'Tavily', desc: 'AI-optimized web search API' }
};

function loadSearchProviderCards() {
  const grid = document.getElementById('search-provider-cards');
  if (!grid) return;
  grid.innerHTML = '';

  for (const [key, info] of Object.entries(SEARCH_PROVIDERS)) {
    const card = document.createElement('div');
    card.className = 'select-card selected';
    card.dataset.search = key;
    card.innerHTML = `
      <div class="card-icon">${esc(info.icon)}</div>
      <div class="card-title">${esc(info.name)}</div>
      <div class="card-desc">${esc(info.desc)}</div>
    `;
    grid.appendChild(card);
  }
}

function getActiveApiKey() {
  switch (state.selectedProvider) {
    case 'token-factory':
      return document.getElementById('tf-api-key').value;
    case 'openrouter':
      return document.getElementById('openrouter-api-key').value;
    case 'huggingface':
      return document.getElementById('huggingface-api-key').value;
    default:
      return '';
  }
}

// ── Deploy Summary / Customize Toggle ──────────────────────────────────────
let customizeMode = false;

function buildSummaryGrid() {
  const grid = document.getElementById('summary-grid');
  if (!grid) return;

  const cards = [];

  // Deploy Target
  if (state.selectedTarget) {
    const t = DEPLOY_TARGETS[state.selectedTarget];
    cards.push({ label: 'Platform', icon: t?.icon || '☁️', value: t?.name || state.selectedTarget, step: 'target' });
  }

  // Agent
  if (state.selectedImage) {
    const imgCard = document.querySelector(`#image-cards .select-card[data-key="${state.selectedImage}"]`);
    const iconEl = imgCard?.querySelector('.card-icon');
    const icon = iconEl?.querySelector('img') ? iconEl.innerHTML : (iconEl?.textContent || '🤖');
    const name = imgCard?.querySelector('.card-title')?.textContent || state.selectedImage;
    cards.push({ label: 'Agent', icon, value: name, step: 'image' });
  }

  // Model
  if (state.selectedModel) {
    const fm = FEATURED_MODELS[state.selectedModel];
    const icon = fm?.icon || '🧠';
    const name = fm?.name || state.selectedModel.split('/').pop();
    cards.push({ label: 'Model', icon, value: name, step: 'model' });
  }

  // Cloud-only summary cards
  if (state.selectedTarget === 'cloud') {
    // Region
    if (state.selectedRegion) {
      const regCard = document.querySelector(`#region-cards .select-card[data-key="${state.selectedRegion}"]`);
      const icon = regCard?.querySelector('.card-icon')?.textContent || '🌍';
      const name = regCard?.querySelector('.card-title')?.textContent || state.selectedRegion;
      cards.push({ label: 'Region', icon, value: name, step: 'region' });
    }
    // Platform
    if (state.selectedPlatform) {
      const p = PLATFORMS[state.selectedPlatform];
      cards.push({ label: 'Compute', icon: p?.icon || '⚡', value: p?.name || state.selectedPlatform, step: 'platform' });
    }

    // Network
    cards.push({
      label: 'Network',
      icon: state.selectedNetwork === 'public' ? '🌐' : '🔒',
      value: state.selectedNetwork === 'public' ? 'Public IP' : 'Private IP',
      step: 'network'
    });

    // Storage
    if (state.selectedStorage) {
      const s = STORAGE_OPTIONS[state.selectedStorage];
      cards.push({ label: 'Storage', icon: s?.icon || '💾', value: `${s?.name || state.selectedStorage} · ${state.storageSize} GB`, step: 'storage' });
    }

  }

  // Provider (all targets)
  if (state.selectedProvider) {
    const pr = PROVIDERS[state.selectedProvider];
    cards.push({ label: 'Provider', icon: pr?.icon || '🏭', value: pr?.name || state.selectedProvider, step: 'provider' });
  }

  grid.innerHTML = cards.map(c => `
    <div class="summary-card" onclick="openCustomizeStep('${c.step}')">
      <div class="sc-icon">${c.icon.startsWith('<') ? c.icon : esc(c.icon)}</div>
      <div class="sc-label">${esc(c.label)}</div>
      <div class="sc-value">${esc(c.value)}</div>
    </div>
  `).join('');
}

function toggleCustomize() {
  customizeMode = !customizeMode;
  const steps = document.getElementById('deploy-steps');
  const summary = document.getElementById('deploy-summary');
  const btn = document.getElementById('customize-btn');

  if (customizeMode) {
    steps.classList.remove('hidden');
    summary.classList.add('hidden');
  } else {
    steps.classList.add('hidden');
    summary.classList.remove('hidden');
    buildSummaryGrid();
  }
}

function openCustomizeStep(step) {
  // Open customize mode
  customizeMode = true;
  document.getElementById('deploy-steps').classList.remove('hidden');
  document.getElementById('deploy-summary').classList.add('hidden');

  // Scroll to the relevant step
  const stepMap = {
    target: '#target-cards',
    image: '#image-cards',
    model: '#model-cards',
    region: '#region-cards',
    platform: '#platform-cards',
    provider: '#provider-cards'
  };
  const target = document.querySelector(stepMap[step]);
  if (target) {
    target.closest('.step')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ── MysteryBox ──────────────────────────────────────────────────────────────
let mysteryBoxSecrets = []; // cached secrets

async function loadMysteryBoxSecrets() {
  // Show loading in all provider secret lists
  const containers = ['mb-secrets-tf', 'mb-secrets-openrouter', 'mb-secrets-huggingface', 'mb-secrets-tavily'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="mb-loading"><span class="spinner"></span> Loading secrets...</div>';
  });

  try {
    const res = await authFetch('/api/secrets');
    mysteryBoxSecrets = await res.json();

    const activeSecrets = mysteryBoxSecrets.filter(s => s.state === 'ACTIVE');

    const html = activeSecrets.length === 0
      ? '<div class="mb-empty">No secrets in MysteryBox · <a href="https://console.nebius.com/mysterybox" target="_blank">Create one</a></div>'
      : activeSecrets.map(s => `
          <div class="mb-secret-item" data-secret-id="${esc(s.id)}" onclick="selectMysteryBoxSecret('${esc(s.id)}', this)">
            <div class="mb-secret-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span class="mb-secret-name">${esc(s.name)}</span>
              ${s.description ? `<span class="mb-secret-desc">· ${esc(s.description)}</span>` : ''}
            </div>
            <span class="mb-secret-badge">Use</span>
          </div>
        `).join('');

    containers.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  } catch (err) {
    containers.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
  }
}

async function selectMysteryBoxSecret(secretId, el) {
  el.classList.add('loading');
  const badge = el.querySelector('.mb-secret-badge');
  if (badge) badge.textContent = 'loading...';

  try {
    const res = await authFetch(`/api/secrets/${encodeURIComponent(secretId)}/payload`);
    const payload = await res.json();

    if (res.status === 403) {
      if (badge) {
        badge.textContent = 'no access';
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = 'var(--red)';
        badge.title = 'Service account needs viewer role on this project.';
      }
      console.warn('MysteryBox permission denied. Fix with:\nnebius iam access-permit create --parent-id serviceaccount-e00e26wydmhyd6qdsn --resource-id project-e00r2jeapr00j2q7e7n3yn --role viewer');
      el.classList.remove('loading');
      return;
    }
    if (res.ok) {
      // Determine which field to fill based on which secrets list the item is in
      const isTavily = el.closest('#mb-secrets-tavily');
      let fieldId, value;

      if (isTavily) {
        fieldId = 'tavily-api-key';
        value = payload.TAVILY_API_KEY || payload.tavily_api_key || payload.api_key || Object.values(payload)[0] || '';
      } else {
        const fieldMap = {
          'token-factory': 'tf-api-key',
          'openrouter': 'openrouter-api-key',
          'huggingface': 'huggingface-api-key'
        };
        fieldId = fieldMap[state.selectedProvider] || 'tf-api-key';
        value = payload.TOKEN_API_KEY || payload.TOKEN_FACTORY_API_KEY || payload.OPENROUTER_API_KEY
          || payload.HUGGINGFACE_API_KEY || payload.HF_TOKEN || payload.api_key || Object.values(payload)[0] || '';
      }

      const apiKeyField = document.getElementById(fieldId);

      if (value) {
        apiKeyField.value = value;
        // Also fill Quick Start API key field (for inference keys only)
        if (!isTavily) {
          const qsField = document.getElementById('qs-api-key');
          if (qsField) { qsField.value = value; updateQsDeployButton(); }
        }
        updateDeployButton();

        if (badge) {
          badge.textContent = '✓ loaded';
          badge.style.background = 'rgba(34, 197, 94, 0.15)';
          badge.style.color = 'var(--green)';
        }
        // Reset badge after a moment
        setTimeout(() => {
          if (badge) {
            badge.textContent = 'Use';
            badge.style.background = '';
            badge.style.color = '';
          }
        }, 2000);
      } else {
        if (badge) badge.textContent = 'empty';
      }
    } else {
      throw new Error(payload.error || 'Failed to retrieve');
    }
  } catch (err) {
    if (badge) {
      badge.textContent = 'error';
      badge.style.background = 'rgba(239, 68, 68, 0.15)';
      badge.style.color = 'var(--red)';
    }
    el.classList.remove('loading');
  }
}

async function saveToMysteryBox(provider) {
  const fieldMap = { 'tf': 'tf-api-key', 'openrouter': 'openrouter-api-key', 'huggingface': 'huggingface-api-key', 'tavily': 'tavily-api-key' };
  const keyNameMap = { 'tf': 'TOKEN_FACTORY_API_KEY', 'openrouter': 'OPENROUTER_API_KEY', 'huggingface': 'HF_TOKEN', 'tavily': 'TAVILY_API_KEY' };
  const defaultNameMap = { 'tf': 'token-factory-key', 'openrouter': 'openrouter-key', 'huggingface': 'huggingface-key', 'tavily': 'tavily-key' };

  const apiKeyField = document.getElementById(fieldMap[provider]);
  const value = apiKeyField?.value?.trim();

  if (!value) {
    alert('Enter an API key first, then click Save to store it in MysteryBox.');
    return;
  }

  const name = prompt('Secret name:', defaultNameMap[provider]);
  if (!name) return;

  try {
    const res = await authFetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, key: keyNameMap[provider], value })
    });

    const data = await res.json();

    if (res.ok) {
      // Refresh the secrets list
      loadMysteryBoxSecrets();
    } else {
      alert('Failed to save: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

// ── Deploy ───────────────────────────────────────────────────────────────────
function updateDeployButton() {
  const btn = document.getElementById('deploy-btn');
  const isCloud = state.selectedTarget === 'cloud';
  const baseReady = !!(state.selectedImage && state.selectedModel && (!isCloud || state.selectedRegion));
  const platformReady = !isCloud || state.selectedPlatform !== 'custom' || !!state.customPlatformValue;
  btn.disabled = !(baseReady && platformReady);

  // NemoClaw preset check — warn if selected preset is below minimum
  const nemoWarn = document.getElementById('nemoclaw-preset-warning');
  if (state.selectedImage === 'nemoclaw' && isCloud && state.selectedPlatform === 'cpu') {
    // Default CPU preset is 2vcpu-8gb which meets minimum, but show a note
    if (!nemoWarn) {
      const warn = document.createElement('div');
      warn.id = 'nemoclaw-preset-warning';
      warn.className = 'nemoclaw-req-note';
      warn.style.cssText = 'color:var(--orange);padding:0.5rem 0;font-size:0.8rem';
      warn.textContent = 'Tip: NemoClaw requires at least 4 vCPU and 8 GB RAM. Use Custom platform for larger configurations.';
      const deploySection = btn.closest('.deploy-section');
      if (deploySection) deploySection.insertBefore(warn, btn);
    }
  } else if (nemoWarn) {
    nemoWarn.remove();
  }

  // Update the summary grid when not in customize mode
  if (!customizeMode) buildSummaryGrid();
}

// Listen for API key input on any provider key field
document.addEventListener('input', (e) => {
  if (['tf-api-key', 'openrouter-api-key', 'huggingface-api-key'].includes(e.target.id)) {
    updateDeployButton();
  }
});

async function deploy() {
  const btn = document.getElementById('deploy-btn');
  const statusEl = document.getElementById('deploy-status');

  const gpu = isGpuSelected();
  const apiKey = getActiveApiKey();

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Deploying...';
  statusEl.className = 'deploy-status pending';
  statusEl.textContent = 'Submitting deployment...';
  statusEl.classList.remove('hidden');

  try {
    const body = {
      imageType: state.selectedImage,
      model: state.selectedModel,
      region: state.selectedRegion,
      projectId: state.selectedProject,
      platform: state.selectedPlatform,
      platformPreset: state.selectedPlatform === 'custom' ? state.customPlatformValue : null,
      provider: state.selectedProvider,
      customImage: document.getElementById('custom-image-url')?.value || '',
      endpointName: document.getElementById('endpoint-name').value || '',
      apiKey: apiKey,
      usePublicIp: state.selectedNetwork === 'public',
      storage: state.selectedTarget === 'cloud' ? state.selectedStorage : null,
      storageSize: state.selectedTarget === 'cloud' && state.selectedStorage ? state.storageSize : null,
      tavilyApiKey: document.getElementById('tavily-api-key')?.value || ''
    };

    const res = await authFetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (res.ok) {
      statusEl.className = 'deploy-status success';
      statusEl.innerHTML = `
        <strong>${esc(data.message)}</strong><br>
        Endpoint: <code>${esc(data.name)}</code><br>
        Image: <code>${esc(data.image)}</code><br>
        ${data.storage ? `Storage: <code>${esc(data.storage)}</code><br>` : ''}
        <em>Refresh endpoints list in ~60s to see it running.</em>
      `;

      // Auto-refresh endpoints after delay
      setTimeout(loadEndpoints, 15000);
      setTimeout(loadEndpoints, 45000);
      setTimeout(loadEndpoints, 90000);
    } else {
      statusEl.className = 'deploy-status error';
      if (data.quotaExhausted) {
        statusEl.innerHTML = `
          <strong>No public IPs available</strong><br>
          Using <strong>${data.usage}/${data.limit}</strong> public IPv4 addresses in this region.<br>
          Delete or stop an existing endpoint to free up an IP, or request a quota increase from Nebius.
        `;
      } else {
        statusEl.textContent = data.error || 'Deployment failed';
      }
    }
  } catch (err) {
    statusEl.className = 'deploy-status error';
    statusEl.textContent = 'Network error: ' + err.message;
  }

  btn.disabled = false;
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    Deploy
  `;
}

// ── Endpoints ────────────────────────────────────────────────────────────────
async function loadEndpoints() {
  try {
    const res = await authFetch('/api/endpoints');
    if (!res.ok) throw new Error('Failed to load');
    const endpoints = await res.json();

    // Store in cache
    endpointsCache = endpoints;
    updateGatewayBadge();
    loadChatGateways();
    renderUnifiedInstances();
  } catch (err) {
    // Silently fail — unified list will just show local instances
    renderUnifiedInstances();
  }
}

function renderEndpoints() {
  const list = document.getElementById('endpoints-list');

  // Filter by search + filter
  let filtered = endpointsCache;

  if (endpointFilter === 'active') {
    filtered = filtered.filter(ep => ep.state === 'RUNNING' || ep.state === 'STARTING');
  } else if (endpointFilter === 'inactive') {
    filtered = filtered.filter(ep => ep.state !== 'RUNNING' && ep.state !== 'STARTING');
  }

  if (endpointSearch) {
    filtered = filtered.filter(ep =>
      (ep.name || '').toLowerCase().includes(endpointSearch) ||
      (ep.id || '').toLowerCase().includes(endpointSearch) ||
      (ep.state || '').toLowerCase().includes(endpointSearch)
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty-state">No endpoints found</p>';
    return;
  }

  list.innerHTML = filtered.map(ep => {
    const h = ep.health;
    const presetLabel = ep.preset ? formatPreset(ep.preset) : '';
    const model = h?.model ? (h.model.split('/').pop()) : (ep.model ? ep.model.split('/').pop() : '');

    const startStopBtn = (ep.state === 'RUNNING' || ep.state === 'STARTING')
      ? `<button class="btn-action-pill btn-stop" data-action="stop" data-id="${esc(ep.id)}" data-name="${esc(ep.name)}" title="Stop"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop</button>`
      : `<button class="btn-action-pill btn-start" data-action="start" data-id="${esc(ep.id)}" data-name="${esc(ep.name)}" title="Start"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 20,12 8,19"/></svg> Start</button>`;

    const actions = [];
    const connectIp = ep.publicIp || ep.privateIp;
    if (connectIp && ep.state === 'RUNNING') {
      actions.push(`<button class="btn-action-pill btn-terminal" data-action="terminal" data-ip="${esc(connectIp)}" data-name="${esc(ep.name)}" data-endpoint-id="${esc(ep.id)}" data-has-public-ip="${!!ep.publicIp}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> Terminal</button>`);
      actions.push(`<button class="btn-action-pill btn-dashboard" data-action="dashboard" data-ip="${esc(connectIp)}" data-name="${esc(ep.name)}" ${ep.dashboardToken ? `data-token="${esc(ep.dashboardToken)}"` : ''}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Dashboard</button>`);
    }
    const actionButtons = actions.join('');

    return `<div class="endpoint-row" data-state="${esc(ep.state)}" onclick="toggleEndpointExpand(this, event)">
      <div class="endpoint-col col-name">
        ${startStopBtn}
        <div class="endpoint-icon">${ep.image?.includes('nemoclaw') ? '\uD83D\uDD31' : '\uD83E\uDD9E'}</div>
        <div class="endpoint-name-group">
          <span class="endpoint-name">${esc(ep.name)}</span>
          ${model ? `<span class="endpoint-model">${esc(model)}</span>` : ''}
        </div>
      </div>
      <div class="endpoint-col col-status">
        <span class="status-badge status-${esc(ep.state)}">${formatState(ep.state)}</span>
      </div>
      <div class="endpoint-col col-created">${formatDate(ep.createdAt)}</div>
      <div class="endpoint-col col-actions">
        ${actionButtons}
        <div class="kebab-menu">
          <button class="btn-kebab" onclick="toggleKebab(this)">&#8942;</button>
          <div class="kebab-dropdown hidden">
            <button class="kebab-item kebab-delete" data-action="delete" data-id="${esc(ep.id)}" data-name="${esc(ep.name)}">Delete endpoint</button>
          </div>
        </div>
      </div>
      <div class="endpoint-details">
        <div class="endpoint-detail-item">
          <span class="endpoint-detail-label">ID</span>
          <span class="endpoint-detail-value"><span class="endpoint-id">${esc(ep.id)} <button class="btn-copy" data-copy="${esc(ep.id)}" title="Copy ID"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></span></span>
        </div>
        <div class="endpoint-detail-item">
          <span class="endpoint-detail-label">Platform</span>
          <span class="endpoint-detail-value">${esc(formatPlatform(ep.platform))}</span>
        </div>
        <div class="endpoint-detail-item">
          <span class="endpoint-detail-label">Region</span>
          <span class="endpoint-detail-value">${esc(ep.regionFlag)} ${esc(ep.regionName)}</span>
        </div>
        <div class="endpoint-detail-item">
          <span class="endpoint-detail-label">Resources</span>
          <span class="endpoint-detail-value">${esc(presetLabel || 'pending...')}</span>
        </div>
        ${model ? `<div class="endpoint-detail-item">
          <span class="endpoint-detail-label">Model</span>
          <span class="endpoint-detail-value">${esc(model)}</span>
        </div>` : ''}
        ${h?.inference ? `<div class="endpoint-detail-item">
          <span class="endpoint-detail-label">Inference</span>
          <span class="endpoint-detail-value">${esc(h.inference)}</span>
        </div>` : ''}
        ${connectIp ? `<div class="endpoint-detail-item">
          <span class="endpoint-detail-label">${ep.publicIp ? 'Public IP' : 'Private IP'}</span>
          <span class="endpoint-detail-value">${esc(connectIp)}</span>
        </div>` : ''}
        <div class="endpoint-detail-item">
          <span class="endpoint-detail-label">Proxy URL</span>
          <span class="endpoint-detail-value"><a href="/proxy/${esc(ep.name)}/" target="_blank" class="proxy-link">/proxy/${esc(ep.name)}/</a> <button class="btn-copy" data-copy="${location.origin}/proxy/${esc(ep.name)}/" title="Copy URL"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleEndpointExpand(row, event) {
  // Don't toggle if clicking a button or link
  if (event.target.closest('button, a, .kebab-menu')) return;
  row.classList.toggle('expanded');
}

async function deleteEndpoint(id, name) {
  if (!confirm(`Delete endpoint "${name}"?`)) return;

  try {
    await authFetch(`/api/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setTimeout(loadEndpoints, 2000);
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

async function stopEndpoint(id, name) {
  if (!confirm(`Stop endpoint "${name}"?`)) return;
  try {
    const res = await authFetch(`/api/endpoints/${encodeURIComponent(id)}/stop`, { method: 'POST' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Stop failed'); }
    loadEndpoints();
  } catch (err) {
    alert('Stop failed: ' + err.message);
  }
}

async function startEndpoint(id, name) {
  if (!confirm(`Start endpoint "${name}"?`)) return;
  try {
    const res = await authFetch(`/api/endpoints/${encodeURIComponent(id)}/start`, { method: 'POST' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Start failed'); }
    loadEndpoints();
  } catch (err) {
    alert('Start failed: ' + err.message);
  }
}

// ── Docker Registry ──────────────────────────────────────────────────────────
let registriesCache = [];
let selectedBuildType = 'openclaw';

async function loadRegistries() {
  // Registry browsing moved into deploy page custom agent section
  // This function now only refreshes the registries cache
  try {
    const res = await authFetch('/api/registries');
    if (res.ok) registriesCache = await res.json();
  } catch (err) { /* ignore */ }
}

function renderRegistries() {
  const list = document.getElementById('registries-list');

  if (registriesCache.length === 0) {
    list.innerHTML = `<div style="padding:0.5rem"><button class="btn btn-primary btn-sm btn-oauth-login" onclick="loginWithNebius()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Login with Nebius</button><div class="text-dim" style="font-size:0.75rem;margin-top:0.35rem">Login to see your container registries.</div></div>`;
    return;
  }

  list.innerHTML = registriesCache.map(reg => `
    <div class="registry-card" data-registry-id="${esc(reg.id)}">
      <div class="registry-header" onclick="toggleRegistryImages('${esc(reg.id)}', '${esc(reg.region)}')">
        <div class="registry-info">
          <span class="registry-flag">${reg.regionFlag || ''}</span>
          <div>
            <div class="registry-name">${esc(reg.name)}</div>
            <div class="registry-url">${esc(reg.registryUrl)}</div>
          </div>
        </div>
        <div class="registry-meta">
          <span class="registry-region">${esc(reg.regionName)}</span>
          <svg class="registry-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="registry-images hidden" id="registry-images-${esc(reg.id)}">
        <div class="mb-loading"><span class="spinner"></span> Loading images...</div>
      </div>
    </div>
  `).join('');
}

async function toggleRegistryImages(registryId, region) {
  const container = document.getElementById(`registry-images-${registryId}`);
  const card = container.closest('.registry-card');
  const chevron = card.querySelector('.registry-chevron');

  if (!container.classList.contains('hidden')) {
    container.classList.add('hidden');
    card.classList.remove('expanded');
    return;
  }

  container.classList.remove('hidden');
  card.classList.add('expanded');
  container.innerHTML = '<div class="mb-loading"><span class="spinner"></span> Loading images...</div>';

  // Find the profile for this region
  const reg = registriesCache.find(r => r.id === registryId);
  const profile = reg ? `profile=${encodeURIComponent(region)}` : '';

  try {
    const res = await authFetch(`/api/registries/${encodeURIComponent(registryId)}/images?${profile}`);
    const images = await res.json();

    if (images.length === 0) {
      container.innerHTML = '<div class="registry-empty">No images in this registry</div>';
      return;
    }

    container.innerHTML = `
      <table class="images-table">
        <thead>
          <tr><th>Image</th><th>Tags</th><th>Size</th><th>Created</th></tr>
        </thead>
        <tbody>
          ${images.map(img => `
            <tr>
              <td class="image-name">${esc(img.name)}</td>
              <td>${(img.tags || []).map(t => `<span class="image-tag">${esc(t)}</span>`).join(' ') || '<span class="text-dim">untagged</span>'}</td>
              <td class="text-dim">${esc(img.size || 'unknown')}</td>
              <td class="text-dim">${formatDate(img.createdAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<div class="registry-empty">Failed to load images: ${esc(err.message)}</div>`;
  }
}

function initBuildDialog() {
  // Populate region selector from hardcoded REGIONS
  const select = document.getElementById('build-region');
  if (!select || select.options.length > 0) return;
  for (const [key, info] of Object.entries(REGIONS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${info.flag || ''} ${info.name || key}`;
    select.appendChild(opt);
  }

  // Load source for the currently selected build type
  if (selectedBuildType && selectedBuildType !== 'custom') {
    loadBuildSource(selectedBuildType);
  }
}

// Legacy aliases (no-ops since build dialog is now inline)
function showBuildDialog() { initBuildDialog(); }
function hideBuildDialog() {
  const log = document.getElementById('build-log');
  if (log) log.classList.add('hidden');
}

function selectBuildType(el) {
  el.closest('.build-type-cards').querySelectorAll('.select-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedBuildType = el.dataset.buildType;
  const customGroup = document.getElementById('custom-repo-group');
  const sourceViewer = document.getElementById('build-source-viewer');
  if (selectedBuildType === 'custom') {
    customGroup.classList.remove('hidden');
    sourceViewer.classList.add('hidden');
  } else {
    customGroup.classList.add('hidden');
    loadBuildSource(selectedBuildType);
  }
}

async function loadBuildSource(type) {
  const viewer = document.getElementById('build-source-viewer');
  const codeEl = document.getElementById('build-source-code');
  const entryEl = document.getElementById('build-source-entrypoint');
  codeEl.textContent = 'Loading...';
  entryEl.textContent = '';
  viewer.classList.remove('hidden');

  const repoLink = document.getElementById('build-source-repo');
  if (repoLink) repoLink.style.display = 'none';

  try {
    const res = await authFetch(`/api/build/source/${encodeURIComponent(type)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    codeEl.textContent = data.dockerfile || 'Dockerfile not found in build script';
    entryEl.textContent = data.entrypoint || 'No entrypoint script';
  } catch (e) {
    codeEl.textContent = `Error loading source: ${e.message}`;
  }
}

async function startBuild() {
  const region = document.getElementById('build-region').value;
  const btn = document.getElementById('build-btn');
  const logEl = document.getElementById('build-log');
  const logContent = document.getElementById('build-log-content');

  btn.disabled = true;
  btn.textContent = 'Building...';
  logEl.classList.remove('hidden');
  logContent.textContent = 'Starting build...\n';

  try {
    const buildPayload = { imageType: selectedBuildType, region };
    if (selectedBuildType === 'custom') {
      const repoUrl = document.getElementById('custom-repo-url').value.trim();
      if (!repoUrl) throw new Error('Please enter a GitHub repository URL');
      buildPayload.githubUrl = repoUrl;
    }
    const res = await authFetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Build failed to start');

    const buildId = data.buildId;
    logContent.textContent += `Build ID: ${buildId}\nImage: ${data.image}\n\n`;

    // Poll for build status
    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await authFetch(`/api/build/${encodeURIComponent(buildId)}`);
        const status = await statusRes.json();

        logContent.textContent = status.log || 'Building...';
        logEl.scrollTop = logEl.scrollHeight;

        if (status.status !== 'running') {
          clearInterval(pollInterval);
          btn.disabled = false;
          btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg> Build &amp; Push';

          if (status.status === 'success') {
            logContent.textContent += '\n\n=== BUILD SUCCESSFUL ===\n';
            registriesCache = []; // Clear cache so picker reloads
            loadRegistryImagesForPicker(); // Refresh image picker
          } else {
            logContent.textContent += '\n\n=== BUILD FAILED ===\n';
          }
        }
      } catch (e) {
        // Keep polling
      }
    }, 3000);
  } catch (err) {
    logContent.textContent += `\nError: ${err.message}\n`;
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg> Build &amp; Push';
  }
}

// ── Terminal ─────────────────────────────────────────────────────────────────
function openTerminal(ip, name, endpointId, hasPublicIp) {
  currentTerminalIp = ip;
  currentTerminalName = name;
  currentTerminalEndpointId = endpointId || null;
  currentTerminalHasPublicIp = !!hasPublicIp;

  // Update header
  document.getElementById('terminal-title').textContent = `Terminal — ${name} (${ip})`;
  setTerminalStatus('connecting');

  // Show panel
  const panel = document.getElementById('terminal-panel');
  panel.classList.remove('hidden');
  document.body.classList.add('terminal-open');

  // Initialize or reset xterm
  const container = document.getElementById('terminal-container');
  if (terminal) {
    terminal.dispose();
  }
  container.innerHTML = '';

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
    theme: {
      background: '#0c0c14',
      foreground: '#e4e4ef',
      cursor: '#6366f1',
      selectionBackground: 'rgba(99, 102, 241, 0.3)',
      black: '#0a0a0f',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#f59e0b',
      blue: '#6366f1',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#e4e4ef',
      brightBlack: '#888899',
      brightRed: '#f87171',
      brightGreen: '#4ade80',
      brightYellow: '#fbbf24',
      brightBlue: '#818cf8',
      brightMagenta: '#a78bfa',
      brightCyan: '#22d3ee',
      brightWhite: '#ffffff'
    },
    allowProposedApi: true
  });

  fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  try {
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    terminal.loadAddon(webLinksAddon);
  } catch (e) {}

  terminal.open(container);

  // Wait a tick for DOM to render, then fit
  setTimeout(() => {
    fitAddon.fit();
  }, 50);

  // Handle window resize
  window._terminalResizeHandler = () => {
    if (fitAddon) fitAddon.fit();
  };
  window.addEventListener('resize', window._terminalResizeHandler);

  // Connect WebSocket
  connectTerminalWs(ip);

  // Forward keyboard input to SSH
  terminal.onData((data) => {
    if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
      terminalWs.send(JSON.stringify({ type: 'input', data }));
    }
  });
}

function connectTerminalWs(ip) {
  // Close existing connection
  if (terminalWs) {
    terminalWs.close();
    terminalWs = null;
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsUrl = `${proto}//${window.location.host}/ws/terminal?ip=${encodeURIComponent(ip)}`;
  if (currentTerminalEndpointId) {
    wsUrl += `&endpointId=${encodeURIComponent(currentTerminalEndpointId)}`;
    wsUrl += `&hasPublicIp=${currentTerminalHasPublicIp}`;
  }

  terminalWs = new WebSocket(wsUrl);

  terminalWs.onopen = () => {
    console.log('[Terminal] WebSocket connected');
  };

  terminalWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'data':
          // Decode base64-encoded SSH terminal data
          if (msg.encoding === 'base64') {
            const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
            terminal.write(bytes);
          } else {
            terminal.write(msg.data);
          }
          setTerminalStatus('connected');
          break;
        case 'status':
          terminal.write(msg.data);
          break;
        case 'error':
          terminal.write(`\r\n\x1b[31mError: ${msg.data}\x1b[0m\r\n`);
          setTerminalStatus('disconnected');
          break;
        case 'exit':
          terminal.write(`\r\n\x1b[33m[Session ended — code ${msg.code}]\x1b[0m\r\n`);
          setTerminalStatus('disconnected');
          break;
      }
    } catch (e) {
      terminal.write(event.data);
    }
  };

  terminalWs.onerror = (err) => {
    console.error('[Terminal] WebSocket error:', err);
    terminal.write('\r\n\x1b[31mWebSocket connection error\x1b[0m\r\n');
    setTerminalStatus('disconnected');
  };

  terminalWs.onclose = () => {
    console.log('[Terminal] WebSocket closed');
    setTerminalStatus('disconnected');
  };
}

function setTerminalStatus(status) {
  const el = document.getElementById('terminal-status');
  el.textContent = status;
  el.className = `terminal-status ${status}`;
}

function closeTerminal() {
  // Close WebSocket
  if (terminalWs) {
    terminalWs.close();
    terminalWs = null;
  }

  // Dispose terminal
  if (terminal) {
    terminal.dispose();
    terminal = null;
  }

  // Remove resize handler
  if (window._terminalResizeHandler) {
    window.removeEventListener('resize', window._terminalResizeHandler);
  }

  // Hide panel and reset fullscreen
  const panel = document.getElementById('terminal-panel');
  panel.classList.add('hidden');
  panel.classList.remove('fullscreen');
  document.getElementById('term-fullscreen-btn').classList.remove('hidden');
  document.getElementById('term-exit-fs-btn').classList.add('hidden');
  document.body.classList.remove('terminal-open');
  currentTerminalIp = null;
  currentTerminalName = null;
}

function reconnectTerminal() {
  if (currentTerminalIp) {
    setTerminalStatus('connecting');
    if (terminal) {
      terminal.write('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n');
    }
    connectTerminalWs(currentTerminalIp);
  }
}

function toggleTerminalFullscreen() {
  const panel = document.getElementById('terminal-panel');
  const isFs = panel.classList.toggle('fullscreen');
  document.getElementById('term-fullscreen-btn').classList.toggle('hidden', isFs);
  document.getElementById('term-exit-fs-btn').classList.toggle('hidden', !isFs);
  if (fitAddon) setTimeout(() => fitAddon.fit(), 50);
}

function openTerminalNewWindow() {
  if (!currentTerminalIp) return;
  const params = new URLSearchParams({ ip: currentTerminalIp, name: currentTerminalName || '' });
  window.open('/terminal-window.html?' + params.toString(), 'terminal-' + currentTerminalIp);
  closeTerminal();
}

// ── Logs Viewer ──────────────────────────────────────────────────────────────
let logsWs = null;
let logsTerminal = null;

function openLogs(endpointId, name) {
  const panel = document.getElementById('logs-panel');
  const title = document.getElementById('logs-title');
  const container = document.getElementById('logs-terminal');

  title.textContent = name || endpointId;
  panel.classList.remove('hidden');
  document.body.classList.add('logs-open');

  // Clean up previous
  if (logsTerminal) { logsTerminal.dispose(); logsTerminal = null; }
  if (logsWs) { logsWs.close(); logsWs = null; }

  container.innerHTML = '';

  // Create xterm for logs (read-only)
  logsTerminal = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
    theme: {
      background: '#0d0d14',
      foreground: '#e4e4ef',
      cursor: '#0d0d14'
    },
    scrollback: 5000
  });

  const fitAddon = new FitAddon.FitAddon();
  logsTerminal.loadAddon(fitAddon);
  logsTerminal.open(container);
  fitAddon.fit();

  window._logsResizeHandler = () => fitAddon.fit();
  window.addEventListener('resize', window._logsResizeHandler);

  logsTerminal.write('\x1b[36mConnecting to logs...\x1b[0m\r\n');

  // Connect WebSocket
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  logsWs = new WebSocket(`${proto}://${location.host}/ws/logs?id=${encodeURIComponent(endpointId)}`);

  logsWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'data':
          // Replace newlines with \r\n for xterm
          logsTerminal.write(msg.data.replace(/\n/g, '\r\n'));
          break;
        case 'status':
          logsTerminal.write(`\x1b[36m${msg.data}\x1b[0m`);
          break;
        case 'error':
          logsTerminal.write(`\r\n\x1b[31m${msg.data}\x1b[0m\r\n`);
          break;
        case 'exit':
          logsTerminal.write(`\r\n\x1b[33m[Stream ended — code ${msg.code}]\x1b[0m\r\n`);
          break;
      }
    } catch (e) {
      logsTerminal.write(event.data);
    }
  };

  logsWs.onerror = () => {
    logsTerminal.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
  };

  logsWs.onclose = () => {
    logsTerminal.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
  };
}

function closeLogs() {
  if (logsWs) { logsWs.close(); logsWs = null; }
  if (logsTerminal) { logsTerminal.dispose(); logsTerminal = null; }
  if (window._logsResizeHandler) {
    window.removeEventListener('resize', window._logsResizeHandler);
  }
  document.getElementById('logs-panel').classList.add('hidden');
  document.body.classList.remove('logs-open');
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function openDashboard(ip, name, token) {
  // Route through our HTTPS proxy for secure context (required by Control UI)
  if (token) {
    const proxyBase = `${location.origin}/proxy/${encodeURIComponent(name)}/dashboard`;
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.host}/proxy/${encodeURIComponent(name)}/dashboard`;
    const hashParams = new URLSearchParams();
    hashParams.set('token', token);
    hashParams.set('gatewayUrl', wsUrl);
    const dashUrl = `${proxyBase}/#${hashParams.toString()}`;
    // Auto-approve device pairing, then redirect via loading page
    autoPairApprove(ip, token);
    const loadingUrl = `/dashboard-loading.html?target=${encodeURIComponent(dashUrl)}&delay=6000`;
    window.open(loadingUrl, `dashboard-${name}`);
    return;
  }

  // Fallback: SSH tunnel for older endpoints without port 18789 exposed
  try {
    const res = await authFetch('/api/tunnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, endpointName: name })
    });

    const data = await res.json();

    if (res.ok) {
      let dashUrl = data.url;
      // Control UI reads token + gatewayUrl from hash params
      // Both must be provided together so the token is applied immediately
      const wsUrl = dashUrl.replace(/^http/, 'ws');
      const hashParams = new URLSearchParams();
      if (data.token) hashParams.set('token', data.token);
      hashParams.set('gatewayUrl', wsUrl);
      const hash = hashParams.toString();
      if (hash) dashUrl += '#' + hash;
      // Auto-approve, then redirect via loading page
      autoPairApprove(ip, data.token);
      const loadingUrl = `/dashboard-loading.html?target=${encodeURIComponent(dashUrl)}&delay=6000`;
      window.open(loadingUrl, `dashboard-${ip}`);
    } else {
      throw new Error(data.error || 'Failed to create tunnel');
    }
  } catch (err) {
    alert(`Dashboard error: ${err.message}`);
  }
}

// ── Auto-approve device pairing ──────────────────────────────────────────────
function autoPairApprove(ip, token) {
  // Fire and forget — the server retries for up to 18s in the background
  authFetch('/api/pair-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, token })
  }).catch(() => {}); // ignore errors
}

// ── Banners (removed) ───────────────────────────────────────────────────────
function showDemoBanner() {}
function showPrototypeBanner() {}

// ── Helpers ──────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
