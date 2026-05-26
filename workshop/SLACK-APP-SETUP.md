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

---

# Full Slack settings reference

This is the long-form companion to the quickstart above — every panel, every setting, what it does, and the failure mode if you get it wrong. Skip if the bot already works; come here when it doesn't.

## 1. The three Slack token types

You'll see all three mentioned in Slack's docs. Only two matter for the workshop bot.

| Token | Format | Where it appears | What it does | Used by |
| --- | --- | --- | --- | --- |
| **Bot User OAuth Token** | `xoxb-…` | **OAuth & Permissions** page, top, after install | Authenticates calls *as the bot* (post messages, read channels) | `SLACK_BOT_TOKEN` |
| **App-Level Token** | `xapp-…` | **Basic Information** → **App-Level Tokens**, after you generate one | Authenticates the Socket Mode WSS connection | `SLACK_APP_TOKEN` |
| **User OAuth Token** | `xoxp-…` | OAuth & Permissions, if you grant user scopes | Authenticates calls *as the installing user* | not needed |

**When tokens rotate vs stay the same:**

- A clean re-install (after a full Remove App) issues a NEW `xoxb-…` token bound to the current scope set.
- A "Reinstall to Workspace" click on an already-installed app **usually keeps the same `xoxb-…` value and keeps the same scope set**, even if you've added scopes since — Slack short-circuits when it thinks nothing changed.
- The `xapp-…` token doesn't rotate during reinstalls. It's bound to the App-Level Token entry, not the install.

## 2. App Manifest — the source of truth

`https://api.slack.com/apps/<APP_ID>/app-manifest` shows the YAML/JSON manifest that drives most of the app's settings: display name, OAuth scopes, event subscriptions, Socket Mode toggle. Editing other panels (OAuth & Permissions, Event Subscriptions, etc.) mutates the same underlying manifest.

**Editing the manifest is the safest way to make multiple correlated changes** (e.g. adding new scopes + new events at once), because it's atomic — either everything saves or nothing does.

**Gotcha:** "Save Changes" on the manifest editor commits the change *to the app config*, but **does not** re-bind the existing token to the new scopes. You still have to fully uninstall + install to actually pick up the new scopes. See section 9.

## 3. OAuth & Permissions — scopes

### Scopes the workshop bot needs (and what each does)

| Scope | Why |
| --- | --- |
| `app_mentions:read` | Receive `app_mention` events when someone @-mentions the bot |
| `channels:history` | Read message history in public channels the bot is in |
| `channels:read` | List public channels, get channel info |
| `chat:write` | **Post messages back into a channel.** Without this, the bot is mute. |
| `groups:history` | Read history in private channels the bot is in |
| `groups:read` | List private channels |
| `im:history` | Read DM history |
| `im:read` | List DMs |
| `im:write` | Open / send DMs |
| `mpim:history` | Read group-DM history |
| `mpim:read` | List group DMs |
| `mpim:write` | Open / send group DMs |
| `users:read` | Look up user info by ID (display names, etc.) |

That's 13 scopes — anything else is optional or trap.

### Scopes to deliberately AVOID

| Scope | Why to leave it out |
| --- | --- |
| `assistant:write` | **Puts the app in Slack's "AI Assistant" surface mode and silently blocks `chat:write` from being granted alongside it.** This was the single biggest blocker during workshop prep. Symptom: bot receives events fine but never replies, logs show `missing_scope; needed: chat:write` even though `chat:write` is listed in your manifest. |
| `commands` | Required if you implement slash commands. The workshop bot only listens for `app_mention` and DMs, so skip it. Including it adds an unused surface area. |
| `files:read`, `files:write` | Only needed if the bot sends or reads file attachments. Skip unless you specifically need them. |
| `pins:*`, `reactions:*`, `emoji:read` | Cosmetic / metadata scopes. Not needed for a chat bot. |
| `usergroups:read` | Only needed if mentioning user-groups (`@team`). |
| User Token Scopes (anything under "User Token Scopes" instead of "Bot Token Scopes") | The bot acts as itself, not as the installer. User scopes don't apply. |

### Verifying what's actually granted

```bash
docker exec workshop-test bash -c \
  'curl -sI -X POST https://slack.com/api/auth.test -H "Authorization: Bearer $SLACK_BOT_TOKEN"' \
  | grep -i x-oauth-scopes
```

The `x-oauth-scopes` header lists what's *actually bound to the token right now*. If `chat:write` is missing from this header even though it's in the manifest, you have the install-vs-reinstall gotcha (section 9).

## 4. Socket Mode — the WSS path

