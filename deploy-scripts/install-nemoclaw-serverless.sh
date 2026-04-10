#!/bin/bash
# =============================================================================
# NemoClaw Serverless on Nebius — Deployment Script
# =============================================================================
#
# What this script does:
#   1. Creates a Nebius Container Registry (if one doesn't exist)
#   2. Builds a Docker image with OpenClaw + NemoClaw plugin
#   3. Pushes the image to your Nebius Container Registry
#   4. Creates a serverless AI endpoint running the image
#   5. Waits for the endpoint to become RUNNING
#
# Architecture:
#   - Runs on Nebius cpu-e2 (Intel Ice Lake) — no GPU needed
#   - Inference is routed to Nebius Token Factory (cloud GPU inference)
#   - OpenClaw Gateway runs on port 18789 (WebSocket + Control UI dashboard)
#   - Health check server runs on port 8080 (required by Nebius)
#
# This is the NemoClaw variant: includes the NVIDIA NemoClaw sandbox and
# agent orchestration on top of OpenClaw. For a lighter OpenClaw-only
# deployment, use install-openclaw-serverless.sh.
#
# Prerequisites:
#   - nebius CLI installed and authenticated (nebius iam whoami)
#   - Docker installed (for building the image)
#   - A Nebius project (auto-detected, or set PROJECT_ID)
#   - A Token Factory API key (https://tokenfactory.nebius.com)
#
# Usage:
#   export TOKEN_FACTORY_API_KEY="v1.xxx..."
#   ./install-nemoclaw-serverless.sh
#
# Environment variables (optional):
#   REGION            - Nebius region (default: eu-north1)
#   PROJECT_ID        - Nebius project ID (auto-detected if not set)
#   INFERENCE_MODEL   - Model for inference (default: zai-org/GLM-5)
#                       Use Token Factory model IDs: zai-org/GLM-5, zai-org/GLM-4.5,
#                       deepseek-ai/DeepSeek-R1-0528, etc.
#   TOKEN_FACTORY_URL - Token Factory endpoint (default: https://api.tokenfactory.nebius.com/v1)
#   GATEWAY_TOKEN     - Gateway auth token (auto-generated if not set)
#   SKIP_DEPLOY       - Set to "1" to only build+push without creating an endpoint
#
# Public Docker image (alternative to building):
#   If you don't want to build locally, you can deploy the pre-built public image:
#     ghcr.io/opencolin/nemoclaw-serverless:latest
#
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
# These can all be overridden via environment variables.
REGION="${REGION:-eu-north1}"
PROJECT_ID="${PROJECT_ID:-}"
ENDPOINT_NAME="${ENDPOINT_NAME:-nemoclaw-serverless}"
PRESET="${PRESET:-2vcpu-8gb}"         # CPU preset: 2 vCPUs, 8 GiB RAM (cheapest)
CONTAINER_PORT=8080                   # Health check port (required by Nebius)
GATEWAY_PORT=18789                    # OpenClaw Gateway WebSocket port
INFERENCE_MODEL="${INFERENCE_MODEL:-zai-org/GLM-5}"  # Token Factory model ID
TOKEN_FACTORY_URL="${TOKEN_FACTORY_URL:-https://api.tokenfactory.nebius.com/v1}"

# ── Region → CPU platform mapping ───────────────────────────────────────────
# Different Nebius regions support different CPU platforms:
#   eu-north1   (Finland) → cpu-e2 (Intel Ice Lake)
#   eu-west1    (Paris)   → cpu-d3 (AMD EPYC)
#   us-central1 (US)      → cpu-e2 (Intel Ice Lake)
# Using the wrong platform for a region will cause deployment to fail.
case "$REGION" in
  eu-west1)    PLATFORM="cpu-d3" ;;   # AMD EPYC (Paris only)
  *)           PLATFORM="cpu-e2" ;;   # Intel Ice Lake (Finland, US)
esac

# ── Colors & logging helpers ─────────────────────────────────────────────────
info()  { printf '\033[1;34m>>>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m   %s\n' "$*"; }
warn()  { printf '\033[1;33m⚠\033[0m   %s\n' "$*"; }
error() { printf '\033[1;31m✗\033[0m   %s\n' "$*"; exit 1; }

# ── Preflight checks ────────────────────────────────────────────────────────
# Verify all required tools and credentials before starting.
info "Preflight checks..."

