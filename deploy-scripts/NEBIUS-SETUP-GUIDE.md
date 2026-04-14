# NemoClaw / OpenClaw on Nebius Cloud

Three deployment options for running AI coding agents on Nebius Cloud, plus a web UI for one-click deployment.

| Option | Script | GPU | Inference | Best For |
|---|---|---|---|---|
| A. OpenClaw Serverless | `install-openclaw-serverless.sh` | No (cpu-e2) | Token Factory | Lightest, cheapest, quick setup |
| B. NemoClaw Serverless | `install-nemoclaw-serverless.sh` | No (cpu-e2) | Token Factory | NemoClaw sandbox + agent orchestration, no GPU |
| C. NemoClaw GPU VM | `install-nemoclaw-vm.sh` | Yes (H100/H200) | Local vLLM | Full self-hosted inference, max control |
| D. Web Deploy UI | `web/server.js` | Any | Token Factory | Browser-based multi-region deploy + terminal |

---

## Option A: OpenClaw Serverless (cpu-e2, no GPU)

Lightweight deployment of OpenClaw only. No NemoClaw security container, no GPU. Inference is routed to Nebius Token Factory.

### Quick Start

```bash
# 1. Install Nebius CLI
curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash

# 2. Authenticate
nebius iam whoami

# 3. Get a Token Factory API key at https://tokenfactory.nebius.com

# 4. Deploy
export TOKEN_FACTORY_API_KEY="v1.xxx..."
./install-openclaw-serverless.sh
```

### What It Does

1. Creates a container registry in your Nebius project
2. Builds a Docker image with OpenClaw (linux/amd64)
3. Pushes to Nebius Container Registry
4. Deploys on `cpu-e2` (Intel Ice Lake, 2 vCPU, 8 GB RAM)
5. Exposes health check on port 8080 and gateway on port 18789

### Architecture

```
┌─────────────────────────────────────────┐
│  Nebius Endpoint (cpu-e2, no GPU)       │
│  ┌────────────────────────────────────┐ │
│  │  OpenClaw Container               │ │
│  │  ├── Health check (:8080)         │ │
│  │  ├── Gateway (:18789)             │ │
│  │  └── Agent runtime               │ │
│  └────────────────────────────────────┘ │
│           │                             │
│           ▼ (OpenAI-compatible API)     │
│  Token Factory (hosted inference)       │
│  └── deepseek-ai/DeepSeek-R1-0528     │
└─────────────────────────────────────────┘
```

### Connect to the Agent

```bash
# Via TUI (interactive terminal chat)
openclaw tui --url ws://<PUBLIC_IP>:18789

# Health check
curl http://<PUBLIC_IP>:8080
```

### Manage

```bash
nebius ai endpoint list
nebius ai endpoint logs <ENDPOINT_ID>
nebius ai endpoint stop <ENDPOINT_ID>
nebius ai endpoint delete <ENDPOINT_ID>
```

---

## Option B: NemoClaw Serverless (cpu-e2, no GPU)

Deploys the full NemoClaw stack (OpenClaw + NVIDIA NemoClaw security container) on a CPU-only serverless endpoint. Inference is routed to Nebius Token Factory — no GPU quota needed.

This is the right choice when you want NemoClaw's sandbox orchestration and agent capabilities without paying for a dedicated GPU VM.

### Quick Start

```bash
# 1. Install Nebius CLI
curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash

# 2. Authenticate
nebius iam whoami

# 3. Get a Token Factory API key at https://tokenfactory.nebius.com

# 4. Deploy
export TOKEN_FACTORY_API_KEY="v1.xxx..."
./install-nemoclaw-serverless.sh
```

### What It Does

1. Creates a container registry in your Nebius project
2. Builds a Docker image with OpenClaw + NemoClaw security container (linux/amd64)
3. Pushes to Nebius Container Registry
4. Deploys on `cpu-e2` (Intel Ice Lake, 2 vCPU, 8 GB RAM)
5. Exposes health check on port 8080 and gateway on port 18789

### Architecture

