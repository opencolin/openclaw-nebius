#!/bin/bash
# =============================================================================
# NemoClaw on Nebius GPU VM — Deployment Script
# =============================================================================
# Deploys a GPU VM with OpenClaw + vLLM for local inference on Nebius Cloud.
# The VM runs a model directly on the GPU — no external API needed.
#
# Prerequisites:
#   - nebius CLI installed and authenticated (nebius iam whoami)
#   - SSH key pair (will create one if missing)
#   - A Nebius project with GPU quota
#
# Usage:
#   ./install-nemoclaw-vm.sh
#
# Environment variables (optional):
#   PROJECT_ID     - Nebius project ID (auto-detected if not set)
#   GPU_PLATFORM   - GPU type: gpu-h100-sxm, gpu-h200-sxm, gpu-l40s-pcie
#   GPU_PRESET     - Resource preset (default: 1gpu-16vcpu-200gb)
#   INFERENCE_MODEL - Model to run on GPU (default: nvidia/Llama-3.1-Nemotron-70B-Instruct-HF)
#   SSH_KEY_PATH   - Path to SSH public key (default: ~/.ssh/id_ed25519_vm.pub)
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-}"
VM_NAME="${VM_NAME:-nemoclaw-gpu}"
GPU_PLATFORM="${GPU_PLATFORM:-gpu-h200-sxm}"
GPU_PRESET="${GPU_PRESET:-1gpu-16vcpu-200gb}"
BOOT_DISK_SIZE="${BOOT_DISK_SIZE:-200}"
INFERENCE_MODEL="${INFERENCE_MODEL:-nvidia/Llama-3.1-Nemotron-70B-Instruct-HF}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519_vm.pub}"
SSH_USER="colin"

# ── Colors ───────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m>>>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m   %s\n' "$*"; }
error() { printf '\033[1;31m✗\033[0m   %s\n' "$*"; exit 1; }

# ── Preflight checks ────────────────────────────────────────────────────────
info "Preflight checks..."

command -v nebius &>/dev/null || error "Nebius CLI not installed. Run: curl -sSL https://storage.ai.nebius.cloud/nebius/install.sh | bash"
nebius iam get-access-token >/dev/null 2>&1 || error "Not authenticated. Run: nebius iam whoami"
ok "Authenticated"

# SSH key
if [ ! -f "$SSH_KEY_PATH" ]; then
  info "Creating SSH key pair..."
  ssh-keygen -t ed25519 -f "${SSH_KEY_PATH%.pub}" -N "" -C "nemoclaw-vm"
fi
SSH_KEY=$(cat "$SSH_KEY_PATH")
ok "SSH key: $SSH_KEY_PATH"

# Auto-detect project ID
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(nebius iam project list --format json 2>/dev/null | \
    python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['metadata']['id'] if items else '')" 2>/dev/null || echo "")
  [ -z "$PROJECT_ID" ] && error "Could not auto-detect project. Set PROJECT_ID env var."
fi
ok "Project: $PROJECT_ID"

# ── Step 1: Create boot disk ────────────────────────────────────────────────
info "Step 1: Creating boot disk (Ubuntu 22.04 + CUDA 12)..."

