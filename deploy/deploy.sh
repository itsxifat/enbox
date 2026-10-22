#!/usr/bin/env bash
# Enbox deploy (docs/design/spaces-at-scale.md "S0"): reads a source tarball (`git archive`) on
# stdin, builds it as a new release, points /opt/enbox/current at it and restarts the app
# processes, rolling back if one is unhealthy. Installed on the host as /opt/enbox/deploy.sh.
#
# From a checkout of the repo:
#   git archive --format=tar HEAD | ssh enfinito@<host> /opt/enbox/deploy.sh "$(git rev-parse --short HEAD)"
#   ... deploy.sh <rev> --full-stop   # stop every process before the first one starts again
#                                     # (releases whose boot migration old code can't run next to)
#
# Processes: one systemd instance `enbox@<port>` per port in $INSTANCES (default: the ports
# listed in /etc/enbox/instances, one per line; fallback 4000). They share PostgreSQL and
# Valkey (REDIS_URL) and sit behind the nginx upstream `enbox_app`. A rolling restart keeps
# the others serving; every boot migrates under an advisory lock, so the first new process
# migrates and the others find nothing pending.
#
# Rollback by hand: ln -sfn /opt/enbox/releases/<older> /opt/enbox/current && sudo systemctl restart 'enbox@*'
set -euo pipefail

BASE=/opt/enbox
REV="${1:-manual}"
MODE="${2:-rolling}"
KEEP=3
HEALTH_WAIT="${HEALTH_WAIT:-120}"

if [ -z "${INSTANCES:-}" ]; then
  # /etc/enbox is not readable by the deploy user: read it through sudo, else take the
  # enbox@<port> units systemd knows. Never fall back to one port while others run.
  INSTANCES="$( (cat /etc/enbox/instances 2>/dev/null || sudo -n cat /etc/enbox/instances 2>/dev/null || true) | grep -Eo '^[0-9]+' | tr '\n' ' ' || true)"
  if [ -z "${INSTANCES// /}" ]; then
    INSTANCES="$(systemctl list-units --all --plain --no-legend 'enbox@*.service' 2>/dev/null | grep -Eo 'enbox@[0-9]+' | cut -d@ -f2 | sort -un | tr '\n' ' ' || true)"
  fi
  INSTANCES="${INSTANCES:-4000}"
fi

export PATH="$BASE/node/bin:$PATH"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false

id="$(date -u +%Y%m%d%H%M%S)-${REV//[^A-Za-z0-9._-]/}"
dir="$BASE/releases/$id"
mkdir -p "$dir"
trap 'echo "!! Build failed; removing $dir" >&2; rm -rf "$dir"' ERR

echo "==> Extracting release $id"
tar -x -C "$dir"
cd "$dir"

echo "==> Installing dependencies (node $(node -v), npm $(npm -v))"
npm ci --loglevel=error

echo "==> Building"
APP_VERSION="$REV" npm run build
test -f apps/server/dist/index.js
test -f apps/web/dist/index.html
trap - ERR

healthy() {
  local port="$1" body
  for _ in $(seq 1 "$HEALTH_WAIT"); do
    if body="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null)"; then
      echo "==> enbox@$port healthy: $body"
      return 0
    fi
    sleep 1
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "$BASE/current.tmp"
  mv -Tf "$BASE/current.tmp" "$BASE/current"
}

restart_all() {
  local port
  if [ "$MODE" = "--full-stop" ]; then
    for port in $INSTANCES; do sudo systemctl stop "enbox@$port"; done
  fi
  for port in $INSTANCES; do
    sudo systemctl restart "enbox@$port"
    healthy "$port" || return 1
  done
}

prev="$(readlink -f "$BASE/current" 2>/dev/null || true)"
echo "==> Switching current -> $id (instances: $INSTANCES, $MODE)"
switch_to "$dir"

if restart_all; then
  # Keep the newest $KEEP releases (the one just deployed is the newest).
  ls -1dt "$BASE"/releases/*/ | tail -n +$((KEEP + 1)) | xargs -r rm -rf
  echo "==> Deployed $id"
  exit 0
fi

echo "!! Health check failed. Recent logs:" >&2
for port in $INSTANCES; do sudo journalctl -u "enbox@$port" -n 30 --no-pager >&2 || true; done
if [ -n "$prev" ] && [ -d "$prev" ] && [ "$prev" != "$dir" ]; then
  echo "!! Rolling back to $(basename "$prev")" >&2
  switch_to "$prev"
  for port in $INSTANCES; do sudo systemctl restart "enbox@$port" || true; done
fi
exit 1
