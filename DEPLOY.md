# Deploy

This app runs on the Versatile hosting at https://live.versatile.sh (open to everyone).
The hosting repo is at `/home/gengar/Projects/hosting`.

```bash
# first time
op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal setup
# each update (approve the 1Password prompt)
op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal deploy
# logs, rollback
op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal app logs -f
op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal rollback <version>
```

The service token in `ssh.env.op` lets Kamal reach the server without a browser login. The contract the app must meet
(port, `/up`, logs, telemetry, the Access check) is in the hosting docs, page "Deploy a repo".

## Two kinds of deploy

**The page changed (anything under `web/`):** nobody in a call is touched.

```sh
deploy/web.sh
```

It builds the client and lays it over the running server (ADR 0014). People already on the site keep the page they have until they reload.

**The server changed (anything under `server/`, the `Dockerfile` or `config/deploy.yml`):** the call blinks for a second or two and comes back by itself.

```sh
deploy/server.sh
```

The new container starts beside the old one on the other media port, the old one hands its rooms over, and every browser returns to its place (ADR 0014). `kamal app stop` and `kamal app maintenance` are not part of a deploy.

## Media

Audio and video do not pass through the Cloudflare Tunnel. The container publishes one UDP port on the server's own address, 40000 or 40001 by turns (`MEDIA_UDP_PORT`, `MEDIA_PUBLIC_IP`), and browsers send media straight to it. The server's address is therefore visible to anyone who enters a room.

## Check a deploy

Two stand-in browsers enter a room on the deployed server, wait for their media path and hear each other:

```sh
cd server && LIVE_PUBLIC_WS=wss://live.versatile.sh/ws go test -count=1 -run TestPublicCall ./internal/integration/
```

To see that publishing the client drops nobody, keep two stand-ins in a call while it runs:

```sh
cd server && LIVE_PUBLIC_WS=wss://live.versatile.sh/ws LIVE_STAY_SECONDS=60 go test -count=1 -timeout 180s -run TestPublicStay ./internal/integration/
```
