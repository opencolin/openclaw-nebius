# Deploy Guides

Five paths to deploy [OpenClaw](https://github.com/nichochar/openclaw) AI agents, from local to production cloud.

| Guide | Infra | Inference | Time | Best For |
|-------|-------|-----------|------|----------|
| [Local Install](local-install.md) | Your machine | Token Factory | ~30s | Try it now, zero overhead |
| [Docker](docker.md) | Any machine with Docker | Token Factory | ~2 min | Portable, reproducible |
| [GPU Serverless](gpu-serverless.md) | Nebius GPU endpoint | Local model | ~5 min | Custom models, data privacy |
| [CPU Serverless](cpu-serverless.md) | Nebius CPU endpoint | Token Factory | ~3 min | Production, always-on |
| [Nebius CLI](nebius-cli.md) | Nebius endpoint (CPU or GPU) | Either | ~5 min | Full control, step-by-step |

All cloud paths use [Nebius AI Cloud](https://nebius.com). Token Factory paths use [Nebius Token Factory](https://tokenfactory.nebius.com) for inference.
