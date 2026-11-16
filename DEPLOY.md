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
