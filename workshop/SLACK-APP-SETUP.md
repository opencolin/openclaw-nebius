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
      - emoji:read
      - files:read
      - files:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - im:write
      - mpim:history
      - mpim:read
      - mpim:write
      - pins:read
      - pins:write
      - reactions:read
      - reactions:write
      - usergroups:read
      - users:read

settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - assistant_thread_started
      - assistant_thread_context_changed
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
  org_deploy_enabled: false
  token_rotation_enabled: false
```

Click **Create**.

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
| `not_authed` / `invalid_auth` in logs    | Re-install the app to the workspace after changing scopes. |
| Bot doesn't respond in DMs               | The manifest above already includes `im:*` scopes — but you must open a DM with the bot once to bootstrap the conversation. |
| Bot responds in some channels, not others| Add it explicitly: `/invite @bot-name` in each. Slack does not auto-add to channels. |
| `socket_mode_disabled` error             | You skipped step 2 (App-Level Token). Socket Mode requires the `xapp-…` token with `connections:write`. |
| `missing_scope` for a specific action    | Add the scope under **OAuth & Permissions**, then **Reinstall to Workspace**. |

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