```
┌─────────────────────────────────────────┐
│  Nebius Endpoint (cpu-e2, no GPU)       │
│  ┌────────────────────────────────────┐ │
│  │  NemoClaw Container               │ │
│  │  ├── OpenClaw runtime             │ │
│  │  ├── NemoClaw security container (sandbox)    │ │
│  │  ├── Health check (:8080)         │ │
│  │  └── Gateway (:18789)             │ │
│  └────────────────────────────────────┘ │
│           │                             │
│           ▼ (OpenAI-compatible API)     │
│  Token Factory (hosted inference)       │
│  └── deepseek-ai/DeepSeek-R1-0528     │
└─────────────────────────────────────────┘
```

### Connect to the Agent

```bash
# Via TUI (interactive terminal chat)
openclaw tui --url ws://<PUBLIC_IP>:18789

# Health check
curl http://<PUBLIC_IP>:8080
```

### Manage

```bash
nebius ai endpoint list
nebius ai endpoint logs <ENDPOINT_ID>
nebius ai endpoint stop <ENDPOINT_ID>
nebius ai endpoint delete <ENDPOINT_ID>
```

---

## Option C: NemoClaw GPU VM (H100/H200)

Full GPU VM with local inference via vLLM. The model runs directly on the GPU — no external API calls, full privacy, lowest latency.

### Quick Start

```bash
# 1. Install Nebius CLI
curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash

# 2. Authenticate
nebius iam whoami

# 3. Deploy
./install-nemoclaw-vm.sh
```

### What It Does

1. Creates a boot disk with Ubuntu 22.04 + CUDA 12
2. Finds or creates a VPC subnet
3. Launches a GPU VM (H200 by default, 141 GB VRAM)
4. Cloud-init installs OpenClaw + vLLM + model weights
5. Starts vLLM server on port 8000, OpenClaw gateway on port 18789

### Architecture

```
┌───────────────────────────────────────────┐
│  Nebius GPU VM (gpu-h200-sxm)             │
│  ┌──────────────────────────────────────┐ │
│  │  OpenClaw + NemoClaw                 │ │
│  │  ├── Gateway (:18789)               │ │
│  │  ├── Agent runtime                  │ │
│  │  └── Sandbox (code execution)       │ │
│  └──────────┬───────────────────────────┘ │
│             │                             │
│  ┌──────────▼───────────────────────────┐ │
│  │  vLLM (:8000)                        │ │
│  │  └── Nemotron 70B on H200 GPU       │ │
│  └──────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

### Connect to the Agent

```bash
# SSH into the VM (username is "nebius", not root/ubuntu/admin)
ssh -i ~/.ssh/id_ed25519_vm nebius@<PUBLIC_IP>

# Start OpenClaw (after bootstrap finishes)
openclaw gateway &
openclaw tui

# Or connect remotely from your machine
openclaw tui --url ws://<PUBLIC_IP>:18789
```

### GPU Platforms

| Platform | GPU | VRAM | Notes |
|---|---|---|---|
| `gpu-h100-sxm` | H100 | 80 GB | General inference |
| `gpu-h200-sxm` | H200 | 141 GB | Large models (default) |
| `gpu-b200-sxm` | B200 | 180 GB | Next-gen |
| `gpu-b300-sxm` | B300 | 288 GB | Largest |
| `gpu-l40s-pcie` | L40S | 48 GB | Cost-effective |

Presets: `1gpu-16vcpu-200gb` or `8gpu-128vcpu-1600gb`

### Manage

```bash
nebius compute instance list
nebius compute instance stop --id <INSTANCE_ID>    # pause billing
nebius compute instance start --id <INSTANCE_ID>   # resume
nebius compute instance delete --id <INSTANCE_ID>  # permanent
```

---

## Option D: Web Deploy UI

A browser-based deployment dashboard that lets you deploy OpenClaw or NemoClaw to any Nebius region with a single click, plus an in-browser SSH terminal to interact with running agents.

### Quick Start

```bash
cd web
npm install
node server.js
# Open http://localhost:3000
```

### Features

- **One-click deploy** to any region (eu-north1, eu-west1, us-central1)
- **Auto-provisioning** — automatically creates projects, registries, and CLI profiles for new regions
- **Auto-detects cheapest CPU** platform per region (cpu-e2 in eu-north1, cpu-d3 in eu-west1)
- **In-browser terminal** — SSH into any running endpoint and interact with the OpenClaw TUI directly from the browser
- **Dashboard access** — SSH tunnel to the OpenClaw web dashboard (port 18789) with one click
- **Multi-region endpoint polling** — shows all running endpoints across all regions
- **Nebius OAuth login** — authenticates via `nebius profile create` (browser-based)

### Architecture

```
┌─────────────────────────────────────────────┐
│  Your Machine (localhost:3000)               │
│  ┌────────────────────────────────────────┐ │
│  │  Express Server                        │ │
│  │  ├── REST API (deploy, endpoints)     │ │
│  │  ├── WebSocket (SSH terminal)         │ │
│  │  └── SSH Tunnel (dashboard proxy)     │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  Browser UI (xterm.js)                 │ │
│  │  ├── Deploy wizard (agent/region)     │ │
│  │  ├── Terminal (full-screen SSH)       │ │
│  │  └── Dashboard (tunneled)             │ │
│  └────────────────────────────────────────┘ │
│           │                                 │
│           ▼ SSH / nebius CLI                 │
│  ┌────────────────────────────────────────┐ │
│  │  Nebius Endpoints (multi-region)       │ │
│  │  ├── eu-north1 (cpu-e2)              │ │
│  │  ├── eu-west1  (cpu-d3)              │ │
│  │  └── us-central1 (cpu-e2)            │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Cloud Hosting (Nebius VM)

