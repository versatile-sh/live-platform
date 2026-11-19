#!/usr/bin/env bash
set -euo pipefail

STATE="${XDG_RUNTIME_DIR:-/tmp}/screen-audio.state"
DESKTOP_SINK=desktop_share
CALL_SINK=call_output
DISCORD_FILTER='.[] | select(((.properties["application.name"] // "") + " " + (.properties["application.process.binary"] // "")) | test("discord"; "i")) | .index'

move_discord() {
  pactl -f json list sink-inputs 2>/dev/null | jq -r "$DISCORD_FILTER" | while read -r index; do
    pactl move-sink-input "$index" "$CALL_SINK" 2>/dev/null || true
  done
}

watch_discord() {
  move_discord
  pactl subscribe | while read -r line; do
    case "$line" in *"'new' on sink-input"*) move_discord ;; esac
  done
}

status() {
  if [[ -f "$STATE" ]]; then
    echo "on  (default sink: $(pactl get-default-sink))"
  else
    echo "off (default sink: $(pactl get-default-sink))"
  fi
}

stop_routing() {
  [[ -f "$STATE" ]] || { echo "screen-audio already off"; return 0; }
  source "$STATE"
  if [[ -n "$WATCHER" ]]; then
    pkill -P "$WATCHER" 2>/dev/null || true
    kill "$WATCHER" 2>/dev/null || true
  fi
  pactl set-default-sink "$REAL_SINK"
  pactl set-default-source "$REAL_SOURCE"
  for module in $MODULES; do pactl unload-module "$module" 2>/dev/null || true; done
  rm -f "$STATE"
  echo "screen-audio off: audio back on $REAL_SINK"
}

start_routing() {
  [[ -f "$STATE" ]] && { echo "screen-audio already on"; return 0; }
  local real_sink real_source modules=""
  real_sink="$(pactl get-default-sink)"
  real_source="$(pactl get-default-source)"
  trap 'for m in $modules; do pactl unload-module "$m" 2>/dev/null || true; done; pactl set-default-sink "$real_sink"; pactl set-default-source "$real_source"' ERR

  load() { modules="$(pactl load-module "$@") $modules"; }
  load module-null-sink sink_name="$DESKTOP_SINK" sink_properties=device.description=Desktop-Audio
  load module-null-sink sink_name="$CALL_SINK" sink_properties=device.description=Call-Output
  load module-remap-source master="$DESKTOP_SINK.monitor" source_name=desktop_share_source source_properties=device.description=Desktop-Audio-Share
  load module-loopback source="$DESKTOP_SINK.monitor" sink="$real_sink" latency_msec=20 source_dont_move=true sink_dont_move=true
  load module-loopback source="$CALL_SINK.monitor" sink="$real_sink" latency_msec=20 source_dont_move=true sink_dont_move=true

  pactl set-default-sink "$DESKTOP_SINK"
  pactl set-default-source "$real_source"

  local watcher=""
  if command -v jq >/dev/null; then
    watch_discord >/dev/null 2>&1 &
    watcher=$!
    disown "$watcher"
  fi
  printf 'REAL_SINK=%q\nREAL_SOURCE=%q\nMODULES=%q\nWATCHER=%q\n' "$real_sink" "$real_source" "$modules" "$watcher" > "$STATE"
  trap - ERR
  echo "screen-audio on: desktop is shared, call and Discord are not"
}

case "${1:-status}" in
  on) start_routing ;;
  off) stop_routing ;;
  status) status ;;
  *) echo "usage: screen-audio on|off|status" >&2; exit 2 ;;
esac
