# OpenClaw Nebius Monorepo

## Repository Structure

This is an npm workspaces monorepo with five packages:

- `tokenfactory-plugin` — TypeScript OpenClaw provider plugin (builds with `tsc`)
- `nebius-skill` — Markdown-based Claude Code / OpenClaw skill (no build step)
- `deploy-ui` — Express.js web UI for deployment management (Node.js, no build step)
- `deploy-scripts` — Shell scripts, Dockerfile, and configs for Nebius infrastructure automation
- `claw-copilot` — Next.js + CopilotKit AI deployment assistant (chat-first UI)

## Commands

```bash
npm install          # Install all workspace dependencies
npm run build        # Build the tokenfactory-plugin (tsc → dist/)
npm test             # Run tokenfactory-plugin tests (vitest)
npm run check        # Type-check tokenfactory-plugin
npm run dev:deploy   # Start the deploy web UI locally (port 3000)
npm run dev:copilot  # Start the CopilotKit assistant locally (port 3001)
npm run build:copilot # Build claw-copilot for production
```

## Key Details

### tokenfactory-plugin
- Published as `@colygon/openclaw-nebius` on ClawhHub
- ESM module targeting ES2022
- Dev dependencies only: `openclaw`, `typescript`, `vitest`
- Entry: `tokenfactory-plugin/index.ts`
- Plugin manifest: `tokenfactory-plugin/openclaw.plugin.json`
- Tests: `tokenfactory-plugin/index.test.ts` (uses `__mocks__/plugin-sdk.ts`)

### nebius-skill
- Pure markdown documentation — no dependencies, no build
- `SKILL.md` is the main skill definition with dual Claude Code / OpenClaw frontmatter
- `references/` has detailed per-service command references
- `examples/` has end-to-end deployment walkthroughs
- `scripts/check-nebius-cli.sh` is the pre-flight validation script

### deploy-ui
- Express server: `deploy-ui/web/server.js`
- Static frontend: `deploy-ui/web/public/` (vanilla JS, no framework)
- Deployed to Vercel (config in `deploy-ui/vercel.json`)
- Live at https://claw.moi
- Server reads install scripts from `deploy-scripts/` at runtime via relative path

### claw-copilot
- Next.js 15 + React 19 + CopilotKit 1.55
- LLM backend: Nebius Token Factory (OpenAI-compatible) via TOKEN_FACTORY_API_KEY
- API route: `claw-copilot/app/api/copilotkit/route.ts`
- System prompt reads `nebius-skill/SKILL.md` at runtime for Nebius knowledge
- Server-side actions execute `nebius` CLI via child_process (checkPrerequisites, listEndpoints, deployEndpoint, deleteEndpoint, getConnectionInstructions)
- Runs on port 3001 (deploy-ui uses 3000)
- Env vars: TOKEN_FACTORY_API_KEY, TOKEN_FACTORY_URL, NEBIUS_MODEL

### deploy-scripts
- Install scripts: `install-openclaw-serverless.sh`, `install-nemoclaw-serverless.sh`, `install-nemoclaw-vm.sh`
- Cloud provisioning: `deploy-cloud.sh`, `setup-deploy-vm.sh`
- Container assets: `Dockerfile`, `entrypoint.sh`, `healthcheck.sh`, `nginx-proxy.conf`
- Docs: `BUILD_PLAN.md`, `NEBIUS-SETUP-GUIDE.md`

## Nebius Conventions

- Token Factory API endpoint (US): `https://api.tokenfactory.us-central1.nebius.com/v1`
- Token Factory API endpoint (EU): `https://api.tokenfactory.nebius.com/v1`
- Model IDs use `nebius/` prefix in OpenClaw: `nebius/zai-org/GLM-5`
- SSH username on Nebius endpoints/VMs is always `nebius`
- `eu-west1` uses `cpu-d3` (not `cpu-e2`)
- Disk types use underscores: `network_ssd`
