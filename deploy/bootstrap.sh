#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 24.04 droplet. Installs Node, the app,
# a systemd service, Caddy (automatic HTTPS), and an hourly self-update timer.
# Re-running it is safe; it also acts as a redeploy.
#
#   curl -fsSL https://raw.githubusercontent.com/KKallas/press-any-key-to-continue/main/deploy/bootstrap.sh | bash
#
set -euo pipefail

DOMAIN=game.roboarena.org
REPO=https://github.com/KKallas/press-any-key-to-continue.git
APP_DIR=/opt/press-any-key

echo ">>> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl

echo ">>> node 20 LTS"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo ">>> code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin main
  git -C "$APP_DIR" reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
cd "$APP_DIR/server"
npm install --omit=dev

echo ">>> service"
cat >/etc/systemd/system/pak.service <<UNIT
[Unit]
Description=Press Any Key to Continue — game server
After=network.target

[Service]
WorkingDirectory=$APP_DIR/server
ExecStart=/usr/bin/node server.mjs
Environment=PORT=8000
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now pak
systemctl restart pak

echo ">>> self-update: pak-update command + hourly timer"
ln -sf "$APP_DIR/deploy/update.sh" /usr/local/bin/pak-update
cat >/etc/systemd/system/pak-update.service <<UNIT
[Unit]
Description=Press Any Key — pull main and redeploy if changed
After=network-online.target

[Service]
Type=oneshot
ExecStart=$APP_DIR/deploy/update.sh
UNIT
cat >/etc/systemd/system/pak-update.timer <<UNIT
[Unit]
Description=Hourly check for new game code on main

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now pak-update.timer

echo ">>> caddy (automatic https)"
# Caddy's apt repo ships an expired signing key, so install the official
# static binary directly instead.
if ! command -v caddy >/dev/null; then
  curl -fsSL -o /usr/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64"
  chmod +x /usr/bin/caddy
fi
id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
mkdir -p /etc/caddy
cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy localhost:8000
}
CADDY
chown -R caddy:caddy /etc/caddy /var/lib/caddy
cat >/etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy
After=network.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=on-failure
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now caddy
systemctl restart caddy

echo ">>> done"
echo "service:  $(systemctl is-active pak)"
echo "caddy:    $(systemctl is-active caddy)"
echo "timer:    $(systemctl is-active pak-update.timer)"
echo "visit:    https://$DOMAIN   (first load waits on DNS + TLS cert)"
