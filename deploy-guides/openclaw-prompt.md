# OpenClaw Prompt: Install NemoClaw Locally with Nebius Token Factory

Paste the following into your OpenClaw session:

---

Install NVIDIA NemoClaw on this machine and configure it to use Nebius Token Factory for all LLM inference instead of NVIDIA's default inference backend.

## What to do

### 1. Check prerequisites

Verify I have these installed (install any that are missing):
- Node.js 20+ (22 preferred)
- npm 10+
- Docker (running)
- Python 3.11+
- git, curl

### 2. Install NemoClaw

Run the official installer:
```
curl -fsSL https://nvidia.com/nemoclaw.sh | bash
```

If that fails, install manually via npm:
```
npm install -g @nvidia/nemoclaw@latest
npm install -g openclaw@2026.3.11
```

Verify both binaries are available: `nemoclaw --version` and `openclaw --version`.

### 3. Configure inference to use Nebius Token Factory

This is the critical part. NemoClaw normally routes inference through NVIDIA's OpenShell gateway at `https://inference.local/v1`. We need to redirect this to Nebius Token Factory instead.

**Token Factory details:**
- Base URL: `https://api.tokenfactory.nebius.com/v1/`
- Auth: Bearer token (I will provide the API key)
- Model: `deepseek-ai/DeepSeek-R1-0528`
- It is fully OpenAI-compatible (chat completions endpoint)

**How to reconfigure:**

Option A — Environment variables (try this first):
```
export OPENCLAW_API_BASE_URL="https://api.tokenfactory.nebius.com/v1"
export OPENCLAW_API_KEY="<my-token-factory-key>"
export OPENCLAW_MODEL="deepseek-ai/DeepSeek-R1-0528"
```

Option B — If NemoClaw ignores env vars and hardcodes `inference.local`, set up a local reverse proxy:

1. Add `127.0.0.1 inference.local` to `/etc/hosts`
2. Generate a self-signed cert for `inference.local`
3. Run a small nginx or caddy proxy that:
   - Listens on `https://inference.local:443`
   - Forwards all `/v1/*` requests to `https://api.tokenfactory.nebius.com/v1/`
   - Injects the `Authorization: Bearer <TOKEN_FACTORY_KEY>` header
   - Sets `Host: api.tokenfactory.nebius.com`
4. Trust the self-signed cert system-wide and set `NODE_EXTRA_CA_CERTS` for Node.js

Try Option A first. If the agent's inference calls still go to NVIDIA, fall back to Option B.

### 4. Run NemoClaw onboarding

```
nemoclaw onboard
```

When it asks for an NVIDIA API key, skip it or enter a placeholder — we are not using NVIDIA inference. If it can't be skipped, enter any string and we'll override the endpoint via the config above.

### 5. Verify it works

After setup, launch a sandbox and confirm:
- The sandbox starts successfully
- Inference calls are hitting `api.tokenfactory.nebius.com` (check logs or network traffic)
- The agent can generate responses using the Token Factory model

### 6. Show me the final config

When done, print out:
- Which installation method worked
- Which inference routing method worked (env vars or proxy)
- Any config files that were modified and their locations
- How to start/stop NemoClaw going forward

## Important notes

- This is macOS (Darwin). Adjust any Linux-specific commands accordingly.
- NemoClaw is alpha software — if something doesn't work as documented, read the source and adapt.
- Do NOT use NVIDIA's cloud inference. All model calls must go through Token Factory.
- Ask me for the Token Factory API key when you're ready to configure inference.
