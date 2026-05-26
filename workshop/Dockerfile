# Workshop image: agentic Slack bot with OpenClaw + Nebius Token Factory + Tavily
#
# Bundles:
#   - OpenClaw CLI + gateway
#   - Token Factory provider plugin (clawhub:tokenfactory)
#   - Tavily web search plugin (bundled in OpenClaw, just needs API key)
#   - Slack channel plugin (@openclaw/slack) in Socket Mode
#
# At runtime the entrypoint substitutes env vars into ~/.openclaw/openclaw.json
# and launches the gateway. The Slack channel opens a WSS connection to Slack
# so no public ingress is required.

FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    OPENCLAW_GATEWAY_PORT=18789 \
    OPENCLAW_HEALTH_PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gettext-base jq netcat-openbsd python3 tini \
    && rm -rf /var/lib/apt/lists/*

# OpenClaw CLI + gateway.
# --ignore-scripts is intentional: a couple of OpenClaw plugin transitive deps
# (notably baileys) run native post-installs that fail inside Docker BuildKit
# and aren't needed for the Slack/Token Factory/Tavily code path.
RUN npm install -g --ignore-scripts openclaw@latest \
    && npm cache clean --force

# Channel plugins (Slack) and provider plugins (Token Factory) install into
# the user's ~/.openclaw/npm dir, so we defer those to the entrypoint where
# we run as `node`. Tavily ships bundled in the openclaw npm package itself
# and only needs to be enabled.

COPY config/openclaw.json.template /etc/openclaw/openclaw.json.template
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

RUN mkdir -p /home/node/.openclaw && chown -R node:node /home/node/.openclaw

USER node
WORKDIR /home/node

EXPOSE 8080 18789

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
