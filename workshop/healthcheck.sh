#!/usr/bin/env sh
# Hits the in-container health responder. Returns 0 if the gateway boot script
# has reached step 5; non-zero otherwise.
set -e
curl -fsS "http://127.0.0.1:${OPENCLAW_HEALTH_PORT:-8080}/" > /dev/null