Socket Mode lets your container open an outbound WebSocket to Slack instead of Slack pushing events to a public HTTPS endpoint you'd have to host. No public URL, no tunneling, no certificates.

| Setting | Where | Value |
| --- | --- | --- |
| Toggle "Enable Socket Mode" | **Socket Mode** panel | **ON** |
| Manifest field | `settings.socket_mode_enabled` | `true` |
| App-Level Token | **Basic Information** → App-Level Tokens | Generate one with scope `connections:write` |

**Checking if Socket Mode is on without opening Slack:**

```bash
docker exec workshop-test bash -c \
  'curl -s -X POST https://slack.com/api/apps.connections.open -H "Authorization: Bearer $SLACK_APP_TOKEN"' \
  | python3 -c "import json,sys; r=json.load(sys.stdin); m=r.get('response_metadata',{}).get('messages',[]); print('ok:', r['ok']); print('warnings:', m if m else '(none)')"
```

If you see `warnings: ['[WARN] Socket Mode is not turned on.']`, the toggle is off even though the manifest says `true`. Flip it on in the UI and it sticks.

**Socket Mode vs HTTP — pick one:**

- Socket Mode (this workshop): outbound WSS to Slack, no public ingress, single replica per app token, dev-friendly.
- HTTP Request URLs: Slack POSTs events to a public HTTPS URL you host, supports horizontal scaling, requires DNS+TLS and a tunnel during dev (ngrok/Cloudflare).

You cannot have both active at the same time. Socket Mode is the right choice for any workshop, demo, or single-laptop dev setup.

## 5. Event Subscriptions — what wakes the bot

| Bot Event | Fires when | Required for |
| --- | --- | --- |
| `app_mention` | Someone `@`-mentions the bot in any channel | The main "reply to @-mention" flow |
| `message.channels` | Any message in a public channel the bot is a member of | Watching channel context without explicit mention |
| `message.groups` | Any message in a private channel the bot is a member of | Same, for private channels |
| `message.im` | Any message in a DM with the bot | DM-style interaction |
| `message.mpim` | Any message in a group DM with the bot | Same, for group DMs |

**Critical:** `message.channels` and `message.groups` only fire for channels the bot is a member of. If you don't `/invite @bot-name`, no events are pushed.

**Events to AVOID** unless you specifically need them:

| Event | Reason to skip |
| --- | --- |
| `assistant_thread_started`, `assistant_thread_context_changed` | These are part of the AI Assistant surface that's tied to `assistant:write` — including them encourages adding that scope (see section 3) and blocks `chat:write`. |
| `reaction_added`, `reaction_removed` | Only matters if you trigger logic on emoji reactions. Adds noise otherwise. |
| `member_joined_channel`, `member_left_channel` | Only matters for member-tracking flows. |
| `team_join`, `user_change` | Workspace-wide events. High volume, rarely needed. |

## 6. App Identity — display name vs username vs IDs

Slack has multiple ways to address the same bot:

| Field | Where it comes from | Example | Used by |
| --- | --- | --- | --- |
| **Display Name** | `features.bot_user.display_name` in manifest | `OpenClaw Workshop Bot` | What humans see in autocomplete |
| **Username** | Auto-generated from display name | `openclaw_workshop_bot` | The `@username` mention slug |
| **User ID** | Slack assigns on install | `U0AGDV2QA92` | API calls, channel membership |
| **Bot ID** | Slack assigns on install | `B0AGP8QDZ09` | API calls referring to the bot user |
| **App ID** | Slack assigns on app creation | `A0AR6EYV4DC` | The settings URL: `https://api.slack.com/apps/<APP_ID>` |

`@OpenClaw Workshop Bot` (display name with spaces) and `@openclaw_workshop_bot` (slugified username) both resolve to the same bot in Slack's mention picker.

**When the bot user is recreated:** if you change `display_information.name` or `features.bot_user.display_name` in the manifest, Slack creates a fresh bot user on next install — the User ID and Bot ID will be NEW values. Existing channel invitations stay (the bot is still a member, but under the new identity), but cached references to old IDs break.

## 7. Always Online — keep the green dot lit

```yaml
features:
  bot_user:
    always_online: true
```

Without this, the bot shows as offline whenever the gateway isn't actively processing a message — confusing for users mid-conversation. Always set it to `true` for production bots.

## 8. App Home — leave it off for the workshop

The "App Home" tab (where the bot can display a UI panel inside Slack) is **off** in the workshop manifest. We don't use it; including it adds complexity and an extra event surface (`app_home_opened`).

If you DO want it later, set:

```yaml
features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
```

…and handle the `app_home_opened` event in your bot.

## 9. Install → Reinstall → Remove — what actually rebinds scopes