Host the Deploy UI on a Nebius VM so you can access it from anywhere.

#### 1. Create a small VM

```bash
# From your local machine with nebius CLI installed:
nebius compute instance create \
  --name openclaw-deploy-ui \
  --platform-id cpu-e2 \
  --preset 2vcpu-8gb \
  --boot-disk-size 20 \
  --ssh-key "$(cat ~/.ssh/id_ed25519.pub)" \
  --parent-id <your-project-id>
```

#### 2. Run the setup script

```bash
# SSH into the VM (find the IP in the Nebius console or CLI output)
ssh nebius@<VM_IP>

# One-liner setup — installs Node.js, Nebius CLI, nginx (HTTPS), and starts the service
curl -sSL https://raw.githubusercontent.com/colygon/openclaw-nebius/main/deploy-scripts/setup-deploy-vm.sh | bash
```

The script will:
- Install Node.js 20, Nebius CLI, and nginx
- Clone the repo and install dependencies
- Generate SSH keys for endpoint access
- Set up nginx with a self-signed HTTPS certificate
- Create a systemd service that auto-starts on boot
- Open a browser login for Nebius authentication

#### 3. Access the UI

Open `https://<VM_IP>` in your browser (accept the self-signed cert warning).

#### Updating

```bash
cd ~/openclaw-deploy && git pull && sudo systemctl restart openclaw-deploy
```

#### Troubleshooting

```bash
# Check service status
sudo systemctl status openclaw-deploy

# Live logs
sudo journalctl -u openclaw-deploy -f

# Restart
sudo systemctl restart openclaw-deploy

# Re-authenticate with Nebius (if token expired)
nebius profile create
sudo systemctl restart openclaw-deploy
```

**Critical**: Do NOT copy the macOS `~/.nebius/bin/` directory to Linux — it contains a Mach-O ARM64 binary. Only copy config files (`config.yaml`, `credentials.yaml`, `sa-credentials.json`), then reinstall the CLI on the VM with:
```bash
curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash
```

### Vercel Deployment (Demo Mode)

The app can be deployed to Vercel for a live demo. When the `VERCEL` env var is detected, the app runs in demo mode with sample data and no CLI dependency.

```bash
vercel --yes --prod
```

Demo mode: auto-authenticated, sample regions/models/endpoints, deploy button shows "run locally" message.

---

## Nebius Container Registry

Options A and B use the Nebius Container Registry. Here's how to set it up manually:

```bash
# Create registry
nebius registry create --name openclaw --parent-id <PROJECT_ID> --format json

# Login (use IAM token)
nebius iam get-access-token | docker login cr.<REGION>.nebius.cloud --username iam --password-stdin

# Build for AMD64 (required — Nebius runs Intel/AMD CPUs)
docker buildx build --platform linux/amd64 -t cr.<REGION>.nebius.cloud/<REGISTRY_ID>/myimage:latest .

# Push
docker push cr.<REGION>.nebius.cloud/<REGISTRY_ID>/myimage:latest
```

**Regions**: `eu-north1`, `eu-west1`, `us-central1`

**Important**: If building on Apple Silicon (M1/M2/M3), always use `--platform linux/amd64`. ARM64 images will fail with `exec format error` on Nebius.

