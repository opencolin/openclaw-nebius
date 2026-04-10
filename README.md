# OpenClaw + Nebius

Everything you need to run [OpenClaw](https://github.com/nichochar/openclaw) AI agents on [Nebius Cloud](https://nebius.com) with inference powered by [Nebius Token Factory](https://tokenfactory.nebius.com).

## What's in this repo

| Package | What it does |
|---|---|
| **[`nebius-plugin`](nebius-plugin)** | OpenClaw provider plugin -- adds 44+ open-source models (Qwen, DeepSeek, Llama, GLM, FLUX, etc.) via Nebius Token Factory |
| **[`nebius-skill`](nebius-skill)** | Claude Code / OpenClaw skill for deploying and managing Nebius infrastructure from your terminal |
| **[`deploy`](deploy)** | Web UI + install scripts for deploying OpenClaw to Nebius (live at [claw.moi](https://claw.moi)) |

## Getting Started

Pick the path that matches what you want to do:

### "I want to use Nebius models in my existing OpenClaw setup"

Install the provider plugin to get 44+ models:

```bash
openclaw plugins install clawhub:@colygon/openclaw-nebius
```

Then follow the [plugin setup guide](nebius-plugin/SETUP.md) to configure your API key.

### "I want to deploy OpenClaw on Nebius using the web UI"

Open the Deploy UI at **[claw.moi](https://claw.moi)** and follow the wizard. It handles regions, platforms, images, and credentials.

For self-hosting the deploy UI, see [deploy](deploy).

### "I want to deploy OpenClaw on Nebius using Claude Code or another coding agent"

Install the Nebius skill for Claude Code:

```bash
git clone https://github.com/colygon/openclaw-nebius.git /tmp/openclaw-nebius
cp -r /tmp/openclaw-nebius/nebius-skill ~/.claude/skills/nebius
```

Then ask Claude to deploy:

```
/nebius deploy OpenClaw as a serverless endpoint
```

The skill handles the full workflow: region selection, endpoint creation, networking, SSH tunnels, dashboard access, and device pairing.

### "I want to deploy OpenClaw on Nebius using a script"

```bash
export TOKEN_FACTORY_API_KEY={your-key-from-studio.nebius.ai}
cd deploy
./install-openclaw-serverless.sh
```

See [deployment paths](deploy/README.md) for all four options (local, Docker, GPU serverless, CPU serverless).

## Quick Reference

### Token Factory API Keys

Get your key at [studio.nebius.ai](https://studio.nebius.ai/). Keys look like `v1.` followed by a long string.

### Popular Models

| Model | Type | Context | Input $/1M | Output $/1M |
|---|---|---|---|---|
| `nebius/deepseek-ai/DeepSeek-V3.2` | Chat | 163K | $0.30 | $0.45 |
| `nebius/Qwen/Qwen3.5-397B-A17B` | Chat | 131K | $0.60 | $3.60 |
| `nebius/zai-org/GLM-5` | Chat | 131K | $1.00 | $3.20 |
| `nebius/openai/gpt-oss-120b` | Reasoning | 131K | $0.15 | $0.60 |
| `nebius/deepseek-ai/DeepSeek-R1-0528` | Reasoning | 163K | $0.80 | $2.40 |
| `nebius/Qwen/Qwen3-Coder-480B-A35B-Instruct` | Chat | 131K | $0.40 | $1.80 |

38 chat/reasoning models and 2 image generation models total. See [full catalog](nebius-plugin/SETUP.md#available-models).

### Regions

| Region | Location | CPU Platform |
|---|---|---|
| `eu-north1` | Finland | `cpu-e2` |
| `eu-west1` | Paris | `cpu-d3` |
| `us-central1` | US | `cpu-e2` |

### Pre-built Docker Images

```bash
docker pull ghcr.io/colygon/openclaw-serverless:latest   # ~400 MB, CPU
docker pull ghcr.io/colygon/nemoclaw-serverless:latest   # ~1.1 GB, GPU-ready
```

## Development

This is an npm workspaces monorepo. The plugin and deploy UI are the two buildable packages.

```bash
# Install all dependencies
npm install

# Build the provider plugin
npm run build

# Run plugin tests
npm test

# Type-check the plugin
npm run check

# Start the deploy UI locally
npm run dev:deploy
```

The nebius-skill package is pure markdown and requires no build step.

## How the pieces fit together

```
                          +-------------------+
                          |   Nebius Cloud    |
                          |  Token Factory    |
                          |  (44+ models)     |
                          +--------+----------+
                                   |
                    OpenAI-compatible API
                                   |
          +------------------------+------------------------+
          |                        |                        |
+---------v----------+  +---------v----------+  +---------v----------+
|  nebius-plugin     |  |  deploy (web UI)   |  |  nebius-skill      |
|                    |  |                    |  |                    |
|  Registers models  |  |  Browser wizard    |  |  Claude Code /     |
|  in OpenClaw as    |  |  + install scripts |  |  OpenClaw skill    |
|  a provider        |  |  for deploying     |  |  for deploying     |
|                    |  |  agents to Nebius  |  |  via CLI            |
+--------------------+  +--------------------+  +--------------------+
```

- **nebius-plugin** connects OpenClaw to Token Factory for inference (use models)
- **deploy** provides the UI and scripts to get OpenClaw running on Nebius (deploy agents)
- **nebius-skill** teaches AI coding assistants how to manage Nebius infrastructure (automate deployments)

## Related

- [OpenClaw](https://github.com/nichochar/openclaw) -- The open-source AI agent platform
- [Nebius Cloud](https://nebius.com) -- Cloud platform with GPU infrastructure
- [Token Factory](https://tokenfactory.nebius.com) -- Nebius managed GPU inference API
- [Nebius CLI docs](https://docs.nebius.com/cli/) -- Official CLI documentation

## License

MIT