This is the most counterintuitive part of Slack's flow. **Three different actions, three different effects on scopes.**

| Action | What it does | Effect on the bot token |
| --- | --- | --- |
| **Install to Workspace** (first time) | Generates a fresh token bound to all currently-configured scopes | New `xoxb-…`, exact current scope set |
| **Reinstall to Workspace** | "Refreshes" the install — but if Slack thinks the scope diff is empty, it short-circuits and **keeps the existing token bound to the old scope set** | Often the same `xoxb-…`, same old scope set ⚠️ |
| **Remove App** (from workspace admin → Manage Apps) followed by **Install** | Fully uninstalls and starts over | Brand new `xoxb-…`, exact current scope set ✓ |

**The reliable scope-update flow:**

1. Edit scopes in the manifest editor (or OAuth & Permissions), save.
2. Go to your workspace's **App Management** (`https://<workspace>.slack.com/apps/manage`) → find the bot → **Remove App**.
3. Go to `https://api.slack.com/apps/<APP_ID>/install-on-team` → **Install to Workspace** → **Allow**.
4. Copy the freshly-issued `xoxb-…` token from the install-success screen.
5. Drop it into `.env` and **recreate the container** (`docker compose down && docker compose up -d` — `docker restart` does not reload `--env-file`).

## 10. Workspace policies that silently strip scopes

In enterprise Slack workspaces, an admin may have set:

- **App approval required** — bots install but with reduced scope sets until an admin approves.
- **Scope allowlist** — certain scopes are banned for non-approved apps.
- **DM restrictions** — bots can't DM users by default.

**Symptom:** the bot installs cleanly, the OAuth & Permissions page shows all the scopes you requested as chips, but `x-oauth-scopes` on the actual token shows only a subset.

**Fix:** for workshops, create a free sandbox workspace at <https://slack.com/create> and install the app there. In a workspace you own, no policy strips your scopes.

## 11. Settings panel cross-reference

Every "where do I click?" in one table:

| Setting | Panel | Manifest field |
| --- | --- | --- |
| App display name | Basic Information | `display_information.name` |
| App description | Basic Information | `display_information.description` |
| Bot display name | App Home → Your App's Presence | `features.bot_user.display_name` |
| Always-online indicator | App Home | `features.bot_user.always_online` |
| Bot scopes | OAuth & Permissions → Scopes → Bot Token Scopes | `oauth_config.scopes.bot` |
| App-Level Token | Basic Information → App-Level Tokens | (no manifest field — must generate in UI) |
| Socket Mode toggle | Socket Mode | `settings.socket_mode_enabled` |
| Subscribed bot events | Event Subscriptions → Subscribe to bot events | `settings.event_subscriptions.bot_events` |
| Slash commands | Slash Commands | `features.slash_commands` |
| Bot User OAuth Token | OAuth & Permissions → top of page (after install) | (assigned on install — not in manifest) |
| Install / Reinstall | Install App | (action, not config) |
| Distribution outside this workspace | Manage Distribution | `settings.org_deploy_enabled` |
| Token rotation | OAuth & Permissions → Token rotation settings | `settings.token_rotation_enabled` |

## 12. Quick verification snippets

```bash
# Bot identity (workspace, user, bot, team)
docker exec workshop-test bash -c \
  'curl -s -X POST https://slack.com/api/auth.test -H "Authorization: Bearer $SLACK_BOT_TOKEN"' \
  | python3 -m json.tool

# Actual scopes granted to the bot token
docker exec workshop-test bash -c \
  'curl -sI -X POST https://slack.com/api/auth.test -H "Authorization: Bearer $SLACK_BOT_TOKEN"' \
  | grep -i x-oauth-scopes

# Socket Mode status (look for warnings)
docker exec workshop-test bash -c \
  'curl -s -X POST https://slack.com/api/apps.connections.open -H "Authorization: Bearer $SLACK_APP_TOKEN"' \
  | python3 -m json.tool

# Channels the bot is in
docker exec workshop-test bash -c \
  'curl -s "https://slack.com/api/users.conversations?types=public_channel,private_channel,im,mpim&limit=20" -H "Authorization: Bearer $SLACK_BOT_TOKEN"' \
  | python3 -m json.tool

# Can the bot send messages? (chat:write end-to-end test)
docker exec workshop-test bash -c \
  'curl -s -X POST https://slack.com/api/chat.postMessage \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"channel\":\"<CHANNEL_ID>\",\"text\":\"test\"}"' \
  | python3 -m json.tool
```

Replace `<CHANNEL_ID>` with a channel ID (right-click channel → Copy link → trailing path segment).
