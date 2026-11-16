#!/bin/sh
# Publishes the server without ending calls (ADR 0014). The new container starts on the media port the running one is not using;
# once it is healthy the old one hands its rooms over and tells every browser to come straight back. People see the call blink.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
host="${LIVE_HOST:-hosting}"
kamal="mise x ruby@3.4.12 -- op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal"
cd "$root"
ssh "$host" 'mkdir -p /srv/live/web/assets /srv/live/state && chown 65532:65532 /srv/live/state'
used="$(ssh "$host" 'docker ps --filter label=service=live --format "{{.Ports}}"' | grep -o '4000[01]->' | head -1 | tr -d '>-' || true)"
if [ "$used" = "40000" ]; then LIVE_MEDIA_PORT=40001; else LIVE_MEDIA_PORT=40000; fi
export LIVE_MEDIA_PORT
echo "media port: ${used:-none} -> $LIVE_MEDIA_PORT"
"$root/deploy/web.sh"
$kamal deploy