---

## Nebius Regions & CPU Platforms

Different regions have different CPU platforms. The web UI auto-detects this, but if deploying manually, you need to match the platform to the region.

| Region | CPU Platform | CPU Type | Notes |
|---|---|---|---|
| `eu-north1` | `cpu-e2` | Intel Ice Lake | Default region, most tested |
| `eu-west1` | `cpu-d3` | AMD EPYC Genoa | Does NOT have `cpu-e2` |
| `us-central1` | `cpu-e2` | Intel Ice Lake | Separate project required |

To check available platforms in a region:

```bash
nebius --profile <region-profile> compute platform list --format json
```

**Gotcha**: Deploying to eu-west1 with `--platform cpu-e2` will fail with `no platform found with name = 'cpu-e2'`. Always check what's available first.

---

## Multi-Region Profiles

Each Nebius region requires its own CLI profile with the correct project ID. The web UI creates these automatically, but here's how to set them up manually:

```bash
# List all projects across your tenant
nebius --profile eu-north1 iam project list \
  --parent-id tenant-e00zj418j5m8a78scb --format json

# Create a profile for a new region
# Edit ~/.nebius/config.yaml and add under "profiles:":
#   eu-west1:
#     endpoint: api.nebius.cloud
#     auth-type: federation
#     federation-endpoint: auth.nebius.com
#     parent-id: <project-id-in-that-region>
#     tenant-id: tenant-e00zj418j5m8a78scb
```

**Gotcha**: `nebius profile create` requires interactive input and won't work in scripts. Write directly to `~/.nebius/config.yaml` instead.

**Gotcha**: Listing projects with `nebius iam project list` is scoped to the active profile's parent. To find projects in other regions, list at the tenant level with `--parent-id <tenant-id>`.

---

## OpenClaw Gateway & Dashboard

The OpenClaw gateway runs on port 18789 inside the container and serves both WebSocket connections (for the TUI) and the web-based Control UI dashboard.

### Key Ports

| Port | Service | Exposed to Host? | Protocol |
|---|---|---|---|
| 8080 | Health check (HTTP) | Yes (Docker mapped) | HTTP |
| 18789 | Gateway + Dashboard | Configurable (see below) | WS + HTTP |

### Dashboard Access: Direct Port vs SSH Tunnel

**New endpoints** (deployed with `--container-port 18789`) expose the dashboard directly:
```bash
# Direct access — no tunnel needed
http://<PUBLIC_IP>:18789/#token=<OPENCLAW_WEB_PASSWORD>
```

**Older endpoints** (only port 8080 mapped) require an SSH tunnel through the container:
```bash
# 1. SSH in and set up socat bridge to container's internal IP
ssh -i ~/.ssh/id_ed25519_vm nebius@<PUBLIC_IP>
CONTAINER_IP=$(sudo docker inspect -f \
  '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  $(sudo docker ps -q | head -1))
sudo apt-get install -y socat
sudo socat TCP-LISTEN:28789,fork,reuseaddr TCP:$CONTAINER_IP:18789 &

# 2. From your local machine, create the SSH tunnel
ssh -L 19000:localhost:28789 -i ~/.ssh/id_ed25519_vm nebius@<PUBLIC_IP>

# 3. Open http://localhost:19000 in your browser
```

The web UI's **Dashboard** button automates both approaches.

### Dashboard Token Format (Critical)

The OpenClaw Control UI reads the gateway token from the **URL hash fragment**, NOT the query string:

```
# ✅ Correct — hash fragment
http://host:18789/#token=mytoken

# ❌ Wrong — query string (ignored by Control UI)
http://host:18789/?token=mytoken
```

When connecting to a new gateway URL, **both `token` and `gatewayUrl` must be provided together** in the hash, or the token is stored as "pending" and never applied:

```
# ✅ Correct — both params together
http://host:18789/#token=mytoken&gatewayUrl=ws://host:18789

# ❌ Wrong — token alone goes to pendingGatewayToken
http://host:18789/#token=mytoken
```

### Device Pairing

The Control UI requires **device pairing** even when token auth is configured. This is a per-browser security feature separate from the gateway token. When accessing the dashboard from a new browser/device:

1. The dashboard shows "pairing required"
2. The user clicks **Connect** (with token filled in)
3. The pairing request must be **approved from the gateway host**:

