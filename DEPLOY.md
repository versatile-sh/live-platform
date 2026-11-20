# Deploy

The public instance runs at https://live.versatile.sh on Versatile's own hosting.
The deploy configuration of that hosting is kept out of this repository on purpose; see `.gitignore`. Its runbook and secrets are kept privately.

## What the app needs

Any host can run it. The contract is small:

- HTTP on `PORT`, with `200` on `/up` for the proxy's health check.
- WebSocket signalling on `SIGNAL_PORT`, routed to `/ws`.
- One UDP port for media, published on the host's own public address (`MEDIA_UDP_PORT`, `MEDIA_PUBLIC_IP`).
- Logs on stdout.
- Optional: `HANDOVER_DIR` for the handover between two servers, `WEB_LIVE_DIR` for a client published over the running server, `PASS_SOURCE` and `PASS_KEY` for guest passes.

## Two kinds of deploy

**The page changed (anything under `web/`):** nobody in a call is touched.
The client is built and laid over the running server (`WEB_LIVE_DIR`). Scripts and styles go first and the old ones stay, so a tab opened before still finds its files; `index.html` goes last. People already on the site keep the page they have until they reload.

**The server changed (anything under `server/` or the `Dockerfile`):** the call blinks for a second or two and comes back by itself.
The new container starts beside the old one on the other media port (two ports alternate from one deploy to the next), the old one hands its rooms over, and every browser returns to its place (`HANDOVER_DIR`). Stopping the app or putting it in maintenance is not part of a deploy.

## Media

Audio and video do not pass through the proxy in front of the site. The container publishes one UDP port on the server's own address, and browsers send media straight to it. The server's address is therefore visible to anyone who enters a room.

## Guest passes

With `PASS_SOURCE` and `PASS_KEY` set, the server takes guest passes from a trusted inviter (the Discord bot) on a private network, authenticated with a shared key. The key is a secret: it is injected at deploy time and never committed. Without those variables the route does not exist.

## Check a deploy

Two stand-in browsers enter a room on the deployed server, wait for their media path and hear each other:

```sh
cd server && LIVE_PUBLIC_WS=wss://live.versatile.sh/ws go test -count=1 -run TestPublicCall ./internal/integration/
```

To see that publishing the client drops nobody, keep two stand-ins in a call while it runs:

```sh
cd server && LIVE_PUBLIC_WS=wss://live.versatile.sh/ws LIVE_STAY_SECONDS=60 go test -count=1 -timeout 180s -run TestPublicStay ./internal/integration/
```
