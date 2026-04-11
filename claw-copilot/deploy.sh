#!/bin/bash
# =============================================================================
# Claw Copilot — Deploy to Nebius Serverless
# =============================================================================
#
# Deploys the CopilotKit deployment assistant as a serverless container on
# Nebius Cloud. Runs on a CPU-only endpoint with the nebius CLI baked in
# so the AI agent can execute real infrastructure commands.
#
# Prerequisites:
#   - nebius CLI installed and authenticated
#   - Docker installed
#   - A Token Factory API key from https://studio.nebius.ai/
#
# Usage:
#   export TOKEN_FACTORY_API_KEY="v1.xxx..."
#   ./deploy.sh
#
# Optional environment variables:
#   REGION             Nebius region (default: eu-north1)
#   PROJECT_ID         Nebius project ID (auto-detected if not set)
#   NEBIUS_MODEL       LLM model for the assistant (default: deepseek-ai/DeepSeek-V3.2)
#   TOKEN_FACTORY_URL  Token Factory API URL (auto-set based on region)
#
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

REGION="${REGION:-eu-north1}"
PROJECT_ID="${PROJECT_ID:-}"
ENDPOINT_NAME="${ENDPOINT_NAME:-claw-copilot}"
NEBIUS_MODEL="${NEBIUS_MODEL:-deepseek-ai/DeepSeek-V3.2}"

# Auto-set Token Factory URL based on region
if [ -z "${TOKEN_FACTORY_URL:-}" ]; then
  if [ "$REGION" = "us-central1" ]; then
    TOKEN_FACTORY_URL="https://api.tokenfactory.us-central1.nebius.com/v1"
  else
    TOKEN_FACTORY_URL="https://api.tokenfactory.nebius.com/v1"
  fi
fi

# CPU platform depends on region (eu-west1 uses cpu-d3, not cpu-e2)
if [ "$REGION" = "eu-west1" ]; then
  PLATFORM="cpu-d3"
else
  PLATFORM="cpu-e2"
fi

PRESET="2vcpu-8gb"

# ── Helper functions ─────────────────────────────────────────────────────────

info()  { printf '\033[1;34m>>>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m   %s\n' "$*"; }
error() { printf '\033[1;31m✗\033[0m   %s\n' "$*"; exit 1; }

# ── Preflight checks ────────────────────────────────────────────────────────

info "Preflight checks..."

[ -z "${TOKEN_FACTORY_API_KEY:-}" ] && error "Set TOKEN_FACTORY_API_KEY env var. Get one at https://studio.nebius.ai/"
command -v nebius &>/dev/null || error "Nebius CLI not installed. Run: curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash"
command -v docker &>/dev/null || error "Docker not installed."
nebius iam get-access-token >/dev/null 2>&1 || error "Not authenticated. Run: nebius profile create"
ok "Authenticated"

# Auto-detect project ID
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(nebius iam project list --format json 2>/dev/null | \
    python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['metadata']['id'] if items else '')" 2>/dev/null || echo "")
  [ -z "$PROJECT_ID" ] && error "Could not auto-detect project. Set PROJECT_ID env var."
  ok "Using project: $PROJECT_ID"
fi

echo ""
echo "  Region:   $REGION"
echo "  Platform: $PLATFORM ($PRESET)"
echo "  Model:    $NEBIUS_MODEL"
echo "  TF URL:   $TOKEN_FACTORY_URL"
echo ""

# ── Step 1: Container Registry ──────────────────────────────────────────────

info "Step 1: Finding or creating container registry..."

REGISTRY_ID=$(nebius registry list --format json 2>/dev/null | \
  python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['metadata']['id'] if items else '')" 2>/dev/null || echo "")

