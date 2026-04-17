# CPU Serverless + Token Factory

*Production-ready. Always-on. The best of both worlds.*

## Overview

| | |
|---|---|
| **Infra** | Nebius CPU serverless (2 vCPUs, 8 GiB) |
| **Inference** | Token Factory (cloud GPU) |
| **Time to deploy** | ~3 minutes |
| **Cost** | Per-second compute + per-token inference |

Deploy OpenClaw on a Nebius CPU serverless endpoint with [Token Factory](https://tokenfactory.nebius.com) handling inference. A production-grade always-on agent with elastic cloud inference -- the cheapest cloud footprint with the most capable models.

## Prerequisites

- [Nebius AI Cloud](https://console.nebius.com) account
- [Token Factory](https://tokenfactory.nebius.com) API key
- [Nebius CLI](https://docs.nebius.com/cli/install) installed and logged in

## Steps

### 1. One-command script

```bash
export TOKEN_FACTORY_API_KEY={your-token-factory-key}
./install-openclaw-serverless.sh
```

The script handles everything: registry creation, Docker build, push, and endpoint deployment.

### 2. Or deploy via the Nebius console

Navigate to **Serverless AI -> Create endpoint** and configure:

| Field | Value |
|-------|-------|
| **Image** | `ghcr.io/opencolin/openclaw-serverless:latest` |
| **Platform** | `cpu-e2` (EU North/US Central) or `cpu-d3` (EU West) |
| **Preset** | `2vcpu-8gb` |
| **Ports** | `8080`, `18789` |
| **TOKEN_FACTORY_API_KEY** | `{your-token-factory-key}` |
| **TOKEN_FACTORY_URL** | `https://api.tokenfactory.nebius.com/v1` |
| **INFERENCE_MODEL** | `zai-org/GLM-5` |
| **OPENCLAW_WEB_PASSWORD** | `{your-password}` |
| **Public IP** | Enabled |

### 3. Or deploy via CLI

```bash
nebius ai endpoint create \
  --name openclaw-agent \
  --image ghcr.io/opencolin/openclaw-serverless:latest \
  --platform cpu-e2 \
  --preset 2vcpu-8gb \
  --container-port 8080 \
  --container-port 18789 \
  --disk-size 100Gi \
  --env "TOKEN_FACTORY_API_KEY={your-token-factory-key}" \
  --env "TOKEN_FACTORY_URL=https://api.tokenfactory.nebius.com/v1" \
  --env "INFERENCE_MODEL=zai-org/GLM-5" \
  --env "OPENCLAW_WEB_PASSWORD={your-password}" \
  --public \
  --ssh-key "$(cat ~/.ssh/id_ed25519.pub)"
```

### 4. Or use the Deploy UI

Run the [Deploy UI](../deploy-ui/web/) locally for a visual experience with MysteryBox secrets integration, endpoint monitoring, and multi-region support.

```bash
cd deploy-ui/web && npm install && npm start
# Open http://localhost:3000
```

## Connect

```bash
# SSH tunnel for secure WebSocket access
ssh -f -N -L 28789:<endpoint-ip>:18789 nebius@<endpoint-ip>
```

- **Dashboard:** `http://localhost:28789/#token={your-password}&gatewayUrl=ws://localhost:28789`
- **TUI:** `openclaw tui --url ws://localhost:28789 --token {your-password}`
- **Health check:** `curl http://<endpoint-ip>:8080`

## Region and platform mapping

| Region | Location | CPU Platform |
|--------|----------|-------------|
| `eu-north1` | Finland | `cpu-e2` (Intel Ice Lake) |
| `eu-west1` | Paris | `cpu-d3` (AMD EPYC) |
| `us-central1` | US | `cpu-e2` (Intel Ice Lake) |

## Secrets management

Store API keys securely with [MysteryBox](https://console.nebius.com/mysterybox) instead of pasting them into environment variables:

```bash
nebius mysterybox secret create \
  --name token-factory-key \
  --parent-id {project-id} \
  --secret-version-payload '[{"key":"TOKEN_FACTORY_API_KEY","string_value":"{your-key}"}]'
```

## When to use this

- Production agents that need to be accessible 24/7
- You want the cheapest cloud deployment with no GPU overhead
- Elastic inference -- Token Factory scales across its GPU fleet
- Managed start/stop lifecycle for cost control

## Next steps

- Connect messaging channels (Telegram, WhatsApp, Discord, Signal)
- Set up monitoring and alerts
- See the [Nebius Setup Guide](../deploy-scripts/NEBIUS-SETUP-GUIDE.md) for advanced configuration
