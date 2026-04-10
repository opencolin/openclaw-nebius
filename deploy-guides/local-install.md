# Local Install + Token Factory

*Fastest to start. No Docker, no cloud. Just npm and a Token Factory key.*

## Overview

| | |
|---|---|
| **Infra** | Your machine (any CPU) |
| **Inference** | Token Factory (cloud GPU) |
| **Time to deploy** | ~30 seconds |
| **Cost** | Token Factory per-token only |

Install OpenClaw directly on your machine and connect it to [Token Factory](https://tokenfactory.nebius.com) for inference. No containers, no cloud accounts, no infrastructure.

## Prerequisites

- Node.js 18+
- A Token Factory API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com)

## Steps

### 1. Install OpenClaw

```bash
npm install -g openclaw
```

### 2. Initialize and start

```bash
export TOKEN_FACTORY_API_KEY={your-token-factory-key}
export TOKEN_FACTORY_URL=https://api.tokenfactory.nebius.com/v1
export INFERENCE_MODEL=zai-org/GLM-5
export OPENCLAW_GATEWAY_TOKEN={your-password}

openclaw init
openclaw gateway --bind loopback --auth token --token $OPENCLAW_GATEWAY_TOKEN
```

## Connect

- **Dashboard:** `http://localhost:18789/#token={your-password}`
- **TUI:** `openclaw tui --url ws://localhost:18789 --token {your-password}`

## When to use this

- You want to try OpenClaw right now with zero setup overhead
- Local development and experimentation
- Learning the platform before deploying to the cloud

## Next steps

- [Docker](docker.md) -- make it portable
- [GPU Serverless](gpu-serverless.md) -- self-contained with a local model
- [CPU Serverless](cpu-serverless.md) -- production cloud deployment
