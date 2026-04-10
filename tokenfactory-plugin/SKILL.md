---
name: openclaw-nebius
description: Nebius Token Factory provider plugin — adds 44+ open-source models (Qwen, DeepSeek, Llama, Gemma, GLM, FLUX, and more) to OpenClaw via a single OpenAI-compatible endpoint
version: 1.2.2
homepage: https://github.com/colygon/openclaw-nebius/tree/main/tokenfactory-plugin
metadata: {"openclaw":{"requires":{"env":["NEBIUS_API_KEY"]},"primaryEnv":"NEBIUS_API_KEY"}}
env:
  - name: NEBIUS_API_KEY
    required: true
    description: Nebius Token Factory API key from studio.nebius.ai
---

# Nebius Token Factory Provider Plugin

Adds 44+ open-source models to OpenClaw via the Nebius Token Factory inference API.

## Installation

Run this single command to install the plugin from ClawhHub:

```bash
openclaw plugins install clawhub:@colygon/openclaw-nebius
```

Then configure the API key and restart the gateway. Full steps below.

## Step-by-Step Setup

### Step 1: Install the plugin

```bash
openclaw plugins install clawhub:@colygon/openclaw-nebius
```

If reinstalling, remove the old version first:

```bash
rm -rf ~/.openclaw/extensions/nebius
openclaw plugins install clawhub:@colygon/openclaw-nebius
```

### Step 2: Get an API key

Sign up or log in at https://studio.nebius.ai/ and create an API key.

### Step 3: Set the API key

The gateway runs as a macOS LaunchAgent. Shell env vars from .zshrc are NOT visible to it. Use launchctl:

```bash
launchctl setenv NEBIUS_API_KEY "v1.YOUR_KEY_HERE"
```

Also create the auth profile for the agent. Add this file at `~/.openclaw/agents/main/agent/auth-profiles.json`:

```json
{
  "profiles": {
    "nebius:default": {
      "type": "api_key",
      "provider": "nebius",
      "key": "v1.YOUR_KEY_HERE"
    }
  },
  "lastGood": {
    "nebius": "nebius:default"
  }
}
```

If `auth-profiles.json` already exists, merge the `nebius:default` entry into the existing `profiles` object and add `"nebius": "nebius:default"` to the existing `lastGood` object.

### Step 4: Add nebius to the plugins allowlist

```bash
openclaw config set plugins.allow '["nebius"]'
```

If other plugins are already in the allowlist, include them too (e.g. `'["nebius", "openclaw-mem0"]'`).

### Step 5: Restart the gateway

```bash
openclaw gateway restart
```

### Step 6: Verify

```bash
openclaw plugins inspect nebius
openclaw models list --provider nebius
```

You should see `Status: loaded` and at least one model listed.

### Step 7 (optional): Set a Nebius model as default

```bash
openclaw config set agents.defaults.model.primary "nebius/deepseek-ai/DeepSeek-V3.2"
openclaw gateway restart
```

## Deploying OpenClaw on Nebius

To deploy OpenClaw as a serverless endpoint on Nebius AI Cloud, use the [nebius skill](../nebius-skill). It covers the full deployment workflow — creating endpoints, configuring regions, setting up networking, and connecting via TUI or dashboard.

## Required Credentials

| Variable | Required | Description |
|----------|----------|-------------|
| `NEBIUS_API_KEY` | Yes | API key from [studio.nebius.ai](https://studio.nebius.ai/) |

No other credentials are needed. The plugin only communicates with `https://api.tokenfactory.us-central1.nebius.com/v1`.

## Available Models

All models use the `nebius/` prefix. Examples:

- `nebius/deepseek-ai/DeepSeek-V3.2` — DeepSeek V3.2 (163K context, chat)
- `nebius/Qwen/Qwen3-235B-A22B-Thinking-2507` — Qwen3 235B (reasoning)
- `nebius/Qwen/Qwen3-Coder-480B-A35B-Instruct` — Qwen3 Coder 480B
- `nebius/moonshot-ai/Kimi-K2.5` — Kimi K2.5 (262K context)
- `nebius/meta-llama/Llama-3.3-70B-Instruct` — Llama 3.3 70B
- `nebius/google/Gemma-3-27b-it` — Gemma 3 27B
- `nebius/NousResearch/Hermes-4-405B` — Hermes 4 405B (reasoning)
- `nebius/openai/gpt-oss-120b` — GPT-OSS 120B (reasoning)

38 chat/reasoning models and 2 image generation models (FLUX.1) are included.

See the full catalog in [SETUP.md](SETUP.md).

## Troubleshooting

**"plugin not found: nebius"**
- Run `openclaw plugins install clawhub:@colygon/openclaw-nebius`
- If reinstalling: `rm -rf ~/.openclaw/extensions/nebius` first

**401 Unauthorized**
- API key expired or wrong. Generate a fresh one at studio.nebius.ai
- Make sure you ran `launchctl setenv NEBIUS_API_KEY "..."` (not just `export`)
- Restart the gateway after changing the key

**"Unknown model: nebius/..."**
- Run `openclaw gateway restart` after installing
- Check `openclaw plugins inspect nebius` shows `Status: loaded`

**Models show as "missing"**
- The plugin catalog auth may not resolve. Add models to config directly:
  See SETUP.md section on config-based model registration.
