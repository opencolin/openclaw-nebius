# GPU Serverless + Local Model

*Self-contained. Private. Predictable cost.*

## Overview

| | |
|---|---|
| **Infra** | Nebius GPU serverless endpoint |
| **Inference** | Local model running on the GPU |
| **Time to deploy** | ~5 minutes |
| **Cost** | Predictable hourly rate, auto-pauses when idle |

Deploy [NemoClaw](https://github.com/NVIDIA/NemoClaw) (NVIDIA's security container for OpenClaw) with a local LLM running on a cloud-hosted GPU. Everything runs in one container -- no external API calls. The serverless endpoint auto-pauses when idle, so you only pay for active time.

## Prerequisites

- [Nebius AI Cloud](https://console.nebius.com) account
- [Nebius CLI](https://docs.nebius.com/cli/install) installed and logged in

## NemoClaw vs OpenClaw

NemoClaw is not a competing project -- it **wraps** OpenClaw and adds NVIDIA-specific capabilities: sandbox execution, enhanced agent planning, and optimized GPU inference. If you're deploying on NVIDIA GPUs with a local model, NemoClaw is the right choice.

## Steps

### 1. Deploy via the Nebius console

Navigate to **Serverless AI -> Create endpoint** and configure:

| Field | Value |
|-------|-------|
| **Image** | `ghcr.io/colygon/nemoclaw-serverless:latest` |
| **Platform** | GPU platform (e.g., `gpu-h100-b`) |
| **Preset** | Select based on model size |
| **Ports** | `8080`, `18789` |
| **OPENCLAW_WEB_PASSWORD** | `{your-password}` |
| **INFERENCE_MODEL** | Your model ID |
| **Public IP** | Enabled |

### 2. Or deploy via CLI

```bash
nebius ai endpoint create \
  --name nemoclaw-gpu \
  --image ghcr.io/colygon/nemoclaw-serverless:latest \
  --platform gpu-h100-b \
  --preset 1gpu-16vcpu-200gb \
  --container-port 8080 \
  --container-port 18789 \
  --disk-size 100Gi \
  --env "OPENCLAW_WEB_PASSWORD={your-password}" \
  --env "INFERENCE_MODEL={your-model-id}" \
  --public \
  --ssh-key "$(cat ~/.ssh/id_ed25519.pub)"
```

## Connect

```bash
# SSH tunnel for secure access
ssh -f -N -L 28789:<endpoint-ip>:18789 nebius@<endpoint-ip>
```

- **Dashboard:** `http://localhost:28789/#token={your-password}&gatewayUrl=ws://localhost:28789`
- **TUI:** `openclaw tui --url ws://localhost:28789 --token {your-password}`

## When to use this

- You have a custom fine-tuned model
- Data must stay within a single security boundary
- You prefer predictable hourly billing over per-token
- You need NVIDIA-specific agent capabilities (sandbox, planning)

## Next steps

- [CPU Serverless](cpu-serverless.md) -- hybrid cloud approach with Token Factory
- [Local Install](local-install.md) -- try it locally first
