# Workshop — Build an agentic Slack bot with OpenClaw, Token Factory, and Tavily

A 30-minute hands-on workshop. By the end, you'll have a Slack bot that:

- Receives messages in your workspace
- Searches the live web via **Tavily**
- Runs inference on open-source models via **Nebius Token Factory**
- Reasons + replies — all from a single Docker container on your laptop

> **Time budget (~30 min)**
> 1. Prereqs (5 min) — install Docker, clone repo
> 2. Token Factory key (3 min)
> 3. Tavily key (2 min)
> 4. Slack app (10 min)
> 5. Launch + verify (5 min)
> 6. Mention the bot (5 min)

> **Prefer to have your AI coding agent drive this?** Paste [`AGENT-PROMPT.md`](AGENT-PROMPT.md) into Claude Code, Cursor, Codex, or Aider and it'll run the whole workshop interactively — pausing for keys, verifying each step, and recovering from common errors.

---

## 0. Before we start

Open these in tabs — you'll need them in roughly this order:

| Tab | URL | What you'll do |
| --- | --- | --- |
| 1 | <https://tokenfactory.nebius.com> | Get the Nebius key |
| 2 | <https://app.tavily.com> | Get the Tavily key |
| 3 | <https://api.slack.com/apps> | Create the Slack app |
| 4 | Your Slack workspace | Invite the bot |

You'll need:

- A Slack workspace where you can install an app (your own, a sandbox, or a community one with admin permission)
- A terminal — macOS Terminal, iTerm, GNOME Terminal, anything

> **No Node, no Python, no other tooling required.** Everything runs inside Docker.

### Install Docker (if you don't have it)

```bash
# macOS
brew install --cask docker

# Linux (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER  # log out + back in after this
```

Verify:

```bash
docker --version          # → Docker version 24.x or newer
docker compose version    # → Docker Compose version v2.x or newer
```

On macOS, launch **Docker Desktop** once after install — the menu-bar whale must be steady (not animating) before continuing.

> **Checkpoint:** `docker run --rm hello-world` prints "Hello from Docker!" → ready.

---

## 1. Get the workshop bundle (3 min)

```bash
git clone https://github.com/opencolin/openclaw-nebius.git
cd openclaw-nebius/workshop
cp .env.example .env
```

You should now have:

```text
workshop/
├── docker-compose.yml   ← we'll docker compose up this
├── .env                 ← you're about to fill this in
├── .env.example         ← template, ignore from here on
└── WORKSHOP.md          ← this file
```

Pre-pull the image so the rest of the workshop is instant:

```bash
docker pull ghcr.io/opencolin/openclaw-workshop:latest
```

> **Checkpoint:** the pull finishes with `Status: Downloaded newer image for …`. If pull fails (image not yet public), use `docker compose build` instead — adds ~2 min.

Open `.env` in any editor. You'll fill in five values across the next three blocks.

---

## 2. Get your Token Factory API key (3 min)

Nebius **Token Factory** is an OpenAI-compatible API that hosts 60+ open-source models on Nebius GPUs. Your agent runs locally; only the model inference hits the API.

1. Tab 1 → **<https://tokenfactory.nebius.com>** → sign in (or sign up — it takes 30 sec)
2. Sidebar → **API keys** → **Create API key** → give it a name → copy it (starts with `v1.`)
3. In your `.env`:

   ```dotenv
   NEBIUS_API_KEY=v1.…
   ```

US tenants only: change `TOKEN_FACTORY_URL` to `https://api.tokenfactory.us-central1.nebius.com/v1`.

### Verify the key (optional but nice)

```bash
curl -s https://api.tokenfactory.nebius.com/v1/models \
  -H "Authorization: Bearer $(grep ^NEBIUS_API_KEY .env | cut -d= -f2)" \
  | head -c 200
```

> **Checkpoint:** you see JSON with model IDs like `zai-org/GLM-5`, `moonshotai/Kimi-K2.6`.

---

## 3. Get your Tavily API key (2 min)

**Tavily** is search-for-agents: LLM-ready results, no HTML parsing, prompt-injection filtering built in.

