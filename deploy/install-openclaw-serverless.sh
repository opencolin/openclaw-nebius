#!/bin/bash
# =============================================================================
# OpenClaw Serverless on Nebius — Deployment Script
# =============================================================================
#
# What this script does:
#   Deploys OpenClaw (an AI agent framework) as a serverless container on
#   Nebius Cloud. The container runs on a small CPU-only VM (Intel Ice Lake)
#   and connects to Nebius Token Factory for LLM inference — no GPU needed.
#
# How it works:
#   1. Creates a container registry in your Nebius project (if one doesn't exist)
#   2. Builds a Docker image with OpenClaw pre-installed
#   3. Pushes the image to the Nebius container registry
#   4. Creates a serverless AI endpoint running the image
#   5. Waits for the endpoint to start and prints connection info
#
# Prerequisites:
#   - nebius CLI installed and authenticated (nebius iam whoami)
#   - Docker installed (for building the image)
#   - A Nebius project (auto-detected from CLI, or set PROJECT_ID)
#   - A Token Factory API key from https://tokenfactory.nebius.com
#
# Usage:
#   export TOKEN_FACTORY_API_KEY="v1.xxx..."
#   ./install-openclaw-serverless.sh
#
# Optional environment variables:
#   REGION           Nebius region (default: eu-north1)
#   PROJECT_ID       Your Nebius project ID (auto-detected if not set)
#   INFERENCE_MODEL  LLM model to use (default: deepseek-ai/DeepSeek-R1-0528)
#   TOKEN_FACTORY_URL  Token Factory API base URL (default: https://api.tokenfactory.nebius.com/v1)
#
# =============================================================================

# Exit immediately on error (-e), treat unset variables as errors (-u),
# and fail pipelines if any command in the pipe fails (-o pipefail)
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
# These can be overridden by setting environment variables before running.
# For example: REGION=eu-west1 ./install-openclaw-serverless.sh

REGION="${REGION:-eu-north1}"                    # Nebius region (eu-north1=Finland, eu-west1=Paris, us-central1=US)
PROJECT_ID="${PROJECT_ID:-}"                     # Nebius project ID — auto-detected below if empty
ENDPOINT_NAME="openclaw-serverless"              # Name for the deployed endpoint
PLATFORM="cpu-e2"                                # Nebius VM platform (cpu-e2 = Intel Ice Lake, cheapest CPU option)
CONTAINER_PORT=8080                              # Port the container exposes for health checks
INFERENCE_MODEL="${INFERENCE_MODEL:-deepseek-ai/DeepSeek-R1-0528}"  # LLM model routed through Token Factory
TOKEN_FACTORY_URL="${TOKEN_FACTORY_URL:-https://api.tokenfactory.nebius.com/v1}"  # Token Factory API endpoint

# ── Helper functions ─────────────────────────────────────────────────────────
# Colored output for readability in the terminal
info()  { printf '\033[1;34m>>>\033[0m %s\n' "$*"; }   # Blue ">>>" prefix for step headers
ok()    { printf '\033[1;32m✓\033[0m   %s\n' "$*"; }   # Green checkmark for success
error() { printf '\033[1;31m✗\033[0m   %s\n' "$*"; exit 1; }  # Red X for errors (exits script)

# ── Preflight checks ────────────────────────────────────────────────────────
# Verify all prerequisites before starting the deployment.
# This catches common issues early (missing API key, CLI not installed, etc.)
info "Preflight checks..."

# TOKEN_FACTORY_API_KEY is required — the container needs it to call the LLM
[ -z "${TOKEN_FACTORY_API_KEY:-}" ] && error "Set TOKEN_FACTORY_API_KEY env var. Get one at https://tokenfactory.nebius.com"

# Check that the Nebius CLI binary is installed and on PATH
command -v nebius &>/dev/null || error "Nebius CLI not installed. Run: curl -sSL https://storage.ai.nebius.cloud/nebius/install.sh | bash"

# Check that Docker is installed (needed to build the container image)
command -v docker &>/dev/null || error "Docker not installed."

# Verify the Nebius CLI is authenticated (has a valid access token).
# `nebius iam get-access-token` returns a short-lived OAuth token.
# If this fails, the user needs to run `nebius iam whoami` to trigger login.
nebius iam get-access-token >/dev/null 2>&1 || error "Not authenticated. Run: nebius iam whoami"
ok "Authenticated"

