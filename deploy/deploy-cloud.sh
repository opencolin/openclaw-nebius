#!/bin/bash
# =============================================================================
# OpenClaw Deploy UI — Cloud Deployment Script
# =============================================================================
# Provisions a small CPU VM on Nebius to host the Deploy UI in the cloud.
# The VM runs Node.js with the full deploy UI, nebius CLI, and SSH access.
#
# Prerequisites:
#   - nebius CLI installed and authenticated (nebius iam whoami)
#   - SSH key pair (~/.ssh/id_ed25519 or similar)
#
# Usage:
#   ./deploy-cloud.sh
#
# Environment variables (optional):
#   REGION          - Nebius region (default: auto-detected from CLI config)
#   VM_NAME         - VM name (default: openclaw-deploy-ui)
#   SSH_KEY_PATH    - Path to SSH public key (default: ~/.ssh/id_ed25519.pub)
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
VM_NAME="${VM_NAME:-openclaw-deploy-ui}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519.pub}"
SSH_PRIVATE_KEY="${SSH_PRIVATE_KEY:-${SSH_KEY_PATH%.pub}}"
DEPLOY_UI_PORT=3000
REPO_URL="https://github.com/colygon/openclaw-deploy.git"

# ── Colors ───────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m>>>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m   %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m   %s\n' "$*"; }
error() { printf '\033[1;31m✗\033[0m   %s\n' "$*"; exit 1; }

# ── Preflight checks ────────────────────────────────────────────────────────
info "Preflight checks..."

command -v nebius &>/dev/null || error "Nebius CLI not installed. Run: curl -sSL https://storage.ai.nebius.cloud/nebius/install.sh | bash"
nebius iam get-access-token >/dev/null 2>&1 || error "Not authenticated. Run: nebius iam login"
ok "Nebius CLI authenticated"

# SSH key
if [ ! -f "$SSH_KEY_PATH" ]; then
  info "Creating SSH key pair..."
  ssh-keygen -t ed25519 -f "${SSH_KEY_PATH%.pub}" -N "" -C "openclaw-deploy"
fi
[ -f "$SSH_KEY_PATH" ] || error "SSH public key not found: $SSH_KEY_PATH"
ok "SSH key: $SSH_KEY_PATH"

SSH_PUB_KEY=$(cat "$SSH_KEY_PATH")

# ── Auto-detect project and region from nebius config ─────────────────────
info "Detecting Nebius project..."

NEBIUS_CONFIG="$HOME/.nebius/config.yaml"
if [ ! -f "$NEBIUS_CONFIG" ]; then
  error "No Nebius config found at $NEBIUS_CONFIG"
fi

# Get the default profile name
DEFAULT_PROFILE=$(grep -m1 '^default:' "$NEBIUS_CONFIG" | awk '{print $2}')
DEFAULT_PROFILE="${DEFAULT_PROFILE:-eu-north1}"

# Find the first profile with a project-* parent-id
PROFILE=""
PROJECT_ID=""
while IFS= read -r line; do
  if [[ "$line" =~ ^[[:space:]]{4}([a-zA-Z0-9_-]+):$ ]]; then
    current_profile="${BASH_REMATCH[1]}"
  fi
  if [[ "$line" =~ parent-id:[[:space:]]*(project-[a-zA-Z0-9_-]+) ]]; then
    # Prefer the default profile
    if [ "$current_profile" = "$DEFAULT_PROFILE" ]; then
      PROFILE="$current_profile"
      PROJECT_ID="${BASH_REMATCH[1]}"
      break
    fi
    # Otherwise take the first one we find
    if [ -z "$PROJECT_ID" ]; then
      PROFILE="$current_profile"
      PROJECT_ID="${BASH_REMATCH[1]}"
    fi
  fi
done < "$NEBIUS_CONFIG"

[ -n "$PROJECT_ID" ] || error "Could not detect project ID. Set PROJECT_ID env var."
ok "Project: $PROJECT_ID"

# Detect region from profile name
REGION="${REGION:-}"
if [ -z "$REGION" ]; then
  for r in eu-north1 eu-west1 us-central1; do
    if [[ "$PROFILE" == *"$r"* ]]; then
      REGION="$r"
      break
    fi
  done
  REGION="${REGION:-$PROFILE}"
fi
ok "Region: $REGION"
ok "Profile: $PROFILE"

# ── Step 1: Find or create network ────────────────────────────────────────
info "Step 1: Setting up networking..."