1. Tab 2 → **<https://app.tavily.com>** → sign in / sign up
2. Sidebar → **API Keys** → **Create new key** → copy it (starts with `tvly-`)
3. In your `.env`:

   ```dotenv
   TAVILY_API_KEY=tvly-…
   ```

> **Checkpoint:** key is pasted; we'll verify end-to-end once the bot is talking.

---

## 4. Create your Slack app (10 min)

This is the longest block — Slack requires a real OAuth app, but with the manifest below it's mostly copy/paste.

### 4a. Create the app from a manifest

Tab 3 → **<https://api.slack.com/apps>** → **Create New App** → **From a manifest** → pick your workspace.

Paste this YAML and click **Next** → **Create**:

```yaml
display_information:
  name: OpenClaw Workshop Bot
  description: Agentic assistant powered by Nebius Token Factory + Tavily
  background_color: "#0F172A"

features:
  bot_user:
    display_name: OpenClaw Workshop Bot
    always_online: true
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - assistant:write
      - channels:history
      - channels:read
      - chat:write
      - commands
      - groups:history
      - groups:read
      - im:history
      - im:read
      - im:write
      - mpim:history
      - mpim:read
      - mpim:write
      - reactions:read
      - reactions:write
      - users:read

settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - assistant_thread_started
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
```

> **Checkpoint:** you land on the new app's settings page. The left sidebar shows "Basic Information", "App Home", "OAuth & Permissions", etc.

### 4b. Generate the App-Level Token (Socket Mode)

This is the `xapp-…` token. Socket Mode means the bot opens a WebSocket *out* to Slack — no public URL needed.

1. **Basic Information** → scroll to **App-Level Tokens** → **Generate Token and Scopes**
2. Name: `workshop-socket`
3. Add scope: **`connections:write`**
4. **Generate** → copy the `xapp-…` token

In `.env`:

```dotenv
SLACK_APP_TOKEN=xapp-…
```

### 4c. Install to your workspace

1. **Install App** in the left sidebar → **Install to Workspace** → **Allow**
2. After install, the **Bot User OAuth Token** appears (starts with `xoxb-…`). Copy it.

In `.env`:

```dotenv
SLACK_BOT_TOKEN=xoxb-…
```

> **Checkpoint:** `.env` has four real values:
> `NEBIUS_API_KEY=v1.…`
> `TAVILY_API_KEY=tvly-…`
> `SLACK_BOT_TOKEN=xoxb-…`
> `SLACK_APP_TOKEN=xapp-…`

---

## 5. Launch the bot (3 min)

From `openclaw-nebius/workshop`:

```bash
docker compose up
```

Watch the logs. Three good signals will scroll by, in this order:

```text
✓  Wrote /home/node/.openclaw/openclaw.json
✓  Plugins ready
[gateway] http server listening (9 plugins: … slack … tavily; …)
[slack] [default] starting provider
[slack] socket mode connected
[gateway] ready
```

If you see all of those, the bot is online.

> **Checkpoint:** the last log line in your terminal mentions `socket mode connected` and `[gateway] ready`. If it isn't there, scroll up and look for a red error — usually `invalid_auth` (wrong token) or `401` (bad Nebius/Tavily key).

You'll also see this line — copy it, you'll use the URL to view the OpenClaw dashboard:

```text
>>   Dashboard:  http://localhost:18789/#token=<random>&gatewayUrl=ws://localhost:18789
```

---

## 6. Talk to your bot (5 min)

### 6a. Invite it to a channel

In your Slack workspace, in any channel (or create a fresh `#openclaw-test`):

```text
/invite @OpenClaw Workshop Bot
```

### 6b. Mention it with a web-search question

```text
@OpenClaw Workshop Bot search the web for what's new from Anthropic this week and summarize in 3 bullets
```

The bot will:

1. Pick up the mention (Socket Mode pushes the event from Slack to your container)
2. Decide it needs `tavily_search` to answer
3. Call Tavily
4. Send the results + your question to Nebius Token Factory
5. Reply in the thread

Watch the same terminal — you'll see `[tavily]`, `[tokenfactory]`, and `[slack]` log lines as it works.

> **Checkpoint:** a real reply appears in your Slack thread within 10–30 seconds. If it doesn't, `docker compose logs -f openclaw | tail -50` is your friend.

