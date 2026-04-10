# NemoClaw on Nebius Serverless — Build Plan

## Overview

Deploy NVIDIA NemoClaw (autonomous AI agent sandbox) on Nebius Serverless AI, replacing NVIDIA's default inference gateway with **Nebius Token Factory** for LLM inference. This gives us a cloud-native, pay-per-second NemoClaw deployment with GPU access and OpenAI-compatible inference via Token Factory.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Nebius Serverless                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │          Nebius Serverless Endpoint                │  │
│  │          (GPU: H100/H200/L40S)                    │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  Custom NemoClaw Container                  │  │  │
│  │  │                                             │  │  │
│  │  │  ┌──────────┐  ┌─────────────────────────┐ │  │  │
│  │  │  │ NemoClaw │  │ Inference Proxy (nginx) │ │  │  │
│  │  │  │ Sandbox  │──│ inference.local → Token  │ │  │  │
│  │  │  │ + Plugin │  │ Factory API             │ │  │  │
│  │  │  └──────────┘  └─────────────────────────┘ │  │  │
│  │  │                                             │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │ HTTPS
                           ▼
              ┌──────────────────────────┐
              │  Nebius Token Factory    │
              │  api.tokenfactory.       │
              │  nebius.com/v1/          │
              │  (DeepSeek-R1, etc.)     │
              └──────────────────────────┘
```

**Key insight:** NemoClaw's sandbox expects inference at `https://inference.local/v1`. Instead of using NVIDIA's OpenShell gateway, we run a lightweight reverse proxy inside the container that rewrites `inference.local` requests to Token Factory's API, injecting the Token Factory API key.

---

## Prerequisites

| Item | Details |
|------|---------|
| **Nebius AI Cloud account** | Admin role in tenant group |
| **Nebius CLI** | Installed and configured (`nebius` command) |
| **Nebius Token Factory account** | API key from tokenfactory.nebius.com |
| **Quota** | At least 1 GPU VM + 1 VPC allocation |
| **Docker** | Local Docker for building the custom image |
| **Nebius Container Registry** | For hosting the custom NemoClaw image |

---

## Phase 1: Environment Setup

### 1.1 Install and Configure Nebius CLI

```bash
# Install Nebius CLI (follow docs.nebius.com/cli/install)
curl -sSL https://storage.ai.nebius.cloud/nebius/install.sh | bash

# Configure CLI with your credentials
nebius init
```

### 1.2 Create Nebius Container Registry

```bash
# Create a container registry to host the custom NemoClaw image
nebius container-registry create --name nemoclaw-registry

# Authenticate Docker to the Nebius registry
nebius container-registry configure-docker
```

### 1.3 Set Up Networking

```bash
# Create a VPC network
nebius vpc network create --name nemoclaw-network

# Create a subnet (choose region with GPU availability, e.g., eu-north1 for H100)
nebius vpc subnet create \
  --name nemoclaw-subnet \
  --network-name nemoclaw-network \
  --cidr 10.0.0.0/24

# Note the subnet ID for later use
SUBNET_ID=$(nebius vpc subnet get-by-name nemoclaw-subnet --format json | jq -r '.metadata.id')
```

---

## Phase 2: Build Custom NemoClaw Container

### 2.1 Project Structure

```
nemoclaw/
├── Dockerfile                  # Custom NemoClaw image for Nebius
├── nginx-proxy.conf            # Reverse proxy: inference.local → Token Factory
├── entrypoint.sh               # Container startup script
├── nemoclaw-config.yaml        # NemoClaw configuration overrides
└── BUILD_PLAN.md               # This file
```

### 2.2 Create the Inference Proxy Config

**File: `nginx-proxy.conf`**

NemoClaw's sandbox routes all LLM calls to `https://inference.local/v1`. We intercept this with nginx and forward to Token Factory.

```nginx
server {
    listen 443 ssl;
    server_name inference.local;

    ssl_certificate     /etc/nginx/ssl/inference.crt;
    ssl_certificate_key /etc/nginx/ssl/inference.key;

    location /v1/ {
        proxy_pass https://api.tokenfactory.nebius.com/v1/;
        proxy_ssl_server_name on;

        # Inject Token Factory API key
        proxy_set_header Authorization "Bearer ${TOKEN_FACTORY_API_KEY}";
        proxy_set_header Host api.tokenfactory.nebius.com;
        proxy_set_header Content-Type $content_type;

        # Strip any existing auth from the sandbox
        proxy_set_header X-Original-Auth $http_authorization;

        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
    }
}
```

### 2.3 Create the Entrypoint Script

**File: `entrypoint.sh`**