# Auto-detect the Nebius project ID if the user didn't set PROJECT_ID.
# Lists all projects in the current organization and picks the first one.
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
  # No registry exists — create one named "openclaw" under our project
  REGISTRY_ID=$(nebius registry create \
    --name openclaw \
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
IMAGE="${REGISTRY_URL}/${REGISTRY_ID}/openclaw-serverless:latest"

# ── Step 2: Build Docker image ───────────────────────────────────────────────
# We build a Docker image containing:
#   - Node.js 22 (OpenClaw is a Node.js app)
#   - OpenClaw installed globally via npm
#   - A custom entrypoint script that configures and starts OpenClaw
#
# The image is built for linux/amd64 because Nebius cpu-e2 runs Intel CPUs.
# If you're building on an ARM Mac (M1/M2/M3), Docker BuildKit handles
# the cross-compilation automatically via --platform linux/amd64.
info "Step 2: Building Docker image..."

# Create a temporary directory for the Docker build context.
# The trap ensures it's cleaned up even if the script fails.
BUILD_DIR=$(mktemp -d)
trap "rm -rf $BUILD_DIR" EXIT

# Write the Dockerfile into the temp directory.
# This is a minimal image: Node.js base + OpenClaw + a few system utilities.
cat > "$BUILD_DIR/Dockerfile" << 'DOCKERFILE'
FROM node:22-slim

# Install system dependencies:
#   curl, ca-certificates — for HTTPS requests to Token Factory
#   procps — provides `ps` command (useful for debugging)
#   git — required by OpenClaw for some operations
#   python3 — used by the health check server (lightweight alternative to Node)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates procps git python3 \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw globally — this gives us the `openclaw` CLI and
# `openclaw-gateway` binary for the WebSocket gateway server
RUN npm install -g openclaw

# Create a non-root user for security.
# Running as root inside containers is a bad practice.
RUN useradd -m -s /bin/bash openclaw

# Copy our custom entrypoint script that configures and starts OpenClaw
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose ports:
#   8080  — Health check HTTP server (required by Nebius for readiness probes)
#   18789 — OpenClaw Gateway WebSocket (for the Control UI dashboard)
EXPOSE 8080 18789

# Switch to non-root user and set working directory
USER openclaw
WORKDIR /home/openclaw
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
DOCKERFILE

# Write the entrypoint script that runs inside the container at startup.
# This script:
#   1. Reads environment variables (API key, model, etc.)
#   2. Writes the OpenClaw configuration file (openclaw.json)
#   3. Starts the OpenClaw gateway in the background
#   4. Starts a Python health check server as the main process (PID 1)
cat > "$BUILD_DIR/entrypoint.sh" << 'ENTRYPOINT'
#!/bin/bash
set -e

# Read configuration from environment variables passed at deploy time.
# These are set via --env flags in the `nebius ai endpoint create` command.
MODEL="${INFERENCE_MODEL:-zai-org/GLM-5}"
TF_KEY="${TOKEN_FACTORY_API_KEY}"
TF_URL="${TOKEN_FACTORY_URL:-https://api.tokenfactory.nebius.com/v1}"
# Map OPENCLAW_WEB_PASSWORD (set by deploy UI) to OPENCLAW_GATEWAY_TOKEN.
# Falls back to GATEWAY_TOKEN or auto-generated value.
export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_WEB_PASSWORD:-${GATEWAY_TOKEN:-openclaw-$(hostname)}}"

echo "=== OpenClaw Serverless ==="
echo "Model: $MODEL"
echo "Inference: Token Factory"

if [ -z "$TF_KEY" ]; then
  echo "WARNING: TOKEN_FACTORY_API_KEY not set"
fi

# ── Configure OpenClaw ──
# OpenClaw reads its config from ~/.openclaw/openclaw.json.
# We generate this file dynamically from environment variables so the
# same Docker image can be reused with different models/keys.
#
# IMPORTANT lessons learned:
#   - Token must be in config file AND env var (env alone isn't reliable after restarts)
#   - allowedOrigins: ["*"] needed for dashboard access from deploy UI proxy
#   - Do NOT add "plugins" key — invalid keys crash the gateway on startup
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
echo "OpenClaw configured."

# ── Start the Gateway ──
# The OpenClaw Gateway is a WebSocket server that:
#   - Hosts the Control UI dashboard (web interface for managing agents)
#   - Provides a WebSocket API for connecting external clients (TUI, web apps)
#   - Manages agent sessions, cron jobs, and channel integrations
#
# We use --bind lan so the gateway listens on all interfaces (0.0.0.0),
# making it accessible from outside the container.
# --auth token requires clients to provide OPENCLAW_GATEWAY_TOKEN to connect.
# This prevents unauthorized access to the gateway.
openclaw gateway --bind lan --auth token > /tmp/gateway.log 2>&1 &
echo "Gateway started (PID: $!) token=$OPENCLAW_GATEWAY_TOKEN"

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
            'service': 'openclaw-serverless',
            'model': os.environ.get('INFERENCE_MODEL', 'unknown'),
            'inference': 'token-factory',
            'gateway_port': 18789
        }
        self.wfile.write(json.dumps(body).encode())
    def log_message(self, format, *args):
        pass

print('Health server starting on :8080')
http.server.HTTPServer(('0.0.0.0', 8080), Health).serve_forever()
"
ENTRYPOINT