[ -z "${TOKEN_FACTORY_API_KEY:-}" ] && error "Set TOKEN_FACTORY_API_KEY env var. Get one at https://tokenfactory.nebius.com"
command -v nebius &>/dev/null || error "Nebius CLI not installed. Run: curl -sSL https://storage.ai.nebius.cloud/nebius/install.sh | bash"
command -v docker &>/dev/null || error "Docker not installed."

# Verify Nebius CLI authentication — this will fail if the token expired
# or if the user hasn't logged in yet.
nebius iam get-access-token >/dev/null 2>&1 || error "Not authenticated. Run: nebius iam login"
ok "Authenticated"

# Auto-detect project ID from the first project in the user's account.
# Most users have a single project, so this works out of the box.
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(nebius iam project list --format json 2>/dev/null | \
    python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['metadata']['id'] if items else '')" 2>/dev/null || echo "")
  [ -z "$PROJECT_ID" ] && error "Could not auto-detect project. Set PROJECT_ID env var."
  ok "Using project: $PROJECT_ID"
fi

# ── Step 1: Create Container Registry ────────────────────────────────────────
# Nebius requires a container registry to store Docker images.
# The registry lives in your project and is region-specific.
# We check if one already exists to avoid creating duplicates.
info "Step 1: Creating container registry..."

# List existing registries and grab the first one's ID (if any)
REGISTRY_ID=$(nebius registry list --format json 2>/dev/null | \
  python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['metadata']['id'] if items else '')" 2>/dev/null || echo "")

