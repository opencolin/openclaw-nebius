# Path 1: Install OpenClaw Locally + Token Factory

*Fastest to start. No Docker, no cloud. Just npm and a Token Factory key.*

## Overview

Install OpenClaw directly on your machine and connect it to [Token Factory](https://tokenfactory.nebius.com) for inference. This is the quickest way to get an agent running — no containers, no cloud accounts, no infrastructure.

| | |
|---|---|
| **Infra** | Your machine (any CPU) |
| **Inference** | Token Factory (cloud GPU) |
| **Time to deploy** | ~30 seconds |
| **Cost** | Token Factory per-token only |

## Steps

### 1. Get a Token Factory API key

Sign up at [tokenfactory.nebius.com](https://tokenfactory.nebius.com) and create an API key.

### 2. Install OpenClaw

```bash
npm install -g openclaw
```

### 3. Initialize and start

```bash
export TOKEN_FACTORY_API_KEY={your-token-factory-key}
export TOKEN_FACTORY_URL=https://api.tokenfactory.nebius.com/v1
export INFERENCE_MODEL=zai-org/GLM-5
export OPENCLAW_GATEWAY_TOKEN={your-password}

openclaw init
openclaw gateway --bind loopback --auth token --token $OPENCLAW_GATEWAY_TOKEN
```

### 4. Connect

- **Dashboard:** `http://localhost:18789/#token={your-password}`
- **TUI:** `openclaw tui --url ws://localhost:18789 --token {your-password}`

## When to use this

- You want to try OpenClaw right now with zero setup overhead
- Local development and experimentation
- Learning the platform before deploying to the cloud

## Next steps

- [Path 2: Docker + Token Factory](docs/path2-docker.md) — make it portable
- [Path 3: Nebius GPU Serverless](docs/path3-gpu-serverless.md) — self-contained with a local model
- [Path 4: Nebius CPU Serverless + Token Factory](docs/path4-cpu-serverless.md) — production cloud deployment