DISK_ID=$(nebius compute disk create \
  --name "${VM_NAME}-boot" \
  --parent-id "${PROJECT_ID}" \
  --type network_ssd \
  --size-gibibytes "${BOOT_DISK_SIZE}" \
  --block-size-bytes 4096 \
  --source-image-family-image-family ubuntu22.04-cuda12 \
  --format json 2>&1 | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")

ok "Disk created: $DISK_ID"

# ── Step 2: Find or create subnet ───────────────────────────────────────────
info "Step 2: Looking up subnet..."

SUBNET_ID=$(nebius vpc subnet list --format json 2>/dev/null | \
  python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['metadata']['id'] if items else '')" 2>/dev/null || echo "")

if [ -z "$SUBNET_ID" ]; then
  info "Creating VPC network + subnet..."

  NETWORK_ID=$(nebius vpc network create \
    --name nemoclaw-net \
    --parent-id "${PROJECT_ID}" \
    --format json | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
  sleep 5

  SUBNET_ID=$(nebius vpc subnet create \
    --name nemoclaw-subnet \
    --parent-id "${PROJECT_ID}" \
    --network-id "${NETWORK_ID}" \
    --ipv4-cidr-blocks '["10.0.0.0/24"]' \
    --format json | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
  sleep 5
fi
ok "Subnet: $SUBNET_ID"

# ── Step 3: Create cloud-init ────────────────────────────────────────────────
info "Step 3: Preparing cloud-init..."

read -r -d '' CLOUD_INIT << CLOUDINIT_EOF || true
#cloud-config
users:
  - name: ${SSH_USER}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ${SSH_KEY}

write_files:
  - path: /opt/nemoclaw/bootstrap.sh
    permissions: '0755'
    content: |
      #!/bin/bash
      set -e
      echo "=== NemoClaw GPU VM Bootstrap ==="

      # Wait for GPU
      for i in \$(seq 1 30); do
        nvidia-smi &>/dev/null && break || sleep 10
      done
      nvidia-smi

      # Install Node.js + OpenClaw
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs python3-pip python3-venv
      npm install -g openclaw

      # Install vLLM in a venv
      python3 -m venv /opt/vllm-env
      /opt/vllm-env/bin/pip install vllm

      # Configure OpenClaw for local inference
      sudo -u ${SSH_USER} mkdir -p /home/${SSH_USER}/.openclaw
      cat > /home/${SSH_USER}/.openclaw/openclaw.json << OCJSON
      {
        "agents": {"defaults": {"model": {"primary": "local/${INFERENCE_MODEL}"}}},
        "models": {
          "mode": "merge",
          "providers": {
            "local": {
              "baseUrl": "http://localhost:8000/v1",
              "apiKey": "local",
              "api": "openai-completions",
              "models": [{"id": "${INFERENCE_MODEL}", "name": "Local GPU"}]
            }
          }
        },
        "gateway": {"port": 18789, "mode": "local", "bind": "loopback", "auth": {"mode": "none"}}
      }
      OCJSON
      chown -R ${SSH_USER}:${SSH_USER} /home/${SSH_USER}/.openclaw

      # Start vLLM
      /opt/vllm-env/bin/python3 -m vllm.entrypoints.openai.api_server \\
        --model ${INFERENCE_MODEL} \\
        --host 0.0.0.0 --port 8000 \\
        --trust-remote-code \\
        --gpu-memory-utilization 0.90 &

      echo "=== Bootstrap complete ==="

runcmd:
  - bash /opt/nemoclaw/bootstrap.sh 2>&1 | tee /var/log/nemoclaw-bootstrap.log
CLOUDINIT_EOF

ok "Cloud-init prepared"

# ── Step 4: Create VM ───────────────────────────────────────────────────────
info "Step 4: Creating GPU VM ($GPU_PLATFORM / $GPU_PRESET)..."

RESULT=$(nebius compute instance create \
  --name "${VM_NAME}" \
  --parent-id "${PROJECT_ID}" \
  --resources-platform "${GPU_PLATFORM}" \
  --resources-preset "${GPU_PRESET}" \
  --boot-disk-attach-mode read_write \
  --boot-disk-existing-disk-id "${DISK_ID}" \
  --network-interfaces "[{\"name\":\"eth0\",\"subnet_id\":\"${SUBNET_ID}\",\"ip_address\":{},\"public_ip_address\":{}}]" \
  --cloud-init-user-data "$CLOUD_INIT" \
  --format json 2>&1)

INSTANCE_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
PUBLIC_IP=$(echo "$RESULT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for n in d.get('status',{}).get('network_interfaces',[]):
    ip=n.get('public_ip_address',{}).get('address','')
    if ip: print(ip.split('/')[0])
")

ok "VM created: $INSTANCE_ID"

# ── Done ─────────────────────────────────────────────────────────────────────
SSH_KEY_PRIV="${SSH_KEY_PATH%.pub}"

echo ""
echo "============================================="
echo "  NemoClaw GPU VM — Deployed!"
echo "============================================="
echo ""
echo "  Instance:   $INSTANCE_ID"
echo "  Public IP:  $PUBLIC_IP"
echo "  GPU:        $GPU_PLATFORM ($GPU_PRESET)"
echo "  Model:      $INFERENCE_MODEL"
echo ""
echo "  SSH into the VM:"
echo "    ssh -i $SSH_KEY_PRIV $SSH_USER@$PUBLIC_IP"
echo ""
echo "  Check bootstrap progress:"
echo "    ssh -i $SSH_KEY_PRIV $SSH_USER@$PUBLIC_IP 'tail -f /var/log/nemoclaw-bootstrap.log'"
echo ""
echo "  Once bootstrap finishes, start OpenClaw:"
echo "    ssh -i $SSH_KEY_PRIV $SSH_USER@$PUBLIC_IP"
echo "    openclaw gateway &"
echo "    openclaw tui"
echo ""
echo "  Or connect remotely:"
echo "    openclaw tui --url ws://$PUBLIC_IP:18789"
echo ""
echo "  Manage VM:"
echo "    nebius compute instance stop --id $INSTANCE_ID   # pause billing"
echo "    nebius compute instance start --id $INSTANCE_ID  # resume"
echo "    nebius compute instance delete --id $INSTANCE_ID # permanent"
echo ""
echo "  GPU Platforms:"
echo "    gpu-h100-sxm  (80 GB)  - general inference"
echo "    gpu-h200-sxm  (141 GB) - large models (default)"
echo "    gpu-b200-sxm  (180 GB) - next-gen"
echo "    gpu-l40s-pcie (48 GB)  - cost-effective"
echo ""
