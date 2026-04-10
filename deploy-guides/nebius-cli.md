# Nebius CLI Deployment

*Full control. Step-by-step. Deploy OpenClaw from your terminal with the Nebius CLI.*

## Overview

| | |
|---|---|
| **Infra** | Nebius serverless endpoint (CPU or GPU) |
| **Inference** | Token Factory (CPU path) or local model (GPU path) |
| **Time to deploy** | ~5 minutes |
| **Cost** | Per-second compute + per-token inference (CPU) or hourly GPU rate |

Walk through each step of the deployment yourself using the `nebius` CLI. This gives you full visibility and control over image selection, region, networking, secrets, and SSH access -- useful when the one-command scripts or web UI don't fit your workflow.

## Prerequisites

- [Nebius CLI](https://docs.nebius.com/cli/install) installed and authenticated
- A Token Factory API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com) (CPU path)
- An SSH public key (`~/.ssh/id_ed25519.pub`)

### Install and authenticate the CLI

```bash
curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash
exec -l $SHELL
nebius profile create   # opens browser -- log in with your Nebius account
```

Verify:
```bash
nebius iam whoami --format json
```

## Steps

### 1. Choose image and model

**CPU path** (Token Factory inference):
```bash
IMAGE="ghcr.io/opencolin/openclaw-serverless:latest"
MODEL="zai-org/GLM-5"
```

**GPU path** (local model, NemoClaw):
```bash
IMAGE="ghcr.io/opencolin/nemoclaw-serverless:latest"
MODEL=""  # model runs locally on the GPU
```

### 2. Set your region and platform

```bash
# eu-north1 (Finland) -> cpu-e2    eu-west1 (Paris) -> cpu-d3    us-central1 (US) -> cpu-e2
REGION="eu-north1"
PLATFORM="cpu-e2"    # or gpu-h100-b for GPU path
PRESET="2vcpu-8gb"   # or 1gpu-16vcpu-200gb for GPU path
```

For the Token Factory URL, US uses a different endpoint:
```bash
if [[ "$REGION" == "us-central1" ]]; then
  TOKEN_FACTORY_URL="https://api.tokenfactory.us-central1.nebius.com/v1"
else
  TOKEN_FACTORY_URL="https://api.tokenfactory.nebius.com/v1"
fi
```

### 3. Generate a gateway password

```bash
PASSWORD=$(openssl rand -hex 16)
echo "Save this password: $PASSWORD"
```

### 4. Create the endpoint

```bash
nebius ai endpoint create \
  --name openclaw-agent \
  --image "$IMAGE" \
  --platform "$PLATFORM" \
  --preset "$PRESET" \
  --container-port 8080 \
  --container-port 18789 \
  --disk-size 250Gi \
  --env "TOKEN_FACTORY_API_KEY={your-v1-key}" \
  --env "TOKEN_FACTORY_URL=${TOKEN_FACTORY_URL}" \
  --env "INFERENCE_MODEL=$MODEL" \
  --env "OPENCLAW_WEB_PASSWORD=$PASSWORD" \
  --public \
  --ssh-key "$(cat ~/.ssh/id_ed25519.pub)" \
  --format json
```

> **Public IP quota:** The default limit is 3 public IPs per tenant. Stopped endpoints still consume quota. Delete unused endpoints with `nebius ai endpoint delete <ID>` to free IPs.

### 5. Wait for RUNNING state

```bash
# Poll until ready (typically 1-3 minutes):
nebius ai endpoint get <ENDPOINT_ID> --format json \
  | jq '{state: .status.state, ip: .status.instances[0].public_ip}'
```

Or get the endpoint by name:
```bash
nebius ai endpoint get-by-name openclaw-agent --format json \
  | jq -r '.status.instances[0].public_ip' | cut -d/ -f1
```

### 6. Verify the deployment

```bash
ssh -o StrictHostKeyChecking=no nebius@<PUBLIC_IP> "curl -s http://localhost:8080"
# Expected: {"status":"healthy","service":"openclaw-serverless","model":"zai-org/GLM-5",...}
```

### 7. Set up the SSH tunnel

From your local machine, tunnel the dashboard port:
```bash
ssh -f -N -o StrictHostKeyChecking=no -L 28789:<PUBLIC_IP>:18789 nebius@<PUBLIC_IP>
```

### 8. Approve device pairing

First-time access requires pairing approval. The gateway token must be passed as an env var:
```bash
ssh -o StrictHostKeyChecking=no nebius@<PUBLIC_IP> \
  "sudo docker exec \$(sudo docker ps -q | head -1) \
   env OPENCLAW_GATEWAY_TOKEN=$PASSWORD openclaw devices approve --latest"
```

## Connect

- **Dashboard:** `http://localhost:28789/#token=<PASSWORD>&gatewayUrl=ws://localhost:28789`
- **TUI:** `openclaw tui --url ws://localhost:28789 --token <PASSWORD>`
- **SSH:** `nebius ai endpoint ssh <ENDPOINT_ID>`

If the SSH tunnel dies, restart it:
```bash
ssh -f -N -L 28789:<PUBLIC_IP>:18789 nebius@<PUBLIC_IP>
```

## Managing endpoints

```bash
# List all endpoints
nebius ai endpoint list --format json

# Get endpoint details
nebius ai endpoint get <ENDPOINT_ID> --format json

# Stop (pauses billing, keeps config)
nebius ai endpoint stop <ENDPOINT_ID>

# Start again
nebius ai endpoint start <ENDPOINT_ID>

# Delete
nebius ai endpoint delete <ENDPOINT_ID>
```

## Region and platform reference

| Region | Location | CPU Platform | Token Factory URL |
|--------|----------|-------------|-------------------|
| `eu-north1` | Finland | `cpu-e2` | `https://api.tokenfactory.nebius.com/v1` |
| `eu-west1` | Paris | `cpu-d3` | `https://api.tokenfactory.nebius.com/v1` |
| `us-central1` | US | `cpu-e2` | `https://api.tokenfactory.us-central1.nebius.com/v1` |

## Headless environments

If you can't run `nebius profile create` interactively (CI/CD, Claude Code on the web), get your IAM token on a local machine and pass it:

```bash
# On your local machine:
nebius iam get-access-token

# In the headless environment:
export NEBIUS_IAM_TOKEN="<paste-token>"
```

> **IAM token** (`nebius iam get-access-token`) is for Nebius Cloud CLI operations (creating endpoints, VMs, etc.). This is different from the **Token Factory API key** (starts with `v1.`), which is for model inference inside your deployed container.

## Secrets management

Store API keys in MysteryBox instead of passing them as plain-text env vars:

```bash
nebius mysterybox secret create \
  --name token-factory-key \
  --parent-id {project-id} \
  --secret-version-payload '[{"key":"TOKEN_FACTORY_API_KEY","string_value":"{your-key}"}]'
```

## When to use this

- You want full visibility into each step of the deployment
- You're automating deployments in scripts or CI/CD
- The one-command scripts or web UI don't fit your workflow
- You need to customize flags the other methods don't expose

## Next steps

- [CPU Serverless](cpu-serverless.md) -- one-command deploy for quick setup
- [GPU Serverless](gpu-serverless.md) -- deploy with a local model on GPU
- See the [Nebius Setup Guide](../deploy-scripts/NEBIUS-SETUP-GUIDE.md) for account and CLI configuration