```bash
# Inside the container — approve the most recent pairing request
openclaw devices approve --latest --token <gateway-token>

# List all paired and pending devices
openclaw devices list

# Other device management commands
openclaw devices reject <requestId>
openclaw devices remove <deviceId>
openclaw devices clear
```

The web UI auto-approves pairing via SSH (retries for up to 18 seconds after the Dashboard button is clicked).

### Secure Context (HTTPS)

The Control UI requires **HTTPS or localhost** for device identity (Web Crypto API). Accessing via plain HTTP over a public IP shows "device identity required".

**Solutions**:
- **localhost** — always works (SSH tunnel to localhost)
- **Self-signed cert** — set up nginx with SSL on the hosting VM
- **Tailscale Serve** — recommended by OpenClaw for remote access

nginx config for HTTPS proxy (on the Deploy UI VM):
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    ssl_certificate     /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

**Gotcha**: Do NOT use static `proxy_set_header Connection "upgrade"` — this breaks non-WebSocket HTTP requests. Use the `map` directive for conditional upgrade.

### Extracting Gateway Tokens

The gateway token may be stored in different places depending on how it was set:

| Source | How to Extract |
|---|---|
| Docker env var | `docker exec $CID env \| grep OPENCLAW_GATEWAY_TOKEN` |
| Config file (raw JSON) | `docker exec $CID cat /home/openclaw/.openclaw/openclaw.json` → parse `gateway.auth.token` |
| Process command line | `docker exec $CID ps aux \| grep OPENCLAW_GATEWAY_TOKEN` |
| `openclaw config get` | **Returns `__OPENCLAW_REDACTED__`** — cannot use for extraction |

**Gotcha**: `openclaw config get gateway.auth.token` redacts secret values. Always read the raw `openclaw.json` file instead.

### Origin Errors

If the dashboard shows `origin not allowed`, configure `allowedOrigins`:

```bash
# Inside the container:
openclaw config set gateway.controlUi.allowedOrigins \
  '["http://localhost:18789","http://127.0.0.1:18789","*"]'

# Then restart the gateway
kill $(pgrep -f openclaw-gateway)
OPENCLAW_GATEWAY_TOKEN=<token> openclaw gateway \
  --bind lan --auth token --port 18789 &
```

### Gateway Auth Modes

| Bind Mode | Allowed Auth | Notes |
|---|---|---|
| `loopback` | `none`, `token`, `password` | Only accessible from localhost |
| `lan` | `token`, `password` | **Requires auth** — `none` is rejected |
| `tailnet` | `none`, `token`, `password` | Via Tailscale network |

**Gotcha**: `--auth none` with `--bind lan` is rejected with "Refusing to bind gateway to lan without auth".

**Gotcha**: `SIGHUP` kills the gateway (no graceful reload). Restart manually after config changes.

**Gotcha**: `--force` flag requires `fuser` or `lsof` — not available in minimal containers. If the port is free (previous process dead/zombie), start without `--force`.

---

## SSH Access to Endpoints

Nebius AI Endpoints run in VMs that you can SSH into.

### Connection Details

| Field | Value |
|---|---|
| Username | `nebius` (not `root`, `ubuntu`, `admin`, or `openclaw`) |
| SSH Key | Your registered key (e.g., `~/.ssh/id_ed25519_vm`) |
| Port | 22 (standard) |

```bash
ssh -i ~/.ssh/id_ed25519_vm nebius@<PUBLIC_IP>
```

### Running OpenClaw TUI via SSH

Once connected, exec into the running Docker container:

```bash
# Find the container and run the TUI
sudo docker exec -it $(sudo docker ps -q | head -1) openclaw tui
```

The web UI's **Terminal** button automates this — it opens a full-screen xterm.js terminal in your browser that SSH's in and launches the TUI.

---

## Docker Build Gotchas

### ARM64 vs AMD64

Nebius runs Intel/AMD CPUs. If you build on Apple Silicon (M1/M2/M3/M4), the default Docker build produces ARM64 images that crash with `exec format error` on Nebius.

**Fix**: Always use buildx with platform targeting:

```bash
docker buildx build --platform linux/amd64 -t <image> .
```

Cross-compilation via QEMU is slow (10-30 minutes for a full build). For faster builds, build directly on a Nebius VM.

### BuildKit Corruption

Docker BuildKit can corrupt its metadata database, especially after crashes:

