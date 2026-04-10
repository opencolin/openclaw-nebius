# Docker + Token Factory

*Portable. Reproducible. Run OpenClaw anywhere in a container.*

## Overview

| | |
|---|---|
| **Infra** | Any machine with Docker |
| **Inference** | Token Factory (cloud GPU) |
| **Time to deploy** | ~2 minutes |
| **Cost** | Token Factory per-token only |

Run OpenClaw in Docker on any machine -- laptop, VPS, home server. All inference is handled by [Token Factory](https://tokenfactory.nebius.com), so you don't need a GPU.

## Prerequisites

- Docker installed
- A Token Factory API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com)

## Steps

### 1. Run the container

```bash
docker run -d \
  -e TOKEN_FACTORY_API_KEY={your-token-factory-key} \
  -e TOKEN_FACTORY_URL=https://api.tokenfactory.nebius.com/v1 \
  -e INFERENCE_MODEL=zai-org/GLM-5 \
  -e OPENCLAW_WEB_PASSWORD={your-password} \
  -p 8080:8080 -p 18789:18789 \
  ghcr.io/colygon/openclaw-serverless:latest
```

### 2. Verify

```bash
curl http://localhost:8080
# {"status":"healthy","service":"openclaw-serverless","model":"zai-org/GLM-5",...}
```

## Connect

- **Dashboard:** `http://localhost:18789/#token={your-password}`
- **TUI:** `openclaw tui --url ws://localhost:18789 --token {your-password}`

## Available models

| Model ID | Description |
|----------|-------------|
| `zai-org/GLM-5` | Latest GLM from Zhipu AI -- strong general-purpose reasoning |
| `deepseek-ai/DeepSeek-R1-0528` | DeepSeek reasoning model -- complex tasks |
| `MiniMaxAI/MiniMax-M2.5` | Fast, powerful open-source model |

> **Model ID format matters.** Use Token Factory IDs (e.g., `zai-org/GLM-5`), not HuggingFace IDs. Wrong format = silent 404 errors.

## Pre-built images

| Image | Size | Description |
|-------|------|-------------|
| `ghcr.io/colygon/openclaw-serverless:latest` | ~400 MB | OpenClaw agent (CPU) |
| `ghcr.io/colygon/nemoclaw-serverless:latest` | ~1.1 GB | OpenClaw + NVIDIA NemoClaw plugin |

## When to use this

- Teams that want identical environments across dev/staging/prod
- CI/CD pipelines
- Self-hosted deployments on your own infrastructure
- Running on a VPS or home server

## Next steps

- [GPU Serverless](gpu-serverless.md) -- self-contained with a local model
- [CPU Serverless](cpu-serverless.md) -- production cloud deployment