```bash
#!/bin/bash
set -e

# ── 1. Generate self-signed cert for inference.local ──
mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/inference.key \
  -out /etc/nginx/ssl/inference.crt \
  -subj "/CN=inference.local" 2>/dev/null

# ── 2. Add inference.local to /etc/hosts ──
echo "127.0.0.1 inference.local" >> /etc/hosts

# ── 3. Substitute the Token Factory API key into nginx config ──
envsubst '${TOKEN_FACTORY_API_KEY}' \
  < /etc/nginx/templates/nginx-proxy.conf \
  > /etc/nginx/conf.d/inference-proxy.conf

# ── 4. Start nginx reverse proxy in background ──
nginx -g 'daemon on;'

# ── 5. Trust the self-signed cert ──
cp /etc/nginx/ssl/inference.crt /usr/local/share/ca-certificates/inference.crt
update-ca-certificates 2>/dev/null || true

# Set NODE_EXTRA_CA_CERTS for Node.js to trust our self-signed cert
export NODE_EXTRA_CA_CERTS=/etc/nginx/ssl/inference.crt

# ── 6. Configure OpenClaw to use inference.local endpoint ──
export OPENCLAW_API_BASE_URL="https://inference.local/v1"
export OPENCLAW_MODEL="${INFERENCE_MODEL:-deepseek-ai/DeepSeek-R1-0528}"

# ── 7. Start NemoClaw ──
echo "NemoClaw starting on Nebius Serverless..."
echo "Inference routed to: Nebius Token Factory"
echo "Model: ${OPENCLAW_MODEL}"

# Run the NemoClaw sandbox
exec nemoclaw onboard --non-interactive 2>&1
```

### 2.4 Create the Dockerfile

**File: `Dockerfile`**

```dockerfile
# ============================================================
# NemoClaw on Nebius Serverless
# Base: NVIDIA's NemoClaw sandbox + nginx inference proxy
# ============================================================
FROM node:22-slim AS base

# ── System dependencies ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-yaml \
    curl git ca-certificates iproute2 \
    nginx openssl gettext-base \
    && rm -rf /var/lib/apt/lists/*

# ── Install OpenClaw CLI ──
RUN npm install -g openclaw@2026.3.11

# ── Install NemoClaw plugin ──
RUN npm install -g @nvidia/nemoclaw@latest

# ── Set up nginx proxy config template ──
RUN mkdir -p /etc/nginx/templates /etc/nginx/ssl
COPY nginx-proxy.conf /etc/nginx/templates/nginx-proxy.conf

# ── Remove default nginx config ──
RUN rm -f /etc/nginx/sites-enabled/default

# ── Create sandbox user ──
RUN useradd -m -s /bin/bash sandbox
RUN mkdir -p /sandbox /tmp && chown sandbox:sandbox /sandbox /tmp

# ── Copy entrypoint ──
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# ── Expose port for Nebius health checks ──
EXPOSE 8080

WORKDIR /sandbox

# Note: entrypoint runs as root initially for nginx/certs,
# then NemoClaw sandbox drops privileges internally
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

### 2.5 Build and Push

```bash
# Set your registry URL
REGISTRY="cr.eu-north1.nebius.cloud/<registry-id>"

# Build the image
docker build -t ${REGISTRY}/nemoclaw:latest .

# Push to Nebius Container Registry
docker push ${REGISTRY}/nemoclaw:latest
```

---

## Phase 3: Deploy to Nebius Serverless

### 3.1 Create the Serverless Endpoint

```bash
# Set variables
REGISTRY="cr.eu-north1.nebius.cloud/<registry-id>"
TOKEN_FACTORY_KEY="<your-token-factory-api-key>"
NEBIUS_AUTH_TOKEN="<your-nebius-auth-token>"

# Deploy NemoClaw as a serverless endpoint
nebius ai endpoint create \
  --name nemoclaw-agent \
  --image ${REGISTRY}/nemoclaw:latest \
  --platform gpu-h100-sxm \
  --preset 1gpu-16vcpu-200gb \
  --container-port 8080 \
  --disk-size 100Gi \
  --shm-size 16Gi \
  --env TOKEN_FACTORY_API_KEY="${TOKEN_FACTORY_KEY}" \
  --env INFERENCE_MODEL="deepseek-ai/DeepSeek-R1-0528" \
  --env NODE_ENV=production \
  --public \
  --auth token \
  --token "${NEBIUS_AUTH_TOKEN}" \
  --subnet-id ${SUBNET_ID}
```

### 3.2 Verify Deployment

```bash
# Get the endpoint ID
ENDPOINT_ID=$(nebius ai endpoint get-by-name nemoclaw-agent --format json | jq -r '.metadata.id')

# Check status (should show RUNNING after ~30-60s)
nebius ai endpoint get ${ENDPOINT_ID}

