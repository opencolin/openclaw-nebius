#!/bin/bash
# Health check for Nebius Serverless endpoint
curl -sf http://localhost:8080/ > /dev/null 2>&1 || exit 1