if [ -z "$REGISTRY_ID" ]; then
  # No registry exists — create one named "nemoclaw" under our project
  REGISTRY_ID=$(nebius registry create \
    --name nemoclaw \
    --parent-id "$PROJECT_ID" \
    --format json | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
  ok "Created registry: $REGISTRY_ID"
else
  ok "Using existing registry: $REGISTRY_ID"
fi

# Strip the "registry-" prefix from the ID if present.
# The `nebius registry list` command returns IDs like "registry-u00wtpem36bva2zhc8",
# but the Docker image URL only uses the part after "registry-".
# Example: cr.eu-north1.nebius.cloud/u00wtpem36bva2zhc8/image:tag (NOT registry-u00...)
REGISTRY_ID="${REGISTRY_ID#registry-}"

# Build the full image URL for the Nebius container registry.
# Format: cr.<region>.nebius.cloud/<registry-id>/<image-name>:<tag>
REGISTRY_URL="cr.${REGION}.nebius.cloud"
IMAGE="${REGISTRY_URL}/${REGISTRY_ID}/nemoclaw-serverless:latest"

# ── Step 2: Build Docker image ───────────────────────────────────────────────
# We build a Docker image containing:
#   - Node.js 22 (OpenClaw is a Node.js app)
#   - OpenClaw CLI installed globally via npm
#   - NemoClaw plugin installed from GitHub
#   - A custom entrypoint script that configures and starts OpenClaw
#
# The image is built for linux/amd64 because Nebius cpu-e2 runs Intel CPUs.
# If you're building on an ARM Mac (M1/M2/M3), Docker BuildKit handles
# the cross-compilation automatically via --platform linux/amd64.
#
# TIP: Building on a Nebius VM (which is already amd64) is MUCH faster
# than cross-compiling on an ARM Mac.
info "Step 2: Building NemoClaw Docker image (linux/amd64)..."

# Create a temporary directory for the Docker build context.
# The trap ensures it's cleaned up even if the script fails.
BUILD_DIR=$(mktemp -d)
trap "rm -rf $BUILD_DIR" EXIT

# Write the Dockerfile into the temp directory.
# IMPORTANT: Must use node:22 (not node:22-slim) because NemoClaw's
# dependencies (specifically @whiskeysockets/baileys) need build tools
# that aren't available in the slim image.
cat > "$BUILD_DIR/Dockerfile" << 'DOCKERFILE'
# NemoClaw Serverless — CPU-only for Nebius cpu-e2 (Intel Ice Lake)
# Includes OpenClaw + NemoClaw plugin, no GPU required.
# Inference routed to Nebius Token Factory.
#
# IMPORTANT: Must use node:22 (not slim) — NemoClaw dependencies need
# build tools (python3, make, gcc) that aren't in the slim image.
FROM node:22

# Install system dependencies:
#   curl, ca-certificates — for HTTPS requests to Token Factory
#   procps — provides `ps` command (useful for debugging)
#   git — required by npm to install NemoClaw from GitHub
#   python3 — used by the health check server (lightweight alternative to Node)
#   python3-yaml — for YAML parsing in scripts
#   bash — needed by some npm post-install scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates procps git python3 python3-pip python3-yaml bash \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw globally — this gives us the `openclaw` CLI and
# `openclaw-gateway` binary for the WebSocket gateway server
RUN npm install -g openclaw

# Install NemoClaw plugin from GitHub
# --ignore-scripts: skip post-install scripts that fail in Docker builds.
# Specifically, @whiskeysockets/baileys has a post-install script that
# tries to spawn `sh` in a way that fails inside BuildKit.
# The plugin still works correctly without these scripts.
RUN npm install -g git+https://github.com/NVIDIA/NemoClaw.git --ignore-scripts || \
    echo "WARN: NemoClaw install had issues, continuing"

# Create a non-root user for security.
# Running as root inside containers is a bad practice.
RUN useradd -m -s /bin/bash nemoclaw

# Copy our custom entrypoint script that configures and starts OpenClaw
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose ports:
#   8080  — Health check HTTP server (required by Nebius for readiness probes)
#   18789 — OpenClaw Gateway WebSocket (for the Control UI dashboard + TUI)
EXPOSE 8080 18789

# Switch to non-root user and set working directory
USER nemoclaw
WORKDIR /home/nemoclaw
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
DOCKERFILE

# Write the entrypoint script that runs inside the container at startup.
# This script:
#   1. Reads environment variables (API key, model, gateway token, etc.)
#   2. Maps OPENCLAW_WEB_PASSWORD → OPENCLAW_GATEWAY_TOKEN (deploy UI compat)
#   3. Writes the OpenClaw configuration file (openclaw.json)
#   4. Starts the OpenClaw gateway in the background
#   5. Starts a Python health check server as the main process (PID 1)
#
# KEY LESSONS LEARNED:
#   - Gateway token MUST be set in the config file AND env var.
#     Setting only the env var is unreliable after manual gateway restarts.
#   - Do NOT add a "plugins" key to openclaw.json — it's not a valid config
#     key and will crash the gateway on startup with "Config invalid".
#     NemoClaw is loaded automatically if installed globally via npm.
#   - allowedOrigins: ["*"] is required for the Control UI to work when
#     accessed through a reverse proxy (e.g., the deploy UI's dashboard proxy).
#   - Model IDs must match Token Factory's format (e.g., "zai-org/GLM-5"),
#     not HuggingFace format (e.g., "THUDM/GLM-4-9B-0414").
cat > "$BUILD_DIR/entrypoint.sh" << 'ENTRYPOINT'
#!/bin/bash
set -e

# ── Read configuration from environment variables ──
# These are set via --env flags in the `nebius ai endpoint create` command,
# or via the Deploy UI when creating an endpoint.
MODEL="${INFERENCE_MODEL:-zai-org/GLM-5}"
TF_KEY="${TOKEN_FACTORY_API_KEY}"
TF_URL="${TOKEN_FACTORY_URL:-https://api.tokenfactory.nebius.com/v1}"

# Map OPENCLAW_WEB_PASSWORD (set by the deploy UI) to OPENCLAW_GATEWAY_TOKEN
# (used by the OpenClaw gateway). Falls back to GATEWAY_TOKEN env var, then
# auto-generates a hostname-based token as last resort.
export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_WEB_PASSWORD:-${GATEWAY_TOKEN:-nemoclaw-$(hostname)}}"

echo "=== NemoClaw Serverless ==="
echo "Model: $MODEL"
echo "Inference: Nebius Token Factory (no GPU)"
echo "Gateway token: ${OPENCLAW_GATEWAY_TOKEN:0:8}..."

if [ -z "$TF_KEY" ]; then
  echo "WARNING: TOKEN_FACTORY_API_KEY not set — agent will not be able to call inference"
fi

