# NemoClaw on Nebius Serverless
# Runs OpenClaw agent with inference routed to Nebius Token Factory
FROM node:22-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-yaml \
    curl git ca-certificates iproute2 \
    nginx openssl gettext-base procps \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw CLI (pinned version)
RUN npm install -g openclaw@2026.3.11

# Install NemoClaw from GitHub
RUN npm install -g git+https://github.com/NVIDIA/NemoClaw.git

# Copy Token Factory nginx proxy config
RUN mkdir -p /etc/nginx/templates /etc/nginx/ssl
COPY nginx-proxy.conf /etc/nginx/templates/nginx-proxy.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Copy custom network policy with Token Factory access
COPY openclaw-sandbox-policy.yaml /opt/nemoclaw/policies/openclaw-sandbox.yaml

# Copy entrypoint and health check
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

# Create sandbox user and dirs
RUN useradd -m -s /bin/bash sandbox \
    && mkdir -p /sandbox /tmp \
    && chown sandbox:sandbox /sandbox /tmp

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD /usr/local/bin/healthcheck.sh

WORKDIR /sandbox
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
