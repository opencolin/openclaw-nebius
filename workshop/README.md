# OpenClaw Workshop — Agentic Slack bot in a single container

A ready-to-run Docker image that runs the [OpenClaw](https://openclaw.dev) AI agent
gateway with three things wired up out of the box:

- **Nebius Token Factory** — 60+ open-source models behind one OpenAI-compatible API
- **Tavily** — web search built for agents
- **Slack** — bot transport in Socket Mode (no public URL required)

Everything is configured through environment variables. Bring keys for the
three services, run one command, and your bot is online.

---

## Quick start

```bash
# 1. Get the keys (see linked docs in .env.example)
cp .env.example .env
$EDITOR .env

# 2. Run it
docker compose up
```

That's it. The bot opens a Socket Mode connection to Slack on startup. Mention
it in any channel it's a member of and it will reply.

> Heads-up: you'll see the OpenClaw dashboard URL printed at startup. Copy that
> line — it contains the per-container gateway token in the URL hash.

### Run without compose

```bash
docker run --rm -it \
  --env-file .env \
  -e OPENCLAW_HOST_PORT=28789 \
  -p 28789:18789 \
  -p 8080:8080 \
  ghcr.io/opencolin/openclaw-workshop:latest
```

Host port 28789 is intentional — picks a fight with no one. (If you don't run a local `openclaw gateway`, `-p 18789:18789` works fine; just drop the `OPENCLAW_HOST_PORT` env so the printed URL still matches.)

---

## What's inside

| Piece                    | Where it lives                          |
| ------------------------ | --------------------------------------- |
| OpenClaw CLI + gateway   | `npm install -g openclaw@latest`        |
| Token Factory provider   | `clawhub:tokenfactory` (installed at first boot, cached after) |
| Tavily plugin            | bundled with OpenClaw — enabled via config |
| Slack channel plugin     | `npm install -g @openclaw/slack@latest` |
| Config template          | [`config/openclaw.json.template`](config/openclaw.json.template) |
| Entrypoint               | [`entrypoint.sh`](entrypoint.sh)        |

The entrypoint substitutes env vars into the config template, writes the result
to `~/.openclaw/openclaw.json`, then launches the gateway.

---

## Required environment

| Var                       | What it's for                              |
| ------------------------- | ------------------------------------------ |
| `NEBIUS_API_KEY`          | Token Factory API key (`v1....`)           |
| `TAVILY_API_KEY`          | Tavily search key (`tvly-...`)             |
| `SLACK_BOT_TOKEN`         | Slack bot OAuth token (`xoxb-...`)         |
| `SLACK_APP_TOKEN`         | Slack app-level token (`xapp-...`)         |

### Optional

| Var                       | Default                                              |
| ------------------------- | ---------------------------------------------------- |
| `OPENCLAW_MODEL`          | `tokenfactory/moonshotai/Kimi-K2.6`                  |
| `TOKEN_FACTORY_URL`       | `https://api.tokenfactory.nebius.com/v1` (US: `…us-central1…`) |
| `OPENCLAW_GATEWAY_TOKEN`  | random 32-hex generated at boot                      |
| `OPENCLAW_GATEWAY_PORT`   | `18789` (container-internal — don't change)          |
| `OPENCLAW_HOST_PORT`      | `28789` (only used for the printed dashboard URL; must match the left side of the docker port mapping) |
| `OPENCLAW_HEALTH_PORT`    | `8080`                                               |

Don't have a Slack app yet? See [`SLACK-APP-SETUP.md`](SLACK-APP-SETUP.md).

---

## Connecting the dashboard / TUI

The gateway is reachable at `http://localhost:28789` from your host. The
dashboard URL is printed at startup with the token already in the hash:

```
Dashboard:  http://localhost:28789/#token=<token>&gatewayUrl=ws://localhost:28789
```

Or attach via the TUI:

```bash
openclaw tui --url ws://localhost:28789 --token <token>
```

> If you also have a host-installed `openclaw gateway` running, it owns port
> 18789 on `127.0.0.1` — that's why this image deliberately maps to 28789 on
> the host instead. The container's *internal* gateway port is still 18789;
> only the host-side mapping is different.

---

## Verifying it works

```bash
# 1. Container is healthy
docker compose ps

# 2. Model + Token Factory work
docker compose exec openclaw openclaw models list --provider tokenfactory

# 3. Tavily reachable
docker compose exec openclaw openclaw plugins inspect tavily

# 4. Slack online — look for "socket-mode connected" in logs
docker compose logs -f openclaw | grep -i slack
```

In Slack, invite the bot to a channel and mention it:

```
@workshop-bot search the web for the latest Anthropic news and summarize
```

You should see it call `tavily_search`, then call Token Factory for the summary,
then post back to the channel.

---

## Switching models on the fly

Edit `OPENCLAW_MODEL=` in `.env` to any `tokenfactory/<model-id>`, then:

```bash
docker compose down && docker compose up -d
```

> `openclaw config set agents.defaults.model.primary …` also works, but only until the next container restart — the entrypoint regenerates `openclaw.json` from `OPENCLAW_MODEL` every time the container boots. Persistent changes go in `.env`.

---

## Troubleshooting

| Symptom                                         | Fix |
| ----------------------------------------------- | --- |
| `SLACK_BOT_TOKEN must start with 'xoxb-'`       | You probably swapped bot and app tokens. `xoxb-` is the bot token; `xapp-` is the app-level token. |
| Container exits, Slack errors `invalid_auth` or `account_inactive` | Bot is uninstalled from the workspace, or the token was rotated. Re-install fresh at `https://api.slack.com/apps/<APP_ID>/install-on-team`, copy the new `xoxb-…`. |
| **You changed `.env` but the container behaves like the old values** | **`docker restart` does NOT reload `--env-file`.** Use `docker compose down && docker compose up -d`. Verify with `docker exec workshop-test bash -c 'echo ${SLACK_BOT_TOKEN: -8}'`. |
| **`missing_scope; needed: chat:write` even though scopes look right** | Slack's "Reinstall to Workspace" silently keeps the old scope set on the existing token. **Fully uninstall** at `https://<workspace>.slack.com/apps/manage` → Remove App → then install **fresh**. Also: remove `assistant:write` from the manifest if present — it blocks `chat:write` from being granted alongside it. |
| `Unknown model: zai-org/GLM-5`                  | Use the fully qualified `tokenfactory/` prefix: `tokenfactory/zai-org/GLM-5`. |
| `401` from Token Factory                        | Check key, and confirm `TOKEN_FACTORY_URL` matches your region (US tenants use `…us-central1…`). |
| Dashboard says "device identity"                | Tokens must be passed in the URL **hash** (`#token=`), not the query string. The startup line gets this right — copy it verbatim. |
| Healthcheck fails for >2 min                    | Plugin install on first boot can be slow on a clean image. `docker compose logs` will show the gateway start line. |

---

## Building locally

```bash
docker build -t openclaw-workshop:dev .
docker run --rm --env-file .env -p 18789:18789 -p 8080:8080 openclaw-workshop:dev
```

CI builds and pushes a multi-arch image to
`ghcr.io/opencolin/openclaw-workshop:latest` on every push to `main`
(see [`.github/workflows/workshop-image.yml`](../.github/workflows/workshop-image.yml)).
