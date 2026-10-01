#!/usr/bin/env bash
# Pull main and redeploy if it changed. `--force` redeploys regardless.
# A redeploy rebuilds the world: reinstalls, wipes the operator table (so
# everyone re-registers), and restarts the server (booting anyone connected).
set -euo pipefail
APP_DIR=/opt/press-any-key
cd "$APP_DIR"
git fetch --depth 1 origin main
before=$(git rev-parse HEAD)
after=$(git rev-parse origin/main)
if [ "$before" = "$after" ] && [ "${1:-}" != "--force" ]; then
  echo "no change ($before) — nothing to do"
  exit 0
fi
echo ">>> rebuilding world: $before -> $after"
git reset --hard origin/main
cd server
npm install --omit=dev
rm -f data/operators.json           # reset the operator table
systemctl restart pak               # boots everyone connected
echo ">>> deployed $after"