```
write /var/lib/docker/buildkit/metadata_v2.db: input/output error
```

**Fix**: Restart Docker Desktop:

```bash
# macOS
osascript -e 'quit app "Docker Desktop"' && open -a "Docker Desktop"
```

### Git Required for npm

OpenClaw and NemoClaw npm packages install from GitHub, which requires git:

```dockerfile
# Must include git in your Dockerfile
RUN apt-get update && apt-get install -y git
```

Without git, `npm install -g openclaw` will fail silently or with cryptic errors.

---

## Troubleshooting

### Nebius CLI & Auth

| Issue | Fix |
|---|---|
| `PermissionDenied` | Check `nebius iam whoami` — ensure correct profile is active. Grant `admin` role in IAM > Access Permits. |
| Token expired | Re-run `nebius auth login` (opens browser for OAuth). |
| Wrong project scoped | Check `nebius config get parent-id`. Switch profiles with `nebius --profile <name>`. |
| Profile not found | Write profile directly to `~/.nebius/config.yaml`. `nebius profile create` requires interactive input. |
| Install URL changed | Old URL `storage.ai.nebius.cloud` no longer resolves. Use `storage.eu-north1.nebius.cloud/cli/install.sh`. |
| macOS binary on Linux | Copying `~/.nebius/bin/` from Mac to Linux gives `Exec format error` (Mach-O ARM64). Reinstall CLI on the Linux machine. Only copy config files. |
| `nebius iam whoami` user name | User name is at `user_profile.attributes.name`, NOT `identity.display_name`. Parse with: `nebius iam whoami --format json`. |

### Docker & Container Registry

| Issue | Fix |
|---|---|
| `exec format error` | Image built for ARM64. Rebuild with `--platform linux/amd64`. |
| Registry auth expired | IAM tokens expire in ~1hr. Re-run `nebius iam get-access-token \| docker login ...`. |
| BuildKit corruption | Restart Docker Desktop. |
| `npm install` needs git | Add `git` to Dockerfile `apt-get install`. |

### Endpoints & Deployments

| Issue | Fix |
|---|---|
| Endpoint `StartFailed` | Container crashing. Health check must be the foreground process. Test locally: `docker run -p 8080:8080 <image>`. |
| `cpu-e2` not found | Wrong region. `eu-west1` uses `cpu-d3`, not `cpu-e2`. Check available platforms first. |
| `AlreadyExists` error | Registry or project name taken. List existing resources first, or use a different name. |
| Public IP quota exceeded | Nebius tenants are limited to ~3 public IPv4 addresses. Delete unused endpoints first. |
| `network_ssd` vs `network-ssd` | Disk type uses **underscores**: `network_ssd`, `network_hdd`, `network_ssd_io_m3`. |
| `--source-image-family` wrong flag | Correct flag is `--source-image-family-image-family` (yes, double "image-family"). |
| Disk too small | Ubuntu 22.04 CUDA image requires minimum 50 GiB disk (`--size-gibibytes 50`). 30 GiB fails. |
| Multiple `--container-port` | Supported. Use `--container-port 8080 --container-port 18789` to expose both health + dashboard. |

### OpenClaw Gateway & Dashboard

| Issue | Fix |
|---|---|
| `Refusing to bind to lan without auth` | Use `--auth token` with `OPENCLAW_GATEWAY_TOKEN=<token>`. Cannot use `--auth none` with `--bind lan`. |
| Dashboard shows `origin not allowed` | Add your URL to `gateway.controlUi.allowedOrigins` config. Use `"*"` to allow all. Restart gateway after. |
| Gateway died after config change | `SIGHUP` kills the gateway (no graceful reload). Restart manually. |
| `--force` fails: `fuser not found` | Minimal containers lack `fuser`/`lsof`. If the port is free (old process is zombie/dead), start without `--force`. |
| Can't reach dashboard on port 18789 | Port not mapped to host in older deploys. Use `--container-port 18789` on new deploys, or SSH tunnel + socat for older ones. |
| `gateway token missing` (URL) | Token must be in URL **hash** (`#token=xxx`), not query string (`?token=xxx`). |
| `gateway token missing` (hash works but ignored) | Must provide `gatewayUrl` alongside `token` in hash: `#token=xxx&gatewayUrl=wss://host:port`. Without `gatewayUrl`, token becomes "pending". |
| `config get` returns redacted | `openclaw config get gateway.auth.token` returns `__OPENCLAW_REDACTED__`. Read raw JSON: `cat /home/openclaw/.openclaw/openclaw.json`. |
| `device identity required` | Dashboard needs HTTPS or localhost for Web Crypto. Use self-signed cert via nginx, Tailscale Serve, or access via SSH tunnel to localhost. |
| `pairing required` | Device pairing is separate from token auth. Approve via `openclaw devices approve --latest --token <token>` on the gateway host. Per-browser, must be done for each new device. |
| Token not in Docker env | If token was set inline (`TOKEN=x openclaw gateway ...`), it won't appear in `docker exec env`. Check: raw config JSON, process cmdline (`ps aux`), or `/proc/<pid>/environ`. |