# ── Configure OpenClaw ──
# OpenClaw reads its config from ~/.openclaw/openclaw.json.
# We generate this file dynamically from environment variables so the
# same Docker image can be reused with different models/keys.
#
# IMPORTANT: Do NOT add a "plugins" key here!
# "plugins.nemoclaw" is NOT a valid OpenClaw config key and will crash
# the gateway on startup with: "Config invalid - plugins: Unrecognized key"
# NemoClaw is loaded automatically when installed globally via npm.
#
# The gateway auth token is set BOTH in the config file AND as an env var.
# Config-only or env-only are unreliable — the config file is the source of
# truth that survives gateway restarts.
mkdir -p ~/.openclaw
cat > ~/.openclaw/openclaw.json << OCJSON
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "token-factory/${MODEL}"
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "token-factory": {
        "baseUrl": "${TF_URL}",
        "apiKey": "${TF_KEY}",
        "api": "openai-completions",
        "models": [{"id": "${MODEL}", "name": "Token Factory"}]
      }
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    },
    "controlUi": {
      "allowedOrigins": ["*"]
    }
  }
}
OCJSON
echo "OpenClaw + NemoClaw configured."

# ── Start the Gateway ──
# The OpenClaw Gateway is a WebSocket server that:
#   - Hosts the Control UI dashboard (web interface for managing agents)
#   - Provides a WebSocket API for connecting external clients (TUI, web apps)
#   - Manages agent sessions, cron jobs, and channel integrations
#
# We use --bind lan so the gateway listens on all interfaces (0.0.0.0),
# making it accessible from outside the container.
# --auth token requires clients to provide the gateway token to connect.
openclaw gateway --bind lan --auth token > /tmp/gateway.log 2>&1 &
echo "Gateway started (PID: $!) token=${OPENCLAW_GATEWAY_TOKEN:0:8}..."

# ── Health Check Server ──
# Nebius AI endpoints require a health check on the container port (8080).
# The endpoint polls this URL periodically to verify the container is alive.
# If the health check fails, Nebius will restart the container.
#
# We use a tiny Python HTTP server instead of Node.js to minimize overhead.
# It returns a JSON response with the service status, model info, and ports.
# This same response is used by the Deploy UI to show endpoint health badges.
exec python3 -c "
import http.server, json, os