# Stream logs to verify startup
nebius ai endpoint logs ${ENDPOINT_ID} --follow --since 5m --timestamps
```

### 3.3 GPU Platform Selection Guide

| Use Case | Platform | Preset | Cost |
|----------|----------|--------|------|
| **Dev/test** | `gpu-l40s-d` | `1gpu-8vcpu-96gb` | Lowest |
| **Production (standard)** | `gpu-h100-sxm` | `1gpu-16vcpu-200gb` | Medium |
| **Production (high perf)** | `gpu-h200-sxm` | `1gpu-16vcpu-200gb` | Higher |
| **Multi-agent** | `gpu-h100-sxm` | `8gpu-128vcpu-1600gb` | Highest |

> **Note:** Since inference is offloaded to Token Factory, the local GPU is primarily for sandbox compute tasks the agent performs (code execution, data processing). For inference-only workloads, L40S or even CPU may suffice.

---

## Phase 4: Token Factory Integration

### 4.1 How It Works

1. OpenClaw agent inside the sandbox makes LLM API calls to `https://inference.local/v1`
2. The nginx reverse proxy intercepts these calls
3. Proxy rewrites the destination to `https://api.tokenfactory.nebius.com/v1/`
4. Proxy injects the `Authorization: Bearer <TOKEN_FACTORY_KEY>` header
5. Token Factory processes the request and returns the response
6. The agent receives the response as if it came from a local inference server

### 4.2 Model Configuration

Token Factory supports multiple models. Set via the `INFERENCE_MODEL` env var:

```bash
# Update the model without redeploying
nebius ai endpoint update ${ENDPOINT_ID} \
  --env INFERENCE_MODEL="deepseek-ai/DeepSeek-R1-0528"
```

### 4.3 Token Factory API Key Rotation

```bash
# Rotate the Token Factory key
nebius ai endpoint update ${ENDPOINT_ID} \
  --env TOKEN_FACTORY_API_KEY="<new-key>"
```

---

## Phase 5: Security Hardening

### 5.1 Network Policies

NemoClaw's sandbox has built-in network policies. On Nebius, additionally:

```bash
# Restrict egress to only Token Factory (if supported by Nebius VPC)
# The sandbox's internal policies already block unauthorized outbound,
# but belt-and-suspenders is good practice.
```

### 5.2 Secrets Management

For production, avoid passing API keys as plain env vars:

- **Option A:** Use Nebius IAM service accounts with scoped permissions
- **Option B:** Mount secrets via volume from Nebius Object Storage (S3)
- **Option C:** Use a secrets manager and fetch at container startup

### 5.3 Auth Token for Endpoint Access

The `--auth token` flag on the endpoint ensures only authorized users can reach the NemoClaw sandbox:

```bash
# Access the endpoint
curl -H "Authorization: Bearer ${NEBIUS_AUTH_TOKEN}" \
  https://<endpoint-url>:8080/status
```

---

## Phase 6: Operations

### 6.1 Monitoring

```bash
# Stream logs
nebius ai endpoint logs ${ENDPOINT_ID} --follow

# Check endpoint status
nebius ai endpoint get ${ENDPOINT_ID}
```

### 6.2 Cost Management

```bash
# Stop when not in use (per-second billing)
nebius ai endpoint stop ${ENDPOINT_ID}

# Restart when needed
nebius ai endpoint start ${ENDPOINT_ID}
```

### 6.3 Updates

```bash
# Rebuild and push new image
docker build -t ${REGISTRY}/nemoclaw:v2 .
docker push ${REGISTRY}/nemoclaw:v2

# Update endpoint to new image
nebius ai endpoint update ${ENDPOINT_ID} \
  --image ${REGISTRY}/nemoclaw:v2
```

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| NemoClaw is alpha software | APIs may break | Pin versions, test before upgrading |
| OpenShell gateway bypass | Some security features may not work without NVIDIA's gateway | nginx proxy provides auth injection; sandbox policies still enforce filesystem/process isolation |
| Token Factory rate limits | Agent may be throttled | Monitor usage; consider dedicated inference endpoint for production |
| Nebius serverless cold starts | First request may be slow | Keep endpoint running rather than scale-to-zero for latency-sensitive use |
| `inference.local` TLS trust | Self-signed cert may cause issues | `NODE_EXTRA_CA_CERTS` env var handles Node.js; `update-ca-certificates` for system-level |
| Container needs root for nginx | Security concern | nginx starts as root, NemoClaw sandbox drops privileges internally |

---

## Quick Reference: Required API Keys

| Key | Source | Used For |
|-----|--------|----------|
| **Nebius AI Cloud API key** | Nebius console / CLI | CLI operations, endpoint management |
| **Token Factory API key** | tokenfactory.nebius.com | LLM inference (injected into proxy) |
| **Endpoint auth token** | You define it at deploy time | Authenticating requests to your endpoint |

---

## Next Steps

1. Provide Nebius AI Cloud credentials → configure CLI
2. Provide Token Factory API key → embed in deployment
3. Build and push the container image
4. Deploy the serverless endpoint
5. Verify inference routing through logs
6. Connect to the NemoClaw sandbox and test agent behavior
