# OpenClaw + Nebius

Everything you need to run [OpenClaw](https://github.com/nichochar/openclaw) AI agents on [Nebius Cloud](https://nebius.com) with inference powered by [Nebius Token Factory](https://tokenfactory.nebius.com).

## Install from ClawHub

| | Install |
|---|---|
| **[Token Factory Provider Plugin](https://clawhub.ai/plugins/tokenfactory)** | `openclaw plugins install clawhub:tokenfactory` |
| **[Nebius Cloud Skill](https://clawhub.ai/plugins/nebius)** | `openclaw skills install clawhub:nebius` |

## What's in this repo

| Package | What it does |
|---|---|
| **[`tokenfactory-plugin`](tokenfactory-plugin)** | [Token Factory Provider Plugin](https://clawhub.ai/plugins/tokenfactory) -- adds 44+ open-source models (Qwen, DeepSeek, Llama, GLM, FLUX, etc.) via Nebius Token Factory |
| **[`nebius-skill`](nebius-skill)** | [Nebius Cloud Skill](https://clawhub.ai/plugins/nebius) -- deploy and manage Nebius infrastructure from your terminal |
| **[`deploy-ui`](deploy-ui)** | Web UI for deploying OpenClaw to Nebius |
| **[`deploy-scripts`](deploy-scripts)** | Shell scripts, Dockerfile, and configs for Nebius infrastructure automation |

## Getting Started

Pick the path that matches what you want to do:

### "I want to use Nebius models in my existing OpenClaw setup"

Install the provider plugin to get 44+ models:

```bash
openclaw plugins install clawhub:tokenfactory
```

Then follow the [plugin setup guide](tokenfactory-plugin/SETUP.md) to configure your API key.

### "I want to deploy OpenClaw on Nebius using the web UI"

Run the Deploy UI locally:

```bash
git clone https://github.com/colygon/openclaw-nebius.git
cd openclaw-nebius
npm install
npm run dev:deploy
```

Then open **http://localhost:3000** and follow the wizard. It handles regions, platforms, images, and credentials.

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
cd deploy-scripts
./install-openclaw-serverless.sh
```

See [deployment paths](deploy-ui/README.md) for all four options (local, Docker, GPU serverless, CPU serverless).

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

38 chat/reasoning models and 2 image generation models total. See [full catalog](tokenfactory-plugin/SETUP.md#available-models).

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
|  tokenfactory-plugin  |  |  deploy-ui         |  |  nebius-skill      |
|                    |  |                    |  |                    |
|  Registers models  |  |  Browser wizard    |  |  Claude Code /     |
|  in OpenClaw as    |  |  + install scripts |  |  OpenClaw skill    |
|  a provider        |  |  for deploying     |  |  for deploying     |
|                    |  |  agents to Nebius  |  |  via CLI            |
+--------------------+  +--------------------+  +--------------------+
```

- **tokenfactory-plugin** connects OpenClaw to Token Factory for inference (use models)
- **deploy-ui** + **deploy-scripts** provide the UI and scripts to get OpenClaw running on Nebius (deploy agents)
- **nebius-skill** teaches AI coding assistants how to manage Nebius infrastructure (automate deployments)

## Related

- [OpenClaw Docs](https://docs.openclaw.ai) -- Official OpenClaw documentation
- [Docker Install](https://docs.openclaw.ai/install/docker) -- Install OpenClaw with Docker
- [Token Factory](https://tokenfactory.nebius.com) -- Nebius managed GPU inference API
- [Discord](https://discord.gg/pYJqCyWt) -- Join the OpenClaw community
- [Nebius Cloud](https://nebius.com) -- Cloud platform with GPU infrastructure
- [Nebius CLI docs](https://docs.nebius.com/cli/) -- Official CLI documentation

## License

MIT
