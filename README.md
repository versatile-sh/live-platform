# live.versatile.sh

Rooms to share a screen, a voice and a camera from a link. No account, nothing to install. Open a name, send the link, talk.

`https://live.versatile.sh/{room}`

## What it does

- **Rooms by name.** Whoever opens a free name creates the room and owns it. The room is released 30 seconds after the last person leaves. Up to 10 people.
- **Public or private.** A public room lets in anyone with the link. A private room asks for a room code (`8ABH-23HK`), drawn at random or chosen by the owner. Either kind can be shown in the open rooms, with its country.
- **Nobody is left behind as a ghost.** A closed tab, a dead socket or a lost network removes the participant. The server decides who is in the room; browsers only report.
- **In the call.** Microphone, camera, screen with system audio, raised hand, chat with links, emoji, GIFs and private messages, a lime outline on whoever is speaking, people list, owner controls (transfer, kick, ban, mute everyone and let speak by raised hand, change access), a shared whiteboard, three voice filters with echo, gain, balanced voice and a noise gate, push to talk, camera and screen quality, background blur for the camera, live connection figures (route, delay, loss, jitter, rates, codecs), per-person choice of what to see, a command search on `Ctrl+K`.
- **English and Portuguese.**

## How it is built

```
browser ──HTTPS──▶ Cloudflare ──▶ net/http   page, /api/rooms, /api/lobby
        ──WSS────▶ Cloudflare ──▶ gnet       signalling, subprotocol lv.1
        ──UDP (DTLS-SRTP)──────▶ Pion        media, straight to the server
```

One Go binary, three listeners, one process.

| Part | Choice | Why |
| --- | --- | --- |
| Media | Our own SFU on Pion, for every room | A mesh costs each person an upload per listener; a hosted SFU puts media on someone else's server. [ADR 0001](docs/adr/0001-sfu-on-pion-for-every-room.md) |
| Signalling | gnet with gobwas/ws | An event loop holds idle sockets cheaply. gnet carries signalling only; media and HTTP use the tools made for them. [ADR 0008](docs/adr/0008-gnet-for-signalling-only.md) |
| Page and API | `net/http` | Nothing here needs more |
| Client | React 19, Vite, TypeScript, Tailwind 4. No router, no state library | Three pages and one store per concern do not need them |

### The server, from the inside out

```
server/internal/
  domain/room        the Room aggregate: pure, no clock, no I/O
  application/       one goroutine per room (an actor) and the hub that finds them
  ports/             what the application offers and needs
  adapters/          signal (gnet), httpapi, page, sfu (Pion), github
```

Dependencies point inward. The room is a value that is told the time and answers with what changed, so every rule about presence is a plain test.

- **One goroutine per room.** Every change to a room goes through its actor, in order. There are no locks around room state.
- **State as bits.** Seats are a `uint64` bitmap; what a participant has on (microphone, camera, screen, screen audio, hand, owner, unstable) is a `uint16` of flags. A roster is small and comparing two is cheap.
- **Whole rosters, versioned.** The server sends the entire roster with a version number each time it changes, never a difference. A browser that missed one message is right again at the next.
- **The lobby reads without asking.** Each room publishes an atomic summary; listing open rooms never waits on a room's goroutine.

### No ghosts

The server is the only authority on who is present ([ADR 0003](docs/adr/0003-server-is-the-only-authority-on-presence.md)). A participant is seen through three signals: the socket, a heartbeat, and the media path. At the first missed signal the others see them as *unstable*. After a 4 second grace they are *reconnecting*; a participant who is not back is removed. Leaving on purpose is immediate. Measured with stand-in clients, the worst case from a silent loss to removal is 17 seconds (`docs/research/spikes`).

A participant who reloads keeps the same seat: the browser holds a secret per room for the tab's lifetime and presents it to resume. The secret rotates on every resume, and the old one is refused.

### The password never reaches the server

