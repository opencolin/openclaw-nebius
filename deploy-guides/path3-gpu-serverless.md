# Path 3: Nebius GPU Serverless + Local Model

*Self-contained. Private. Predictable cost.*

## Overview

Deploy [NemoClaw](https://github.com/NVIDIA/NemoClaw) (NVIDIA's OpenClaw plugin) with a local LLM running on a cloud-hosted GPU. Everything runs in one container — no external API calls. The serverless endpoint auto-pauses when idle, so you only pay for active time.

| | |
|---|---|
| **Infra** | Nebius GPU serverless endpoint |
| **Inference** | Local model running on the GPU |
| **Time to deploy** | ~5 minutes |
| **Cost** | Predictable hourly rate, auto-pauses when idle |

## Why GPU serverless?

- **Custom models** — run your own fine-tuned LLM
- **Data privacy** — all inference stays inside your container, no external API calls
- **Predictable cost** — fixed hourly rate instead of per-token pricing
- **Auto-pause** — endpoint stops billing when idle, restarts on demand

## NemoClaw vs OpenClaw

NemoClaw is not a competing project — it **wraps** OpenClaw and adds NVIDIA-specific capabilities: sandbox execution, enhanced agent planning, and optimized GPU inference. If you're deploying on NVIDIA GPUs with a local model, NemoClaw is the right choice.

## Prerequisites

- [Nebius AI Cloud](https://console.nebius.com) account
- [Nebius CLI](https://docs.nebius.com/cli/install) installed and logged in

## Steps

### 1. Deploy via the Nebius console

Navigate to **Serverless AI → Create endpoint** and configure:

| Field | Value |
|-------|-------|
| **Image** | `ghcr.io/opencolin/nemoclaw-serverless:latest` |
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
  --image ghcr.io/opencolin/nemoclaw-serverless:latest \
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

### 3. Connect

```bash
# SSH tunnel for secure access
ssh -f -N -L 28789:<endpoint-ip>:18789 nebius@<endpoint-ip>

# Connect via TUI
openclaw tui --url ws://localhost:28789 --token {your-password}
```

- **Dashboard:** `http://<endpoint-ip>:18789/#token={your-password}`

## When to use this

- You have a custom fine-tuned model
- Data must stay within a single security boundary
- You prefer predictable hourly billing over per-token
- You need NVIDIA-specific agent capabilities (sandbox, planning)

## Next steps

- [Path 4: Nebius CPU Serverless + Token Factory](path4-cpu-serverless.md) — hybrid cloud approach
