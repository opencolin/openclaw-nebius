#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  OpenClaw Deploy UI — VM Setup Script
#  Installs the web-based deployment tool on a fresh Nebius VM
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────
echo ""
echo "  🦞 OpenClaw Deploy UI — Setup"
echo "  ─────────────────────────────"
echo ""

# Must run as nebius user (default on Nebius VMs)
if [ "$(whoami)" = "root" ]; then
  error "Don't run as root. Run as the 'nebius' user (default on Nebius VMs)."
fi

# ── Step 1: Install Node.js 20 ────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  info "Node.js already installed: $NODE_VER"
else
  warn "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1
  sudo apt-get install -y nodejs > /dev/null 2>&1
  info "Node.js $(node -v) installed"
fi

# ── Step 2: Install Nebius CLI ─────────────────────────────────────────────
if command -v nebius &>/dev/null; then
  info "Nebius CLI already installed"
else
  warn "Installing Nebius CLI..."
  curl -sSL https://storage.ai.nebius.cloud/nebius/install.sh | bash > /dev/null 2>&1
  export PATH="$HOME/.nebius/bin:$PATH"
  # Add to shell profile
  grep -q '.nebius/bin' ~/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.nebius/bin:$PATH"' >> ~/.bashrc
  info "Nebius CLI installed"
fi

# ── Step 3: Authenticate with Nebius ───────────────────────────────────────
if nebius iam get-access-token > /dev/null 2>&1; then
  USER_NAME=$(nebius iam whoami --format json 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    attrs = d.get('user_profile', {}).get('attributes', {})
    print(attrs.get('name', attrs.get('given_name', 'Nebius User')))
except: print('Nebius User')
" 2>/dev/null)
  info "Authenticated as: $USER_NAME"
else
  warn "Nebius CLI not authenticated. Opening browser login..."
  nebius profile create
  info "Authentication complete"
fi

# ── Step 4: Clone the repo ─────────────────────────────────────────────────
INSTALL_DIR="$HOME/openclaw-deploy"
if [ -d "$INSTALL_DIR" ]; then
  warn "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
else
  warn "Cloning OpenClaw Deploy..."
  git clone https://github.com/opencolin/openclaw-nebius.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
info "Code ready at $INSTALL_DIR"

# ── Step 5: Install dependencies ──────────────────────────────────────────
cd "$INSTALL_DIR/web"
npm install --production > /dev/null 2>&1
info "Dependencies installed"

# ── Step 6: Generate SSH key for endpoints ────────────────────────────────
if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
  warn "Generating SSH key for endpoint access..."
  ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519" -N "" -C "openclaw-deploy" > /dev/null 2>&1
fi
# Ensure pub key exists
if [ ! -f "$HOME/.ssh/id_ed25519.pub" ]; then
  ssh-keygen -y -f "$HOME/.ssh/id_ed25519" > "$HOME/.ssh/id_ed25519.pub"
fi
info "SSH key ready: $(cat $HOME/.ssh/id_ed25519.pub | cut -d' ' -f1-2 | cut -c1-40)..."

# ── Step 7: Install nginx with HTTPS ──────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  warn "Installing nginx..."
  sudo apt-get update -qq > /dev/null 2>&1
  sudo apt-get install -y nginx > /dev/null 2>&1
fi

# Generate self-signed cert if needed
if [ ! -f /etc/nginx/ssl/selfsigned.crt ]; then
  warn "Generating self-signed SSL certificate..."
  sudo mkdir -p /etc/nginx/ssl
  sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/selfsigned.key \
    -out /etc/nginx/ssl/selfsigned.crt \
    -subj "/CN=openclaw-deploy" 2>/dev/null
fi

# Configure nginx
sudo tee /etc/nginx/sites-available/openclaw > /dev/null << 'NGINX_CONF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;

    client_max_body_size 10m;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX_CONF

sudo ln -sf /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/openclaw
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t > /dev/null 2>&1 && sudo systemctl restart nginx
info "nginx configured with HTTPS"

# ── Step 8: Create systemd service ────────────────────────────────────────
sudo tee /etc/systemd/system/openclaw-deploy.service > /dev/null << EOF
[Unit]
Description=OpenClaw Deploy UI
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$INSTALL_DIR/web
ExecStart=$(which node) server.js
Restart=always
RestartSec=5
Environment=PORT=3000
Environment=NODE_ENV=production
Environment=PATH=$HOME/.nebius/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable openclaw-deploy > /dev/null 2>&1
sudo systemctl restart openclaw-deploy
info "Service installed and started"

# ── Step 9: Verify ────────────────────────────────────────────────────────
sleep 2
if curl -sk https://localhost/health | grep -q '"ok"'; then
  info "Health check passed"
else
  warn "Health check failed — check: sudo journalctl -u openclaw-deploy -f"
fi

# ── Done ──────────────────────────────────────────────────────────────────
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo "  ═══════════════════════════════════════════════"
echo "  🦞 OpenClaw Deploy UI is ready!"
echo ""
echo "  Open: https://${PUBLIC_IP}"
echo ""
echo "  (Accept the self-signed certificate warning)"
echo "  ═══════════════════════════════════════════════"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status openclaw-deploy   # check service"
echo "    sudo journalctl -u openclaw-deploy -f   # live logs"
echo "    cd ~/openclaw-deploy && git pull &&"
echo "      sudo systemctl restart openclaw-deploy # update"
echo ""
