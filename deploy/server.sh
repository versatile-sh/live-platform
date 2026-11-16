#!/bin/sh
# Publishes the server. Calls in progress drop for the seconds the new one takes to start; see DEPLOY.md.
# The client in the image is laid over too, so the page never goes back to an older one.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
host="${LIVE_HOST:-hosting}"
kamal="mise x ruby@3.4.12 -- op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal"
cd "$root"
$kamal build push
"$root/deploy/web.sh"
$kamal app maintenance
ssh "$host" 'docker stop $(docker ps -q --filter label=service=live)'
$kamal deploy --skip-push
$kamal app live