### VM Specific

| Issue | Fix |
|---|---|
| VM preempted | Default VMs are preemptible. Use `--preemptible-priority 0` for on-demand. |
| Cloud-init user `root`/`admin` | Reserved names. Use any other username. |
| SSH user unknown | Nebius VMs use username `nebius`. Not `root`, `ubuntu`, or `admin`. |
| Model name not found | Use correct HuggingFace name, e.g., `nvidia/Llama-3.1-Nemotron-70B-Instruct-HF` (note the `-HF` suffix). |

---

## Deploy UI: Cloud Hosting Lessons

When hosting the Deploy UI on a Nebius VM (instead of locally), several additional challenges arise:

### Express Sessions Are In-Memory

Sessions are lost on every server restart. API calls from a stale browser session return 401. Fix: use `authFetch()` wrapper that silently re-authenticates on 401 by calling `/api/auth/status` first.

### SSH Tunnel Binding

When the server runs remotely, SSH tunnels bound to `localhost` are only accessible on the VM. Fix: bind tunnels on `0.0.0.0` (`-L 0.0.0.0:port:...`) and return the VM's public hostname in the URL.

### HTTPS via nginx

The OpenClaw Control UI requires a secure context. Set up nginx with a self-signed certificate:
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/selfsigned.key \
  -out /etc/nginx/ssl/selfsigned.crt \
  -subj "/CN=openclaw-deploy"
```

### nginx WebSocket Proxy

**Must** use conditional Connection upgrade — static `Connection "upgrade"` breaks HTTP:
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
# Then: proxy_set_header Connection $connection_upgrade;
```

Also set `proxy_read_timeout 86400` for long-lived WebSocket connections.

### Express Trust Proxy

Behind nginx, Express sees `req.hostname` as `localhost`. Add `app.set('trust proxy', true)` so Express reads `X-Forwarded-*` headers for the real client hostname.

### Systemd Service

Run the Deploy UI as a systemd service for auto-restart:
```ini
[Service]
Type=simple
User=nebius
WorkingDirectory=/home/nebius/openclaw-deploy/web
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=HOME=/home/nebius
Environment=PATH=/home/nebius/.nebius/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
```

### Updating the VM

```bash
ssh nebius@<VM_IP> 'cd openclaw-deploy && git pull && cd web && npm install && sudo systemctl restart openclaw-deploy'
```

---

## Agent Instructions

If you are an AI agent managing Nebius infrastructure:

```bash
# Always use --format json for parseable output
nebius compute instance list --format json

# Parse with python3
nebius ai endpoint list --format json | \
  python3 -c "import sys,json; [print(i['metadata']['id'], i['status']['state']) for i in json.load(sys.stdin).get('items',[])]"

# Get IAM token for API calls
TOKEN=$(nebius iam get-access-token)

# Call Token Factory / AI Studio directly
curl -s https://api.tokenfactory.nebius.com/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-ai/DeepSeek-R1-0528","messages":[{"role":"user","content":"Hello"}]}'

# List endpoints across all regions
for profile in eu-north1 sa-vibehack; do
  echo "=== $profile ==="
  nebius --profile $profile ai endpoint list --format json 2>/dev/null | \
    python3 -c "import sys,json; [print(f\"  {i['metadata']['name']}: {i['status']['state']}\") for i in json.load(sys.stdin).get('items',[])]" 2>/dev/null
done

# Get container IP inside an endpoint
ssh -i ~/.ssh/id_ed25519_vm nebius@<IP> \
  'sudo docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" $(sudo docker ps -q | head -1)'
```
