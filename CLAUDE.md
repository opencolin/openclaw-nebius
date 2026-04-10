# OpenClaw Nebius Monorepo

## Repository Structure

This is an npm workspaces monorepo with three packages:

- `nebius-plugin` — TypeScript OpenClaw provider plugin (builds with `tsc`)
- `nebius-skill` — Markdown-based Claude Code / OpenClaw skill (no build step)
- `deploy` — Express.js web UI + shell deployment scripts (Node.js, no build step)

## Commands

```bash
npm install          # Install all workspace dependencies
npm run build        # Build the nebius-plugin (tsc → dist/)
npm test             # Run nebius-plugin tests (vitest)
npm run check        # Type-check nebius-plugin
npm run dev:deploy   # Start the deploy web UI locally (port 3000)
```

## Key Details

### nebius-plugin
- Published as `@colygon/openclaw-nebius` on ClawhHub
- ESM module targeting ES2022
- Dev dependencies only: `openclaw`, `typescript`, `vitest`
- Entry: `nebius-plugin/index.ts`
- Plugin manifest: `nebius-plugin/openclaw.plugin.json`
- Tests: `nebius-plugin/index.test.ts` (uses `__mocks__/plugin-sdk.ts`)

### nebius-skill
- Pure markdown documentation — no dependencies, no build
- `SKILL.md` is the main skill definition with dual Claude Code / OpenClaw frontmatter
- `references/` has detailed per-service command references
- `examples/` has end-to-end deployment walkthroughs
- `scripts/check-nebius-cli.sh` is the pre-flight validation script

### deploy
- Express server: `deploy/web/server.js`
- Static frontend: `deploy/web/public/` (vanilla JS, no framework)
- Install scripts at package root: `install-openclaw-serverless.sh`, `install-nemoclaw-serverless.sh`, etc.
- Deployed to Vercel (config in `deploy/vercel.json`)
- Live at https://claw.moi

## Nebius Conventions

- Token Factory API endpoint (US): `https://api.tokenfactory.us-central1.nebius.com/v1`
- Token Factory API endpoint (EU): `https://api.tokenfactory.nebius.com/v1`
- Model IDs use `nebius/` prefix in OpenClaw: `nebius/zai-org/GLM-5`
- SSH username on Nebius endpoints/VMs is always `nebius`
- `eu-west1` uses `cpu-d3` (not `cpu-e2`)
- Disk types use underscores: `network_ssd`
