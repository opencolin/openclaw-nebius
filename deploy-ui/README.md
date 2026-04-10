# 🦞 OpenClaw Deploy

Deploy [OpenClaw](https://github.com/nichochar/openclaw) AI agents to [Nebius Cloud](https://nebius.com).

**[→ Open the Deploy UI at claw.moi](https://claw.moi)**

## Choose Your Path

| Path | Method | Inference | Best For |
|------|--------|-----------|----------|
| [**1. Local Install**](../deploy-guides/path1-local-install.md) | `npm install -g openclaw` | Token Factory | Try it now, zero overhead |
| [**2. Docker**](../deploy-guides/path2-docker.md) | `docker run` pre-built image | Token Factory | Portable, reproducible |
| [**3. GPU Serverless**](../deploy-guides/path3-gpu-serverless.md) | NemoClaw on Nebius GPU | Local model | Custom models, data privacy |
| [**4. CPU Serverless**](../deploy-guides/path4-cpu-serverless.md) | OpenClaw on Nebius CPU | Token Factory | Production, always-on |

## Quick Start

**Path 1 — Install locally (30 seconds):**
```bash
npm install -g openclaw
export TOKEN_FACTORY_API_KEY={your-key}
openclaw init && openclaw gateway --bind loopback --auth token
```

**Path 2 — Docker (2 minutes):**
```bash
docker run -e TOKEN_FACTORY_API_KEY={your-key} \
  -e TOKEN_FACTORY_URL=https://api.tokenfactory.nebius.com/v1 \
  -e INFERENCE_MODEL=zai-org/GLM-5 \
  -e OPENCLAW_WEB_PASSWORD={your-password} \
  -p 8080:8080 -p 18789:18789 \
  ghcr.io/opencolin/openclaw-serverless:latest
```

**Path 4 — Nebius CPU Serverless (3 minutes):**
```bash
export TOKEN_FACTORY_API_KEY={your-key}
./install-openclaw-serverless.sh
```

## Screenshots

| Create Agent | Endpoints |
|:---:|:---:|
| ![Create](images/screenshot-create.png) | ![Endpoints](images/screenshot-endpoints.png) |

## What's Included

| | |
|---|---|
| **[Deploy UI](web/)** | Browser-based deployment wizard with endpoint management |
| **[Install Scripts](../deploy-guides/path4-cpu-serverless.md)** | One-command deploy to Nebius serverless |
| **[Docker Images](../deploy-guides/path2-docker.md)** | Pre-built public images on GHCR |
| **[Setup Guide](../deploy-scripts/NEBIUS-SETUP-GUIDE.md)** | Comprehensive Nebius configuration guide |

## Public Docker Images

```bash
docker pull ghcr.io/opencolin/openclaw-serverless:latest   # ~400 MB
docker pull ghcr.io/opencolin/nemoclaw-serverless:latest   # ~1.1 GB
```

## Related Packages

- **[tokenfactory-plugin](../tokenfactory-plugin)** — OpenClaw provider plugin for Nebius Token Factory (44+ models)
- **[nebius-skill](../nebius-skill)** — Claude Code / OpenClaw skill for managing Nebius infrastructure
- **[OpenClaw](https://github.com/nichochar/openclaw)** — The open-source AI agent platform
- **[Token Factory](https://tokenfactory.nebius.com)** — Nebius managed GPU inference API

## License

MIT
