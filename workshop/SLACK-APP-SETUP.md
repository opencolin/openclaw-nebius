# Create a Slack app for the workshop bot

You'll end up with two tokens to drop into `.env`:

| Variable           | What it is                                      |
| ------------------ | ----------------------------------------------- |
| `SLACK_BOT_TOKEN`  | Bot OAuth token, starts with `xoxb-`            |
| `SLACK_APP_TOKEN`  | App-level token for Socket Mode, starts with `xapp-` |

The whole flow takes ~3 minutes if you copy/paste the manifest below.

---

## 1. Create the app from a manifest

Go to **<https://api.slack.com/apps>** → **Create New App** → **From a manifest**
→ pick your workspace → paste the YAML below:

```yaml
display_information:
  name: OpenClaw Workshop Bot
  description: Agentic assistant powered by Nebius Token Factory and Tavily
  background_color: "#0F172A"

features:
  bot_user:
    display_name: OpenClaw Workshop Bot
    always_online: true

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - im:write
      - mpim:history
      - mpim:read
      - mpim:write
      - users:read

settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  socket_mode_enabled: true
```

Click **Create**.

> **Why this manifest is deliberately minimal — the gotcha that ate hours of debugging:**
>
> - **No `assistant:write` scope.** It puts the app in Slack's "AI Assistant" surface mode and silently blocks `chat:write` from being granted alongside it. Symptom: the bot receives events fine but can never reply, and logs show `missing_scope; needed: chat:write` even though your manifest lists `chat:write` and the OAuth & Permissions page shows it.
> - **No `commands`, `interactivity`, `app_home`, file/pin/reaction scopes.** Not needed for an @-mention chat bot. Less surface area = fewer silent compatibility traps.
>
> If you need any of those later, add them carefully to a fresh app and re-verify that `chat:write` survives.

---

## 2. Generate the App-Level Token

This is the `xapp-...` value — required for Socket Mode.

1. In your new app → **Basic Information** → scroll to **App-Level Tokens**
2. Click **Generate Token and Scopes**
3. Name: `workshop-socket`
4. Add scope: **`connections:write`** (and `authorizations:read` is fine too)
5. Click **Generate**, copy the token → this is your `SLACK_APP_TOKEN`

---

## 3. Install the app to your workspace

1. **Install App** in the left sidebar → **Install to Workspace** → **Allow**
2. Once installed, you'll see the **Bot User OAuth Token** (`xoxb-...`)
   → this is your `SLACK_BOT_TOKEN`

---

## 4. Drop both tokens into `.env`

```dotenv
SLACK_BOT_TOKEN=xoxb-…
SLACK_APP_TOKEN=xapp-…
```

---

## 5. Invite the bot to a channel

In any Slack channel:

```
/invite @OpenClaw Workshop Bot
```

Then mention it:

```
@OpenClaw Workshop Bot what is the current price of NVIDIA stock?
```

You should see it pick up the mention within ~1 second, run a `tavily_search`,
and reply in-thread.

---

## Common gotchas

| Problem                                  | Fix |
| ---------------------------------------- | --- |
| `not_authed` / `invalid_auth` / `account_inactive` | App is uninstalled in the workspace, or you pasted a stale token. Re-install at `https://api.slack.com/apps/<APP_ID>/install-on-team` and copy the fresh `xoxb-…`. |
| Bot doesn't respond in DMs               | The manifest above already includes `im:*` scopes — but you must open a DM with the bot once to bootstrap the conversation. |
| Bot responds in some channels, not others| Add it explicitly: `/invite @bot-name` in each. Slack does not auto-add to channels. |
| `socket_mode_disabled` error             | You skipped step 2 (App-Level Token). Socket Mode requires the `xapp-…` token with `connections:write`. |
| **`missing_scope; needed: chat:write` even though the OAuth page shows it** | **Slack's "Reinstall to Workspace" silently keeps the old scope set on the existing token if it thinks nothing changed.** You must FULLY uninstall (workspace's `/apps/manage` page → **Remove App**) and then install fresh — only that path issues a new token bound to the current scopes. |
| `chat:write` won't grant no matter what you do | Your manifest probably has `assistant:write` — remove it (see the warning above the manifest). The two scopes are mutually exclusive under Slack's AI Assistant mode. |
| You changed `.env` (rotated token), but the container behaves like the old token | `docker restart` does NOT reload `--env-file`. Use `docker compose down && docker compose up -d` (or `docker stop && docker rm && docker compose up -d` if you started via `docker run`). |
| Some scopes silently drop on install in an enterprise workspace | Workspace has an "admin approval" or "scope allowlist" policy. Easiest workaround: create a free sandbox workspace at `https://slack.com/create` and install there. |

---

## Tightening down for production

The manifest above uses an open access model — anyone in the workspace can DM
the bot. For a real deployment, change in `~/.openclaw/openclaw.json` (or your
container env):

```json5
{
  channels: {
    slack: {
      dmPolicy: "allowlist",
      allowFromUsers: ["U0123456789"],   // your Slack user IDs
      groupPolicy: "allowlist",
      allowFromChannels: ["C0123456789"] // channel IDs from "Copy link"
    }
  }
}
```

Channel IDs: right-click a channel name → **Copy link** → the ID is the
trailing path segment (`C…`).