In a private room the browser derives 64 bytes from the room code with PBKDF2-SHA-256 (600,000 rounds, salted with the room's address). The first half is a verifier, sent to the server, which stores only its SHA-256. The second half is reserved as the media key and never leaves the browser ([ADR 0006](docs/adr/0006-password-never-reaches-the-server.md)). A shared link carries the code after `#`, the part of an address browsers do not send. Ten wrong attempts lock the room's door for five minutes.

### Media

Each participant holds two peer connections: one to publish, one to receive everything else. The server forwards packets without decoding them and names each forwarded stream by who sent it and what it is. The strong voice filter is RNNoise running in the browser ([ADR 0010](docs/adr/0010-strong-voice-filter-is-rnnoise-in-the-browser.md)); no audio is processed on the server.

### The computer's sound with the screen

Chrome and Edge send the whole computer's sound with a screen on Windows and on macOS 14.2 or later: choose "Entire screen" and tick "Share system audio". On Linux, Chrome sends only a tab's sound. The helper [`screen-audio.sh`](web/public/assets/screen-audio.sh), served at `/assets/screen-audio.sh`, uses `pactl` (PulseAudio or PipeWire) to add three devices:

| Device | Role |
| --- | --- |
| `Desktop-Audio` (default output) | receives the apps' sound and plays it on your speakers |
| `Desktop-Audio-Share` (input) | the same sound, which the page reads like a microphone and sends with the screen |
| `Call-Output` (output) | the call's own sound, played on your speakers but not shared, so nobody hears themselves back |

```sh
curl -fsSL https://live.versatile.sh/assets/screen-audio.sh -o ~/.local/bin/screen-audio && chmod +x ~/.local/bin/screen-audio
screen-audio on     # before sharing
screen-audio off    # gives the sound back to the original device
```

It needs `pactl` and `jq`, and no root. Firefox and Safari send no computer sound on any system.

### The whiteboard

Excalidraw, pinned and built into our bundle, loaded only when opened. The board lives in the browsers; the server relays its pieces unread and keeps nothing ([ADR 0009](docs/adr/0009-whiteboard-is-excalidraw-relayed-not-stored.md)).

## Security

- **Content security policy**: `default-src 'none'`; scripts, styles, fonts and connections only from our own origin; no inline script or style. `'wasm-unsafe-eval'` exists for the voice filter alone.
- **Limits on the signalling socket**: 64 KiB per frame, 1 MiB of unsent data, 20 frames a second with a burst of 80. A client past them is disconnected and told why.
- **Dependencies**: exact versions, lockfile committed, install scripts disabled, Dependabot on Go, npm, Docker and Actions. `govulncheck` reports nothing. `npm audit` reports one advisory, GHSA-fc5q-39xc-vjpf (ReDoS in picomatch through 4.0.7, no fixed release yet), reached only through build and test tools (vite, vitest, the Excalidraw build chain); no glob it evaluates comes from a visitor, and none of it ships to the browser or the server.
- **Image**: distroless, static, non-root, base images pinned by digest.

### What is not there yet

Stated plainly, because an open project is only as safe as what it admits:

- **Private rooms are not end-to-end encrypted yet.** Media is encrypted to the server (DTLS-SRTP) and the server could read it. Chat, private messages and the whiteboard pass through the server in clear. The design is decided ([ADR 0002](docs/adr/0002-private-rooms-are-end-to-end-encrypted.md)); the code is not written.
- **No TURN relay.** A participant on a network that blocks UDP cannot send or receive media.
- **No forwarding on demand.** The server sends every stream to everyone, including those a participant chose to hide.
- **Rooms do not survive a restart** of the server.
- Not built: transcription, recording, background blur, extensions.

## Run it

Needs Go 1.27.4 and Node 26.

```sh
cd server && PORT=8080 SIGNAL_PORT=8081 PUBLIC_ORIGIN=http://localhost:5173 go run ./cmd/live
cd web && npm ci && npm run dev        # http://localhost:5173
```

| Variable | Meaning |
| --- | --- |
| `HOST`, `PORT` | where the page and API listen |
| `SIGNAL_PORT` | where the signalling socket listens |
| `PUBLIC_ORIGIN` | origins allowed to open the socket, comma separated |
| `COUNTRY_HEADER` | request header that carries the visitor's country (`CF-IPCountry` behind Cloudflare) |
| `ADDRESS_HEADER` | request header that carries the visitor's address, used only to make a ban hold (`CF-Connecting-IP` behind Cloudflare) |
| `WEB_DIR` | built client to serve; empty serves the API only |
| `MEDIA` | `off` runs without the SFU |
| `MEDIA_UDP_PORT`, `MEDIA_PUBLIC_IP` | the one UDP port media uses and the address browsers reach it at |
| `GITHUB_REPO` | repository whose star count the front page shows |

## Test it

```sh
cd server && go vet ./... && go test -race ./...
cd web && npm test                 # behaviour of pages and stores
cd web && npm run test:live        # the client against a real server
cd web && npm run build
```

Tests assert what a person or a peer can observe: what is on the page, what goes over the socket, who is in the room after a failure.

## How decisions are recorded

- [`docs/research`](docs/research): the study the architecture came from: charter, scouting, independent proposals, measured spikes, synthesis.
- [`docs/adr`](docs/adr): one file per decision that is hard to undo, with the trade-off it settled.
- [`CONTEXT.md`](CONTEXT.md): the words of the product and what each means.
- [`web/DESIGN.md`](web/DESIGN.md): colour, type, the speech-bubble shapes and the rules for using them.

Changes reach `main` through pull requests, one concern each.