### 6c. Try a few more prompts

Mix tool-use with reasoning to see what each model is good at:

```text
@OpenClaw Workshop Bot search for current NVIDIA stock price and compare to last week
@OpenClaw Workshop Bot what's the best open-source LLM for code generation right now?
@OpenClaw Workshop Bot summarize https://docs.tavily.com in 5 bullets
```

---

## 7. Customize (bonus — if time)

### Switch models live

```bash
docker compose exec openclaw openclaw config set \
  agents.defaults.model.primary "tokenfactory/deepseek-ai/DeepSeek-V3.2"
docker compose restart openclaw
```

The container ships with these 10 models pre-listed (matching the slide deck's recommended set):

| Model | When to reach for it |
| --- | --- |
| `tokenfactory/moonshotai/Kimi-K2.6` | Default. Long context (262K), good at reasoning |
| `tokenfactory/deepseek-ai/DeepSeek-V4-Pro` | 1M context, structured output |
| `tokenfactory/nvidia/Nemotron-3-Nano-Omni` | Cheapest — $0.06/$0.24 per 1M tokens |
| `tokenfactory/zai-org/GLM-5.1` | Strong general-purpose chat |
| `tokenfactory/MiniMaxAI/MiniMax-M2.5` | Cheap + fast |
| `tokenfactory/Qwen/Qwen3.5-397B-A17B-fast` | Throughput-optimized Qwen |
| `tokenfactory/NousResearch/Hermes-4-405B` | Best for agentic tool-use |
| `tokenfactory/openai/gpt-oss-120b` | OpenAI's open weight release |

### Open the OpenClaw dashboard

Paste the `Dashboard:` URL from your `docker compose up` logs into a browser. You'll see live conversations, tool calls, and can change config from the UI.

### Stop everything

```bash
docker compose down
```

Your `.env` stays — restart with `docker compose up` any time.

---

## What you built today

✅ A Slack bot connected via Socket Mode (no public URL)
✅ Inference routed through Nebius Token Factory (no GPU on your laptop)
✅ Web search through Tavily (fresh, agent-safe)
✅ One container, four env vars, everything else config-as-code

Same shape works for **Microsoft Teams, Discord, Telegram, WhatsApp** — swap the `channels.slack` block in [`config/openclaw.json.template`](config/openclaw.json.template).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `docker pull` says `unauthorized` or `not found` | The published image isn't ready yet — `docker compose build` builds locally instead. Adds ~2 min. |
| `SLACK_BOT_TOKEN must start with 'xoxb-'` | Bot/app tokens swapped. `xoxb-` = bot token, `xapp-` = app-level token. |
| `Gateway failed to start: Invalid config` | Edit `.env` and re-run `docker compose up` — usually a stray quote or extra space in a key. |
| `[slack] invalid_auth` | App is uninstalled or token rotated. Reinstall it in **Install App** → **Reinstall to Workspace**. |
| Bot silent in Slack after mention | (a) bot isn't in the channel — `/invite @OpenClaw Workshop Bot`; (b) check `docker compose logs -f openclaw \| grep -i slack` |
| `401 Unauthorized` from Token Factory | Verify the key and that `TOKEN_FACTORY_URL` matches your region (US tenants use `…us-central1…`). |
| Dashboard URL shows "device identity" error | Token must be in URL **hash** (`#token=…`), not query. The startup log line gets this right — copy it verbatim. |

---

## Going further

- **Long-term memory:** `openclaw plugins install @mem0/openclaw-mem0` — the bot remembers across conversations
- **Deploy to the cloud:** see [`nebius-skill/examples/deploy-openclaw.md`](../nebius-skill/examples/deploy-openclaw.md) — same image, hosted on Nebius
- **Tighten Slack access:** see [`SLACK-APP-SETUP.md`](SLACK-APP-SETUP.md) → "Tightening down for production" — restrict to specific channels/users
- **Add more channels:** Microsoft Teams, Discord, WhatsApp — `openclaw channels list --all` shows the catalog

Come hang out on the OpenClaw Discord. See you at the next webinar — *Building More Secure Autonomous AI Agents with NemoClaw on Nebius*.