SUBNET_ID=$(nebius --profile "$PROFILE" vpc subnet list --format json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d.get('items', []):
    print(item['metadata']['id'])
    break
" 2>/dev/null || true)

if [ -z "$SUBNET_ID" ]; then
  info "Creating VPC network..."
  NET_RESULT=$(nebius --profile "$PROFILE" vpc network create \
    --name "openclaw-net" \
    --parent-id "$PROJECT_ID" \
    --format json 2>&1)
  NET_ID=$(echo "$NET_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")

  info "Creating subnet..."
  SUB_RESULT=$(nebius --profile "$PROFILE" vpc subnet create \
    --name "openclaw-subnet" \
    --parent-id "$PROJECT_ID" \
    --network-id "$NET_ID" \
    --ipv4-cidr "10.0.0.0/24" \
    --format json 2>&1)
  SUBNET_ID=$(echo "$SUB_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
fi

ok "Subnet: $SUBNET_ID"

# ── Step 2: Create boot disk ─────────────────────────────────────────────
info "Step 2: Creating boot disk..."

DISK_RESULT=$(nebius --profile "$PROFILE" compute disk create \
  --name "${VM_NAME}-disk" \
  --parent-id "$PROJECT_ID" \
  --type "network_ssd" \
  --size-gibibytes 50 \
  --source-image-family-image-family "ubuntu22.04-cuda12" \
  --format json 2>&1)

DISK_ID=$(echo "$DISK_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
ok "Disk: $DISK_ID"

# Wait for disk to be ready
info "Waiting for disk..."
for i in $(seq 1 30); do
  STATE=$(nebius --profile "$PROFILE" compute disk get --id "$DISK_ID" --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('state',''))" 2>/dev/null || echo "")
  if [ "$STATE" = "READY" ]; then
    break
  fi
  sleep 5
done
ok "Disk ready"

# ── Step 3: Prepare cloud-init ───────────────────────────────────────────
info "Step 3: Preparing cloud-init..."

read -r -d '' CLOUD_INIT << 'CLOUDINIT_EOF' || true
#cloud-config
users:
  - name: nebius
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - SSH_PUB_KEY_PLACEHOLDER

packages:
  - git
  - curl
  - socat

write_files:
  - path: /opt/deploy-ui/install.sh
    permissions: "0755"
    content: |
      #!/bin/bash
      set -euo pipefail

      export HOME=/home/nebius
      export DEBIAN_FRONTEND=noninteractive

      echo "=== Installing Node.js 20 ==="
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs

      echo "=== Installing Nebius CLI ==="
      su - nebius -c 'curl -sSL https://storage.ai.nebius.cloud/nebius/install.sh | bash'

      echo "=== Cloning OpenClaw Deploy UI ==="
      cd /home/nebius
      su - nebius -c 'git clone REPO_URL_PLACEHOLDER'
      cd /home/nebius/openclaw-deploy/web
      su - nebius -c 'cd /home/nebius/openclaw-deploy/web && npm install'

      echo "=== Creating systemd service ==="
      cat > /etc/systemd/system/openclaw-deploy.service << 'SVCEOF'
      [Unit]
      Description=OpenClaw Deploy UI
      After=network.target

      [Service]
      Type=simple
      User=nebius
      WorkingDirectory=/home/nebius/openclaw-deploy/web
      ExecStart=/usr/bin/node server.js
      Restart=always
      RestartSec=10
      Environment=PORT=3000
      Environment=HOME=/home/nebius
      Environment=PATH=/home/nebius/.nebius/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

      [Install]
      WantedBy=multi-user.target
      SVCEOF

      systemctl daemon-reload
      systemctl enable openclaw-deploy

      echo "=== Deploy UI installed ==="
      echo "Waiting for nebius config to be copied before starting..."

runcmd:
  - bash /opt/deploy-ui/install.sh 2>&1 | tee /var/log/deploy-ui-install.log
CLOUDINIT_EOF

# Substitute placeholders
CLOUD_INIT="${CLOUD_INIT//SSH_PUB_KEY_PLACEHOLDER/$SSH_PUB_KEY}"
CLOUD_INIT="${CLOUD_INIT//REPO_URL_PLACEHOLDER/$REPO_URL}"

ok "Cloud-init prepared"

# ── Step 4: Create VM ───────────────────────────────────────────────────
info "Step 4: Creating CPU VM..."

# Detect CPU platform for this region
CPU_PLATFORM="cpu-e2"
case "$REGION" in
  eu-west1) CPU_PLATFORM="cpu-d3" ;;
esac

RESULT=$(nebius --profile "$PROFILE" compute instance create \
  --name "${VM_NAME}" \
  --parent-id "${PROJECT_ID}" \
  --resources-platform "${CPU_PLATFORM}" \
  --resources-preset "2vcpu-8gb" \
  --boot-disk-attach-mode read_write \
  --boot-disk-existing-disk-id "${DISK_ID}" \
  --network-interfaces "[{\"name\":\"eth0\",\"subnet_id\":\"${SUBNET_ID}\",\"ip_address\":{},\"public_ip_address\":{}}]" \
  --cloud-init-user-data "$CLOUD_INIT" \
  --format json 2>&1)

INSTANCE_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['id'])")
ok "VM created: $INSTANCE_ID"

# ── Step 5: Wait for public IP ──────────────────────────────────────────
info "Step 5: Waiting for public IP..."

PUBLIC_IP=""
for i in $(seq 1 30); do
  PUBLIC_IP=$(nebius --profile "$PROFILE" compute instance get --id "$INSTANCE_ID" --format json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for n in d.get('status',{}).get('network_interfaces',[]):
    ip=n.get('public_ip_address',{}).get('address','')
    if ip:
        print(ip.split('/')[0])
        break
" 2>/dev/null || true)

  if [ -n "$PUBLIC_IP" ]; then
    break
  fi
  sleep 5
done

[ -n "$PUBLIC_IP" ] || error "Could not get public IP. Check: nebius compute instance get --id $INSTANCE_ID"
ok "Public IP: $PUBLIC_IP"

# ── Step 6: Wait for SSH and copy auth ──────────────────────────────────
info "Step 6: Waiting for SSH access (this may take 2-3 minutes)..."

SSH_OPTS="-i $SSH_PRIVATE_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10"

for i in $(seq 1 36); do
  if ssh $SSH_OPTS nebius@"$PUBLIC_IP" "echo ready" >/dev/null 2>&1; then
    break
  fi
  printf "."
  sleep 10
done
echo ""
ok "SSH accessible"

# Wait for cloud-init to finish
info "Waiting for cloud-init to complete..."
for i in $(seq 1 30); do
  if ssh $SSH_OPTS nebius@"$PUBLIC_IP" "test -f /var/log/deploy-ui-install.log && tail -1 /var/log/deploy-ui-install.log" 2>/dev/null | grep -q "installed"; then
    break
  fi
  sleep 10
done
ok "Cloud-init complete"

# ── Step 7: Copy nebius config and SSH keys ─────────────────────────────
info "Step 7: Copying Nebius config and SSH keys..."

# Copy nebius CLI config (auth tokens, profiles)
scp $SSH_OPTS -r "$HOME/.nebius" nebius@"$PUBLIC_IP":~/.nebius 2>/dev/null
ok "Nebius config copied"

# Copy SSH private key (for connecting to deployed endpoints)
scp $SSH_OPTS "$SSH_PRIVATE_KEY" nebius@"$PUBLIC_IP":~/.ssh/id_ed25519 2>/dev/null
ssh $SSH_OPTS nebius@"$PUBLIC_IP" "chmod 600 ~/.ssh/id_ed25519" 2>/dev/null
ok "SSH key copied"

# ── Step 8: Start the service ───────────────────────────────────────────
info "Step 8: Starting OpenClaw Deploy UI..."

ssh $SSH_OPTS nebius@"$PUBLIC_IP" "sudo systemctl start openclaw-deploy"
sleep 2

# Verify it's running
if ssh $SSH_OPTS nebius@"$PUBLIC_IP" "curl -s localhost:3000/health" 2>/dev/null | grep -q "ok"; then
  ok "Service running"
else
  warn "Service may still be starting. Check: ssh nebius@$PUBLIC_IP 'journalctl -u openclaw-deploy -f'"
fi

# ── Done ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  🦞 OpenClaw Deploy UI is live!"
echo ""
echo "  URL:        http://$PUBLIC_IP:$DEPLOY_UI_PORT"
echo "  SSH:        ssh -i $SSH_PRIVATE_KEY nebius@$PUBLIC_IP"
echo "  VM ID:      $INSTANCE_ID"
echo "  Region:     $REGION"
echo ""
echo "  To check logs:"
echo "    ssh -i $SSH_PRIVATE_KEY nebius@$PUBLIC_IP 'journalctl -u openclaw-deploy -f'"
echo ""
echo "  To update:"
echo "    ssh -i $SSH_PRIVATE_KEY nebius@$PUBLIC_IP 'cd openclaw-deploy && git pull && sudo systemctl restart openclaw-deploy'"
echo ""
echo "  To tear down:"
echo "    nebius --profile $PROFILE compute instance delete --id $INSTANCE_ID"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
