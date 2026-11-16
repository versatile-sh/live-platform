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

**The server changed (anything under `server/`, the `Dockerfile` or `config/deploy.yml`):** calls drop for about thirty seconds while the new container starts. Do it when the rooms are empty.

```sh
deploy/server.sh
```

It shows the maintenance pages in `deploy/errors` meanwhile. `kamal app stop` is never used: it takes the app out of the proxy, which then answers with its own stock page.

## Media

Audio and video do not pass through the Cloudflare Tunnel. The container publishes UDP 40000 on the server's own address (`MEDIA_UDP_PORT`, `MEDIA_PUBLIC_IP` in `config/deploy.yml`), and browsers send media straight to it. The server's address is therefore visible to anyone who enters a room, and two containers cannot hold that port at once, which is why a server deploy stops the old one first.

## Check a deploy

Two stand-in browsers enter a room on the deployed server, wait for their media path and hear each other:

```sh
cd server && LIVE_PUBLIC_WS=wss://live.versatile.sh/ws go test -count=1 -run TestPublicCall ./internal/integration/
```

To see that publishing the client drops nobody, keep two stand-ins in a call while it runs:

```sh
cd server && LIVE_PUBLIC_WS=wss://live.versatile.sh/ws LIVE_STAY_SECONDS=60 go test -count=1 -timeout 180s -run TestPublicStay ./internal/integration/
```
