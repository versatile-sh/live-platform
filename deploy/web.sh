#!/bin/sh
# Publishes the client only: builds it and lays it over the running server. Nothing restarts and no call is touched.
# Scripts and styles go first and old ones stay, so a tab opened before still finds its files; the page that names the new ones goes last.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
host="${LIVE_HOST:-hosting}"
to="/srv/live/web"
cd "$root/web"
npm run build
ssh "$host" "mkdir -p $to/assets"
rsync -a --chmod=D755,F644 dist/assets/ "$host:$to/assets/"
rsync -a --chmod=D755,F644 --exclude=assets --exclude=index.html dist/ "$host:$to/"
rsync -a --chmod=F644 dist/index.html "$host:$to/index.html"
ssh "$host" "find $to/assets -type f -mtime +30 -name '*-????????.*' -delete"
echo "client published: $(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html)"