if [ -z "$REGISTRY_ID" ]; then
  REGISTRY_ID=$(nebius registry create \
    --name openclaw \
    --parent-id "$PROJECT_ID" \
    --format json | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
  ok "Created registry: $REGISTRY_ID"
else
  ok "Using existing registry: $REGISTRY_ID"
fi

REGISTRY_ID="${REGISTRY_ID#registry-}"
REGISTRY_URL="cr.${REGION}.nebius.cloud"
IMAGE="${REGISTRY_URL}/${REGISTRY_ID}/claw-copilot:latest"

# ── Step 2: Build Docker Image ──────────────────────────────────────────────

info "Step 2: Building Docker image..."

# Build from monorepo root (one level up) so Dockerfile can COPY nebius-skill/
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker buildx build \
  --platform linux/amd64 \
  -f "$REPO_ROOT/claw-copilot/Dockerfile" \
  -t "$IMAGE" \
  "$REPO_ROOT" 2>&1 | tail -10

ok "Image built: $IMAGE"

# ── Step 3: Push to Registry ────────────────────────────────────────────────

info "Step 3: Pushing image to registry..."

nebius iam get-access-token | docker login "$REGISTRY_URL" --username iam --password-stdin 2>&1
docker push "$IMAGE" 2>&1 | tail -5
ok "Image pushed"

# ── Step 4: Deploy Endpoint ─────────────────────────────────────────────────

info "Step 4: Deploying endpoint on $PLATFORM ($PRESET)..."

nebius ai endpoint create \
  --name "$ENDPOINT_NAME" \
  --image "$IMAGE" \
  --platform "$PLATFORM" \
  --preset "$PRESET" \
  --container-port 3001 \
  --env "TOKEN_FACTORY_API_KEY=${TOKEN_FACTORY_API_KEY}" \
  --env "TOKEN_FACTORY_URL=${TOKEN_FACTORY_URL}" \
  --env "NEBIUS_MODEL=${NEBIUS_MODEL}" \
  --public \
  2>&1

# ── Step 5: Wait for RUNNING ────────────────────────────────────────────────

info "Step 5: Waiting for endpoint to start..."

ENDPOINT_ID=$(nebius ai endpoint list --format json 2>/dev/null | \
  python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); [print(i['metadata']['id']) for i in items if i['metadata']['name']=='$ENDPOINT_NAME']" 2>/dev/null | head -1)

[ -z "$ENDPOINT_ID" ] && error "Could not find endpoint '$ENDPOINT_NAME' after creation"

for i in $(seq 1 30); do
  STATE=$(nebius ai endpoint get "$ENDPOINT_ID" --format json 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")

  if [ "$STATE" = "RUNNING" ]; then
    ok "Endpoint is RUNNING!"
    break
  elif [ "$STATE" = "ERROR" ] || [ "$STATE" = "FAILED" ]; then
    error "Endpoint failed. Run: nebius ai endpoint logs $ENDPOINT_ID"
  fi

  printf '.'
  sleep 10
done

# ── Get Public IP ────────────────────────────────────────────────────────────

PUBLIC_IP=$(nebius ai endpoint get "$ENDPOINT_ID" --format json 2>/dev/null | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
inst=d.get('status',{}).get('instances',[])
for i in inst:
    ip=i.get('public_ip','') or i.get('public_ip_address','')
    if ip: print(ip.split('/')[0])
" 2>/dev/null || echo "N/A")

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "============================================="
echo "  Claw Copilot — Deployed!"
echo "============================================="
echo ""
echo "  URL:          http://${PUBLIC_IP}:3001"
echo "  Health:       http://${PUBLIC_IP}:3001/api/health"
echo "  Endpoint ID:  $ENDPOINT_ID"
echo "  Model:        $NEBIUS_MODEL"
echo "  Platform:     $PLATFORM ($PRESET)"
echo "  Region:       $REGION"
echo ""
echo "  Manage:"
echo "    nebius ai endpoint logs $ENDPOINT_ID      # view logs"
echo "    nebius ai endpoint stop $ENDPOINT_ID      # stop"
echo "    nebius ai endpoint delete $ENDPOINT_ID    # delete"
echo ""
