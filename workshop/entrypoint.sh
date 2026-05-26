#!/usr/bin/env bash
# Workshop container entrypoint.
#
# Validates env vars, materializes ~/.openclaw/openclaw.json from the template,
# installs the Token Factory provider plugin, then starts the OpenClaw gateway.
# A tiny health responder runs on $OPENCLAW_HEALTH_PORT for Docker healthchecks.

set -euo pipefail

log()  { printf '\033[1;34m>>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m  %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m  %s\n' "$*" >&2; exit 1; }

# ── 1. Required env vars ─────────────────────────────────────────────────────
: "${NEBIUS_API_KEY:?NEBIUS_API_KEY is required — get one at https://tokenfactory.nebius.com}"
: "${TAVILY_API_KEY:?TAVILY_API_KEY is required — get one at https://app.tavily.com}"
: "${SLACK_BOT_TOKEN:?SLACK_BOT_TOKEN is required (xoxb-... from your Slack app)}"
: "${SLACK_APP_TOKEN:?SLACK_APP_TOKEN is required (xapp-... — Socket Mode app-level token)}"

# Sanity-check token shapes early — failing here is a much better error than
# discovering it on the first Slack/Tavily/TokenFactory request.
[[ "${SLACK_BOT_TOKEN}" == xoxb-* ]] || die "SLACK_BOT_TOKEN must start with 'xoxb-'"
[[ "${SLACK_APP_TOKEN}" == xapp-* ]] || die "SLACK_APP_TOKEN must start with 'xapp-' (Socket Mode app-level token)"

# ── 2. Optional env vars with sensible defaults ─────────────────────────────
export TOKEN_FACTORY_URL="${TOKEN_FACTORY_URL:-https://api.tokenfactory.nebius.com/v1}"
export OPENCLAW_MODEL="${OPENCLAW_MODEL:-tokenfactory/moonshotai/Kimi-K2.6}"
export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(openssl rand -hex 16 2>/dev/null || echo workshop-$(hostname))}"

# ── 3. Materialize the OpenClaw config ──────────────────────────────────────
# OpenClaw expects ~/.openclaw/openclaw.json. We intentionally don't override
# OPENCLAW_HOME/OPENCLAW_STATE_DIR — those nest the actual store one level
# deeper (~/.openclaw/.openclaw/) and split config between two paths.
CONFIG_DIR="${HOME}/.openclaw"
CONFIG_PATH="${CONFIG_DIR}/openclaw.json"
mkdir -p "${CONFIG_DIR}"
envsubst < /etc/openclaw/openclaw.json.template > "${CONFIG_PATH}"

# Validate it's still valid JSON after substitution (catches stray $VAR typos).
jq empty "${CONFIG_PATH}" \
  || die "Generated openclaw.json is not valid JSON. Check the template."

ok "Wrote ${CONFIG_PATH}"
log "  Model:     ${OPENCLAW_MODEL}"
log "  TF URL:    ${TOKEN_FACTORY_URL}"
log "  Gateway:   :${OPENCLAW_GATEWAY_PORT} (token len=${#OPENCLAW_GATEWAY_TOKEN})"

# ── 4. Install / enable plugins ─────────────────────────────────────────────
# These are idempotent — re-installing or re-enabling is a no-op.
log "Installing Token Factory plugin (clawhub:tokenfactory)…"
openclaw plugins install clawhub:tokenfactory 2>&1 | sed 's/^/  | /' || warn "tokenfactory install non-zero (often already installed)"

log "Installing Slack channel plugin (@openclaw/slack)…"
openclaw plugins install @openclaw/slack 2>&1 | sed 's/^/  | /' || warn "slack install non-zero (often already installed)"

log "Enabling bundled Tavily plugin…"
openclaw plugins enable tavily 2>&1 | sed 's/^/  | /' || warn "tavily enable non-zero (often already enabled)"

ok "Plugins ready"

# ── 5. Tiny health responder (so Docker HEALTHCHECK passes) ─────────────────
(
  while true; do
    {
      printf 'HTTP/1.1 200 OK\r\n'
      printf 'Content-Type: application/json\r\n'
      printf 'Connection: close\r\n\r\n'
      printf '{"status":"ok","service":"openclaw-workshop","model":"%s"}\n' "${OPENCLAW_MODEL}"
    } | nc -l -p "${OPENCLAW_HEALTH_PORT}" -q 1 2>/dev/null || true
  done
) &

# ── 6. Start the OpenClaw gateway in the foreground ─────────────────────────
# `gateway run` is the foreground variant (`start` installs a launchd/systemd
# service which doesn't apply inside a container).
log "Starting OpenClaw gateway…"
log "Dashboard:  http://localhost:${OPENCLAW_GATEWAY_PORT}/#token=${OPENCLAW_GATEWAY_TOKEN}&gatewayUrl=ws://localhost:${OPENCLAW_GATEWAY_PORT}"
log "Slack:      connecting via Socket Mode (no public URL required)"
log ""
log "Try this in Slack:    @your-bot what's the latest Anthropic news?"
log ""

exec openclaw gateway \
  --bind lan \
  --port "${OPENCLAW_GATEWAY_PORT}" \
  --auth token \
  --token "${OPENCLAW_GATEWAY_TOKEN}" \
  run
