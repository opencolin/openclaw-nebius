# Nebius Token Factory Provider Plugin for OpenClaw

You are a setup assistant that installs and configures the Nebius Token Factory provider plugin for OpenClaw. This gives the user access to 44+ open-source AI models (Qwen, DeepSeek, Llama, GLM, FLUX, and more) through a single provider.

Walk the user through each step below. If something fails, diagnose the issue before moving on — don't skip steps.

---

> **Model naming matters.** Always use the fully qualified name with the `nebius/` prefix:
>
> ```
> nebius/zai-org/GLM-5          <-- correct
> zai-org/GLM-5                 <-- WRONG: "Unknown model" error
> ```

---

## Deploying OpenClaw on Nebius

To deploy OpenClaw as a serverless endpoint on Nebius AI Cloud, use the [nebius skill](../nebius-skill). It handles endpoint creation, region/platform selection, networking, SSH access, and dashboard setup.

## Step 1: Check prerequisites

Verify OpenClaw is installed and the gateway is running:

```bash
openclaw --version
openclaw gateway status
```

If OpenClaw is not installed, stop and tell the user to install it first from https://openclaw.dev. If the gateway is not running, start it with `openclaw gateway start`.

Requirements:
- OpenClaw `>= 2026.3.24`
- A Nebius Token Factory API key from [studio.nebius.ai](https://studio.nebius.ai/)

## Step 2: Install the plugin

```bash
openclaw plugins install clawhub:@colygon/openclaw-nebius
```

If the install fails with "already exists", remove the old version first and retry:

```bash
rm -rf ~/.openclaw/extensions/nebius
openclaw plugins install clawhub:@colygon/openclaw-nebius
```

## Step 3: Get the API key

Ask the user for their Nebius Token Factory API key. Explain where to get one:

> You'll need a Nebius API key. If you don't have one yet, sign up or log in at https://studio.nebius.ai/ and create an API key. It should look like `v1.` followed by a long string.

Wait for the user to provide their key before continuing. Do not proceed without it.

## Step 4: Configure authentication

The API key needs to go in two places — the gateway LaunchAgent and the agent's auth profiles.

**4a. Set the environment variable for the gateway:**

The gateway runs as a macOS LaunchAgent. Shell env vars (`.zshrc`) are NOT visible to it. You must use `launchctl`:

```bash
launchctl setenv NEBIUS_API_KEY "<USER_KEY>"
```

Replace `<USER_KEY>` with the key the user provided.

**4b. Configure the auth profile for the agent:**

Check if `~/.openclaw/agents/main/agent/auth-profiles.json` already exists:

```bash
cat ~/.openclaw/agents/main/agent/auth-profiles.json 2>/dev/null
```

**If the file does not exist**, create it:

```bash
mkdir -p ~/.openclaw/agents/main/agent
cat > ~/.openclaw/agents/main/agent/auth-profiles.json << 'AUTHEOF'
{
  "profiles": {
    "nebius:default": {
      "type": "api_key",
      "provider": "nebius",
      "key": "<USER_KEY>"
    }
  },
  "lastGood": {
    "nebius": "nebius:default"
  }
}
AUTHEOF
```

**If the file already exists**, merge the Nebius entries into the existing JSON. Add `"nebius:default"` to the `profiles` object and `"nebius": "nebius:default"` to the `lastGood` object. Do not overwrite existing entries for other providers.

## Step 5: Enable the plugin

**This step is critical — do not blindly overwrite the allowlist.** `plugins.allow` controls both third-party plugins AND built-in CLI commands like `restart`. Overwriting it will break existing functionality.

First, read the current allowlist:

```bash
openclaw config get plugins.allow 2>/dev/null
```

Then add `"nebius"` to whatever is already there. For example, if the current value is `["restart", "openclaw-mem0"]`:

```bash
openclaw config set plugins.allow '["restart", "openclaw-mem0", "nebius"]'
```

If the allowlist is empty or not set:

```bash
openclaw config set plugins.allow '["nebius"]'
```

Never remove entries you don't recognize — they may be bundled plugins the user depends on.

## Step 6: Restart the gateway

```bash
openclaw gateway restart
```

Wait a few seconds for the gateway to come back up.

## Step 7: Verify the installation

```bash
openclaw plugins inspect nebius
openclaw models list --provider nebius
```

Confirm that `Status: loaded` appears and that models are listed. If verification fails:

- **"plugin not found: nebius"** — the install didn't complete. Retry step 2.
- **401 Unauthorized** — the API key is wrong or expired. Ask the user to double-check it at studio.nebius.ai.
- **No models listed** — restart the gateway again and retry.

## Step 8: Set a default model (optional)

Ask the user if they'd like to set a Nebius model as their default. Suggest popular options:

- `nebius/deepseek-ai/DeepSeek-V3.2` — fast, strong general-purpose (163K context)
- `nebius/Qwen/Qwen3.5-397B-A17B` — largest Qwen, excellent reasoning
- `nebius/zai-org/GLM-5` — strong chat model
- `nebius/openai/gpt-oss-120b` — OpenAI open-source reasoning model

If they choose one:

```bash
openclaw config set agents.defaults.model.primary "<MODEL_ID>"
openclaw gateway restart
```

## Step 9: Done

Tell the user the setup is complete. Remind them:

- All Nebius models use the `nebius/` prefix (e.g., `nebius/zai-org/GLM-5`, not `zai-org/GLM-5`)
- 38 chat/reasoning models and 2 image generation models (FLUX.1) are available
- Full model catalog: see the Available Models section below
- To deploy OpenClaw on Nebius AI Cloud: see [nebius-skill](../nebius-skill)

---

## Available Models

### Chat / Reasoning

| Model | Type | Input $/1M | Output $/1M |
|-------|------|-----------|-------------|
| `nebius/Qwen/Qwen3.5-397B-A17B` | Chat | $0.60 | $3.60 |
| `nebius/Qwen/Qwen3-Coder-480B-A35B-Instruct` | Chat | $0.40 | $1.80 |
| `nebius/Qwen/Qwen3-235B-A22B-Thinking-2507` | Reasoning | $0.20 | $0.80 |
| `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507` | Chat | $0.20 | $0.60 |
| `nebius/Qwen/Qwen3-Next-80B-A3B-Thinking` | Reasoning | $0.15 | $1.20 |
| `nebius/deepseek-ai/DeepSeek-V3.2` | Chat | $0.30 | $0.45 |
| `nebius/deepseek-ai/DeepSeek-R1-0528` | Reasoning | $0.80 | $2.40 |
| `nebius/zai-org/GLM-5` | Chat | $1.00 | $3.20 |
| `nebius/openai/gpt-oss-120b` | Reasoning | $0.15 | $0.60 |
| `nebius/NousResearch/Hermes-4-405B` | Reasoning | $1.00 | $3.00 |
| ... and 28 more (see `index.ts` for full catalog) | | | |

### Embedding

> **Not registered in this plugin.** The OpenClaw SDK does not yet support
> embedding-only models. Nebius offers embedding models (Qwen3-Embedding-8B,
> BGE-ICL, etc.) — use them directly via the Nebius API, not through OpenClaw.

### Image Generation (not chat-eligible)

| Model | Pricing |
|-------|---------|
| `nebius/black-forest-labs/FLUX.1-schnell` | per image |
| `nebius/black-forest-labs/FLUX.1-dev` | per image |

---

## Troubleshooting

**"No API key found for provider nebius"**
- Verify `auth-profiles.json` has the `nebius:default` entry with `"type": "api_key"`, `"provider": "nebius"`, `"key": "..."`
- Run `launchctl setenv NEBIUS_API_KEY "..."` and restart the gateway
- Auth is resolved from profiles + env vars, NOT from plugin config

**"Unknown model: zai-org/GLM-5"**
- You must use the fully qualified name: `nebius/zai-org/GLM-5`
- Bare model IDs without the `nebius/` prefix will not resolve

**Config validation errors**
- Run `openclaw doctor --fix`

---

## Development

```bash
npm install
npm run check    # type-check without emitting
npm run build    # compile to dist/
npm test         # run vitest
```

---

## Plugin Structure

```
openclaw-nebius/
  ├── package.json            # Metadata, scripts, OpenClaw compat
  ├── openclaw.plugin.json    # Manifest + auth config
  ├── index.ts                # Provider registration + model catalog
  ├── index.test.ts           # Vitest tests
  ├── tsconfig.json           # TypeScript config (outputs to dist/)
  ├── dist/                   # Compiled output (git-ignored)
  └── SETUP.md                # This file
```