class Health(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        body = {
            'status': 'healthy',
            'service': 'nemoclaw-serverless',
            'model': os.environ.get('INFERENCE_MODEL', 'unknown'),
            'inference': 'token-factory',
            'gateway_port': 18789,
            'gpu': 'none (cpu-e2)'
        }
        self.wfile.write(json.dumps(body).encode())
    def log_message(self, format, *args):
        pass

print('Health server starting on :8080')
http.server.HTTPServer(('0.0.0.0', 8080), Health).serve_forever()
"
ENTRYPOINT

# Build for linux/amd64 (required for Nebius cpu-e2 / Intel Ice Lake).
# If building on an ARM Mac, this uses QEMU emulation via BuildKit which
# is slower. Building on a Nebius VM (native amd64) is much faster.
docker buildx build --platform linux/amd64 -t "$IMAGE" "$BUILD_DIR" 2>&1 | tail -5
ok "Image built: $IMAGE"

# ── Step 3: Push to Nebius Container Registry ────────────────────────────────
# Authenticate Docker with the Nebius registry using an IAM access token.
# The token is short-lived, so we get a fresh one each time.
info "Step 3: Pushing image to registry..."

nebius iam get-access-token | docker login "$REGISTRY_URL" --username iam --password-stdin 2>&1
docker push "$IMAGE" 2>&1 | tail -5
ok "Image pushed"

# ── Step 4: Deploy endpoint ──────────────────────────────────────────────────
# Skip this step if SKIP_DEPLOY=1 (useful when only building+pushing the image,
# e.g., from the Deploy UI's "Build Image" feature).
if [ "${SKIP_DEPLOY:-0}" = "1" ]; then
  ok "SKIP_DEPLOY=1 — skipping endpoint creation"
  echo ""
  echo "Image ready: $IMAGE"
  echo "Deploy via UI or CLI: nebius ai endpoint create --image $IMAGE ..."
  exit 0
fi

info "Step 4: Deploying NemoClaw on $PLATFORM (no GPU)..."

# Generate a gateway token for this deployment
DEPLOY_TOKEN="${GATEWAY_TOKEN:-$(openssl rand -hex 16)}"

# Find SSH public key for Terminal access.
# The deploy UI copies its SSH key to endpoints for in-browser Terminal access.
# If no key exists, we generate one and display a warning.
SSH_KEY_PATH=""
for key_path in ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub; do
  if [ -f "$key_path" ]; then
    SSH_KEY_PATH="$key_path"
    break
  fi
done

if [ -z "$SSH_KEY_PATH" ]; then
  warn "No SSH public key found — generating one for endpoint access"
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "nemoclaw-deploy" 2>/dev/null
  SSH_KEY_PATH=~/.ssh/id_ed25519.pub
fi

SSH_KEY_CONTENT=$(cat "$SSH_KEY_PATH")
ok "Using SSH key: $SSH_KEY_PATH"

# Create the endpoint with all required flags:
#   --platform   : CPU type (region-dependent, set above)
#   --preset     : Resource allocation (vCPUs + RAM)
#   --container-port : Ports to expose (8080 for health, 18789 for gateway)
#   --disk-size  : Storage for the container (100Gi is sufficient for most workloads)
#   --public     : Assign a public IP for direct access
#   --ssh-key    : Authorize SSH key for Terminal access
nebius ai endpoint create \
  --name "$ENDPOINT_NAME" \
  --image "$IMAGE" \
  --platform "$PLATFORM" \
  --preset "$PRESET" \
  --container-port "$CONTAINER_PORT" \
  --container-port "$GATEWAY_PORT" \
  --disk-size 100Gi \
  --env "TOKEN_FACTORY_API_KEY=${TOKEN_FACTORY_API_KEY}" \
  --env "TOKEN_FACTORY_URL=${TOKEN_FACTORY_URL}" \
  --env "INFERENCE_MODEL=${INFERENCE_MODEL}" \
  --env "OPENCLAW_WEB_PASSWORD=${DEPLOY_TOKEN}" \
  --public \
  --ssh-key "$SSH_KEY_CONTENT" \
  2>&1

# ── Step 5: Wait for endpoint to be ready ────────────────────────────────────
# Poll the endpoint state every 10 seconds, up to 5 minutes (30 * 10s).
info "Step 5: Waiting for endpoint to start..."

ENDPOINT_ID=$(nebius ai endpoint list --format json 2>/dev/null | \
  python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); [print(i['metadata']['id']) for i in items if i['metadata']['name']=='$ENDPOINT_NAME']" 2>/dev/null | head -1)

for i in $(seq 1 30); do
  STATE=$(nebius ai endpoint get "$ENDPOINT_ID" --format json 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")

  if [ "$STATE" = "RUNNING" ]; then
    ok "Endpoint is RUNNING!"
    break
  elif [ "$STATE" = "ERROR" ]; then
    error "Endpoint failed to start. Check logs: nebius ai endpoint logs $ENDPOINT_ID"
  fi

  printf '.'
  sleep 10
done

# ── Get endpoint info & print connection details ──────────────────────────────
PUBLIC_IP=$(nebius ai endpoint get "$ENDPOINT_ID" --format json 2>/dev/null | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
inst=d.get('status',{}).get('instances',[])
for i in inst:
    ip=i.get('public_ip','') or i.get('public_ip_address','')
    if ip: print(ip.split('/')[0])
" 2>/dev/null || echo "N/A")

echo ""
echo "============================================="
echo "  NemoClaw Serverless — Deployed!"
echo "============================================="
echo ""
echo "  Endpoint ID:  $ENDPOINT_ID"
echo "  Health check: http://${PUBLIC_IP}:8080"
echo "  Gateway:      ws://${PUBLIC_IP}:18789"
echo "  Dashboard:    http://${PUBLIC_IP}:18789/#token=${DEPLOY_TOKEN}"
echo "  Model:        $INFERENCE_MODEL"
echo "  Platform:     $PLATFORM (no GPU)"
echo "  Inference:    Token Factory"
echo ""
echo "  Connect via TUI:"
echo "    export OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1"
echo "    openclaw tui --url ws://${PUBLIC_IP}:18789 --token ${DEPLOY_TOKEN}"
echo ""
echo "  Or via SSH tunnel (recommended for security):"
echo "    ssh -f -N -L 28789:${PUBLIC_IP}:18789 nebius@<your-vm-ip>"
echo "    openclaw tui --url ws://localhost:28789 --token ${DEPLOY_TOKEN}"
echo ""
echo "  Manage:"
echo "    nebius ai endpoint logs --follow $ENDPOINT_ID"
echo "    nebius ai endpoint stop $ENDPOINT_ID"
echo "    nebius ai endpoint delete $ENDPOINT_ID"
echo ""