# Build the Docker image for linux/amd64 (Intel architecture).
# IMPORTANT: If you're on an ARM Mac (M1/M2/M3), Docker BuildKit will
# cross-compile automatically. This is slower than native builds but
# produces an image that runs correctly on Nebius Intel CPUs.
#
# Common build issues:
#   - "no space left on device" → Run `docker system prune` to free disk
#   - BuildKit cache corruption → Run `docker builder prune --all`
#   - Slow builds on ARM Mac → Normal for cross-compilation, takes 2-5 min
docker buildx build --platform linux/amd64 -t "$IMAGE" "$BUILD_DIR" 2>&1 | tail -5
ok "Image built: $IMAGE"

# ── Step 3: Push to Nebius Container Registry ────────────────────────────────
# Authenticate Docker with the Nebius registry using a short-lived IAM token.
# The token is piped from `nebius iam get-access-token` into `docker login`.
# Username is always "iam" for Nebius registry authentication.
info "Step 3: Pushing image to registry..."

nebius iam get-access-token | docker login "$REGISTRY_URL" --username iam --password-stdin 2>&1
docker push "$IMAGE" 2>&1 | tail -5
ok "Image pushed"

# ── Step 4: Deploy endpoint ──────────────────────────────────────────────────
# Create a Nebius AI endpoint — a managed container instance that:
#   - Pulls and runs our Docker image
#   - Assigns a public IP address (--public)
#   - Passes environment variables to the container (--env)
#   - Monitors health via the container port (8080)
#   - Auto-restarts if the container crashes
#
# The endpoint runs on cpu-e2 (Intel Ice Lake, 2 vCPUs, 8 GiB RAM).
# This is the cheapest option — no GPU needed since inference goes
# through Token Factory's API, not local model loading.
info "Step 4: Deploying endpoint on $PLATFORM..."

nebius ai endpoint create \
  --name "$ENDPOINT_NAME" \
  --image "$IMAGE" \
  --platform "$PLATFORM" \
  --container-port "$CONTAINER_PORT" \
  --env "TOKEN_FACTORY_API_KEY=${TOKEN_FACTORY_API_KEY}" \
  --env "TOKEN_FACTORY_URL=${TOKEN_FACTORY_URL}" \
  --env "INFERENCE_MODEL=${INFERENCE_MODEL}" \
  --public \
  2>&1

# ── Step 5: Wait for endpoint to be ready ────────────────────────────────────
# After creation, the endpoint goes through these states:
#   PROVISIONING → STARTING → RUNNING (or ERROR)
#
# We poll every 10 seconds for up to 5 minutes (30 iterations × 10s).
# The endpoint typically reaches RUNNING in 1-3 minutes.
info "Step 5: Waiting for endpoint to start..."

# Find the endpoint ID by name (we need the ID for subsequent API calls)
ENDPOINT_ID=$(nebius ai endpoint list --format json 2>/dev/null | \
  python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); [print(i['metadata']['id']) for i in items if i['metadata']['name']=='$ENDPOINT_NAME']" 2>/dev/null | head -1)

for i in $(seq 1 30); do
  # Fetch current state from the Nebius API
  STATE=$(nebius ai endpoint get "$ENDPOINT_ID" --format json 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")

  if [ "$STATE" = "RUNNING" ]; then
    ok "Endpoint is RUNNING!"
    break
  elif [ "$STATE" = "ERROR" ]; then
    # Common causes: invalid image URL, registry auth failure, container crash
    error "Endpoint failed to start. Run: nebius ai endpoint logs $ENDPOINT_ID"
  fi

  printf '.'  # Progress indicator while waiting
  sleep 10
done

# ── Get endpoint info ────────────────────────────────────────────────────────
# Extract the public IP address from the endpoint's running instance.
# The IP is assigned by Nebius when the endpoint starts.
PUBLIC_IP=$(nebius ai endpoint get "$ENDPOINT_ID" --format json 2>/dev/null | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
inst=d.get('status',{}).get('instances',[])
for i in inst:
    ip=i.get('public_ip','') or i.get('public_ip_address','')
    if ip: print(ip.split('/')[0])
" 2>/dev/null || echo "N/A")

# Print the deployment summary with all connection info.
echo ""
echo "============================================="
echo "  OpenClaw Serverless — Deployed!"
echo "============================================="
echo ""
echo "  Endpoint ID:  $ENDPOINT_ID"
echo "  Health check: http://${PUBLIC_IP}:8080"
echo "  Gateway:      ws://${PUBLIC_IP}:18789"
echo "  Model:        $INFERENCE_MODEL"
echo "  Platform:     $PLATFORM"
echo ""
echo "  Connect via TUI:"
echo "    openclaw tui --url ws://${PUBLIC_IP}:18789"
echo ""
echo "  Manage:"
echo "    nebius ai endpoint logs $ENDPOINT_ID      # view logs"
echo "    nebius ai endpoint stop $ENDPOINT_ID      # stop (keeps endpoint)"
echo "    nebius ai endpoint delete $ENDPOINT_ID    # delete permanently"
echo ""
