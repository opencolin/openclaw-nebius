#!/bin/bash
set -e

# ── Detect inference mode: GPU-local or Nebius API ──
INFERENCE_MODE="${INFERENCE_MODE:-nebius-api}"
MODEL="${INFERENCE_MODEL:-deepseek-ai/DeepSeek-R1-0528}"

echo "=== NemoClaw on Nebius GPU VM ==="
echo "Inference mode: ${INFERENCE_MODE}"
echo "Model: ${MODEL}"

# ── 1. Set up inference endpoint ──
if [ "${INFERENCE_MODE}" = "nebius-api" ]; then
  # ── Mode A: Nebius AI Studio API (remote inference) ──
  INFERENCE_URL="${INFERENCE_BASE_URL:-https://api.studio.nebius.ai/v1}"
  API_KEY="${NEBIUS_IAM_TOKEN}"

  if [ -z "$API_KEY" ]; then
    echo "ERROR: NEBIUS_IAM_TOKEN is required for nebius-api mode"
    exit 1
  fi

  echo "Using Nebius AI Studio: ${INFERENCE_URL}"

elif [ "${INFERENCE_MODE}" = "local-vllm" ]; then
  # ── Mode B: Local vLLM on the GPU (self-hosted inference) ──
  echo "Starting vLLM server on GPU..."

  # Check GPU availability
  if ! nvidia-smi &>/dev/null; then
    echo "ERROR: No GPU detected. Cannot run local inference."
    exit 1
  fi
  nvidia-smi

  # Start vLLM in background
  python3 -m vllm.entrypoints.openai.api_server \
    --model "${MODEL}" \
    --host 0.0.0.0 \
    --port 8000 \
    --tensor-parallel-size $(nvidia-smi -L | wc -l) \
    --trust-remote-code &

  VLLM_PID=$!
  echo "vLLM starting (PID: ${VLLM_PID}), waiting for readiness..."

  for i in $(seq 1 60); do
    if curl -s http://localhost:8000/health | grep -q "ok" 2>/dev/null; then
      echo "vLLM is ready!"
      break
    fi
    if [ $i -eq 60 ]; then echo "WARNING: vLLM not ready after 10 min"; fi
    sleep 10
  done

  INFERENCE_URL="http://localhost:8000/v1"
  API_KEY="local"
  echo "Using local vLLM: ${INFERENCE_URL}"

else
  echo "ERROR: Unknown INFERENCE_MODE: ${INFERENCE_MODE}"
  echo "Supported: nebius-api, local-vllm"
  exit 1
fi

# ── 2. Configure OpenClaw ──
mkdir -p /home/sandbox/.openclaw
cat > /home/sandbox/.openclaw/openclaw.json <<EOF
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "${MODEL}"
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "nebius": {
        "baseUrl": "${INFERENCE_URL}",
        "apiKey": "${API_KEY}",
        "api": "openai-completions",
        "models": [
          {
            "id": "${MODEL}",
            "displayName": "Nebius GPU Inference"
          }
        ]
      }
    }
  }
}
EOF
chown -R sandbox:sandbox /home/sandbox/.openclaw

echo "OpenClaw configured → ${INFERENCE_URL} / ${MODEL}"

# ── 3. Start health check HTTP server on port 8080 ──
(while true; do
  echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"healthy\",\"service\":\"nemoclaw\",\"inference\":\"${INFERENCE_MODE}\",\"model\":\"${MODEL}\"}" \
    | nc -l -p 8080 -q 1 2>/dev/null || true
done) &

echo "Health check server started on port 8080"
echo "=== NemoClaw ready ==="

# ── 4. Drop to sandbox user and keep alive ──
exec su -s /bin/bash sandbox -c "while true; do sleep 3600; done"
