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

## Media

Audio and video do not pass through the Cloudflare Tunnel. The container publishes UDP 40000 on the server's own address (`MEDIA_UDP_PORT`, `MEDIA_PUBLIC_IP` in `config/deploy.yml`), and browsers send media straight to it. Two consequences:

- The server's address is visible to anyone who enters a room.
- Two containers cannot hold the same published port, and Kamal starts the new one before stopping the old. Stop the running one first; calls in progress drop and reconnect:

```sh
op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal app stop
op run --env-file /home/gengar/Projects/hosting/infra/ssh.env.op -- /home/gengar/Projects/hosting/infra/kamal/kamal deploy
```

## Check a deploy

Two stand-in browsers enter a room on the deployed server, wait for their media path and hear each other:

```sh
cd server && LIVE_PUBLIC_WS=wss://live.versatile.sh/ws go test -count=1 -run TestPublicCall ./internal/integration/
```
