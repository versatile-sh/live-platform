# live.versatile.sh: architecture synthesis (round 1)

Date: 2026-11-16. Decision register with ids: `round1/decisions.md` (J-01 to J-19). Proof levels: read, specified, run. Audit of 2026-11-16 (`round1/audit.md`) applied the spike results: the liveness state machine (S1), forwarding cost and TURN policy (S2) and the LiveKit DTLS gate (S3) are now **run** on local stand-ins (Go clients, Docker namespaces, no browser). Everything else is read or specified. Where this file says "observed", a source was read or a spike measured something. Where it says "proposed", it is our specification.

## 1. The answer

We observed, in source and in the specs, that mesh upload grows with every participant and that gnet cannot host TLS, WebSocket or Pion. We observed that LiveKit v1.13.11 replaces pion/dtls with `livekit/dtls v3.1.5-warp.3`, and spike S3 found the fix code of the 2026-10-16 advisories absent from that fork (run: `spikes/S3/evidence-warp3.txt`, `file-compare.txt`, `file-compare-other-advisories.txt`). Given that, the proposed architecture is one Go binary that is the only authority on rooms and presence. Every room goes through a selective forwarding unit (SFU) we write on upstream Pion v4.2.26, including rooms of 2. Signalling is one WebSocket per participant (coder/websocket), and an embedded pion/turn handles clients that cannot reach UDP. The binary runs behind the existing kamal-proxy on the versatile.sh VPS, with a React 19 + Vite SPA served from the same binary. Ghosts are removed by three detectors that feed one state machine per participant, with a bound of 21 s. Spike S1 ran the state machine against Go stand-in clients: as first specified it failed F1 (UDP-only loss looped through resume and was never removed); with one amendment, a 12 s cap on time outside ACTIVE, every case was removed within 20.34 s over 20 repetitions (run, `spikes/S1/logs/matrix-amended-cap12s`). F1 is met for Go stand-ins; browser behaviour is not run. Transcription is not on the server in v1. Room size is limited by a configured egress budget, not by a fixed number.

## 2. Architecture

### 2.1 Components (one process, `live`)

| Component | Role | Proof |
|---|---|---|
| HTTP API (net/http) | create room, lobby list, password check, then a 30 s single-use ticket, beacon leave | specified |
| Signalling (coder/websocket v1.8.15) | one socket per participant, subprotocol `lv.1` | specified |
| Room actor | one goroutine per room owns all state. Events carry `gen`, and stale events are dropped. Pushes carry `rosterVersion` | specified |
| SFU core (Pion v4.2.26) | one PeerConnection per participant. Fan-out with SSRC/seq rewrite, PLI throttle, last-N video, audio-level speaker pick | read (Pion APIs) / specified (our part) |
| ICE | UDP mux 7882, ICE-TCP mux 7881, public IP via address rewrite rules | read |
| TURN (pion/turn v5.1.3) | UDP/TCP 3478. Ephemeral REST credentials with a 600 s TTL. Peer allow-list: `PermissionHandler` receives only the peer IP (`turn@v5.1.3 server_config.go:40-48`), so it allows only the SFU's own IP; the mux port is enforced by a write filter on the relay `PacketConn` | run (S2: loopback, v4-mapped loopback, RFC 1918 and other hosts refused; non-mux port data dropped; relayed media to the mux delivered, `spikes/S2/logs/turn-ipport`) |
| Static SPA | React 19.3.1, embedded with `embed.FS` | specified |
| Data dir | `rooms.json` (room config only), TURN HMAC secret. Depends on OD-07 | specified |

### 2.2 Participant state machine (all timers owned by the room actor)

| From | Event | To | Timeout |
|---|---|---|---|
| — | WS opened | AUTH | 5 s for the first message, else close 4401 |
| AUTH | valid `join` ticket | CONNECTING | ICE must connect within 15 s (T5), else REMOVED `media-timeout` |
| AUTH | `join` to a private room without a password | LOBBY | 120 s, or the owner admits or denies |
| AUTH / SUSPECT | valid `resume{pid,secret}` | CONNECTING, `gen+1` | old socket closed 4001, old PeerConnection closed, secret rotated |
| CONNECTING | ICE + DTLS up | ACTIVE | — |
| SUSPECT / CONNECTING | 12 s since the participant first left ACTIVE without returning (amendment from S1) | REMOVED `unhealthy-cap` | — |
| ACTIVE | socket close; no frame for 12 s (server Ping every 4 s); no app `hb` for 12 s (client sends one every 4 s); ICE `failed` at 8 s | SUSPECT (shown as "reconnecting") | 8 s grace |
| SUSPECT | grace expires | REMOVED `timeout` | — |
| ACTIVE | `leave` / beacon / owner `remove` | REMOVED | immediate |
| REMOVED | any | REMOVED | terminal; pid never reused |

Published bound: a silently vanished participant leaves everyone's view within **21 s**. Run with Go stand-ins (S1 amended, 20 reps per case): kill -9 max 8.18 s, SIGSTOP 17.16 s, app `hb` stopped 18.55 s, all traffic dropped 17.14 s, UDP only dropped 20.34 s, resume after 9 s 8.18 s; clean leave 0.007 s; no duplicate roster version, no pid reuse; 1 h healthy run with 2% netem loss, 8 clients, 0 removals (`spikes/S1/logs/healthy-1h-netem2pct/analysis.json`). The spec without the 12 s cap failed the UDP-only case (`matrix-spec-as-written/dropudp`). A clean leave takes about one RTT. The client retries resume for 10.5 s, then shows "disconnected, rejoin?". It never shows an endless "connecting".

### 2.3 Room state machine

IDLE → LIVE on the first ACTIVE participant. LIVE → EMPTY on the last removal, with a 30 s timer. EMPTY → IDLE when the timer fires, which releases media resources. IDLE with no join for 24 h and unlisted → DELETED. An owner `close` → CLOSING, a 2 s flush, then DELETED. A panic or inbox overflow in the actor → CLOSING, and the process stays up.

### 2.4 Wire protocol outline (specified)

- HTTPS: `POST /api/rooms`, `GET /api/lobby?cursor=`, `POST /api/rooms/{slug}/ticket {password?}` → `{ticket, ttl:30}`, `POST /api/leave {pid, secret}`.
- WebSocket `wss://live.versatile.sh/ws`, subprotocol `lv.1`, JSON frames `{t, ...}`. Binary frames are rejected. Messages are capped at 16 KiB, with a token bucket of 20/s and a burst of 40.
- Client → server: `join`, `resume`, `hb`, `offer`, `answer`, `ice`, `leave`, `media`, `chat`, `react`, `hand`, `sub{visible}`, `owner{admit|deny|remove|transfer|close|setPassword|setListed}`.
- Server → client: `joined{pid, secret, rv, roster, turn}`, `roster{rv, full|delta}`, `offer`, `answer`, `ice`, `resumed`, `chat`, `react`, `lobby`, `error`, `bye{reason}`.
- Close codes: 4001 superseded, 4401 auth timeout, 4403 forbidden, 4404 gone, 4429 rate-limited or over capacity.

### 2.5 Deployment and ports on the one VPS

| Process | Ports | Notes |
|---|---|---|
| kamal-proxy v0.10.3 (existing) | TCP 80, 443 | TLS; routes `live.versatile.sh` to 127.0.0.1:8080 |
| `live` container, host networking | 127.0.0.1:8080; UDP 7882; TCP 7881; UDP+TCP 3478; TURN relay UDP 49160-49200 | non-root, `GOMEMLIMIT` set. Host networking is HYPOTHESIS until run, because Kamal UDP publishing is undocumented |

The DNS record for `live` is DNS-only (grey) in Cloudflare. Ports beyond 80/443 must be opened in the Contabo panel firewall.

### 2.6 Capacity (egress derived from assumed bitrates, HYPOTHESIS; CPU and RAM measured by S2)

These figures assume one 2.5 Mbps screen share, 40 kbps Opus per speaker, and camera tiles limited to 9 per viewer. Seat O's lower camera bitrates are used as the low edge and seat R's as the high edge.

| Room | SFU egress | Transfer per hour | Fits a 200 Mbit/s port? |
|---|---|---|---|
| 4 | 14-22 Mbps | 6-10 GB | yes |
| 10 | 53-79 Mbps | 24-35 GB | yes, 2-3 rooms at once |
| 30 | 119-161 Mbps | 54-72 GB | about one room |
| 100 | 400-540 Mbps | 180-244 GB | no |
| 100, audio only | about 24 Mbps | about 11 GB | yes |

S2 measured our Pion forwarding stub (run, `spikes/S2/logs/results_final.jsonl`; container `--cpus=1`, GOMAXPROCS 2, synthetic RTP, 60 s): 30 people with video (9 camera tiles each) 24,050 pkt/s out at 39.6% of one core, RSS 869 MB (28.5 MB per PeerConnection); 30 with all 29 tiles 42,050 pkt/s at 53.8%, RSS 2.1 GB; 100 audio-only (6 speakers) 29,700 pkt/s at 44%, RSS 101 MB. Delivery ratio 1.0, actor inbox max 0. With GOMEMLIMIT 512 MiB the video-30 RSS fell to about 590 MB but CPU was throttled in 466 of 613 periods (`logs/video30-gml512MiB/summary.txt`). So RAM per video PeerConnection, not CPU, is the first host limit observed; the per-PC memory of the stub is unexplained and must be profiled before OD-04. Port speed is the network limit: Contabo lists 200 Mbit/s to 1 Gbit/s ports and "fair usage" throttling without a figure (https://contabo.com/en/vps/, accessed 2026-11-16, high, vendor page). The earlier "100 Mbit/s average over 10 days" figure is not on that page: HYPOTHESIS.

## 3. Dependencies (versions as checked by the seats on 2026-11-16 via the GitHub API, npm and OSV)

| Component | Version (date) | Licence | Redistribute and host | Advisory state |
|---|---|---|---|---|
| Go toolchain | 1.27.4 (2026-11-10) | BSD-3-Clause | yes | pin the version and rebuild on each minor |
| pion/webrtc/v4 | 4.2.26 (2026-10-28) | MIT | yes | none known; resolves dtls 3.1.15 |
| pion/dtls/v3 | 3.1.15 (2026-10-20) | MIT | yes | six advisories published 2026-10-16: GHSA-7c2r-jhm9-43vf, -jm57-r6vj-mwg9, -jp25-wc3w-p9xp, -qpgj-64qg-5m4r fixed in 3.1.13; GHSA-hhpj-h56m-9f2p (critical) and GHSA-cqhp-ggp7-58qj fixed in 3.1.14 (`spikes/S3/advisories.txt`, GitHub repo advisories). OSV none for 3.1.15 |
| pion/ice/v4 | 4.4.9 (2026-11-09) | MIT | yes | OSV none. S1/S2 ran with 4.4.8 |
| pion/interceptor | 0.1.51 (2026-10-23) | MIT | yes | CVE-2025-49140 fixed in 0.1.39 |
| pion/rtp | 1.10.6 (2026-10-21) | MIT | yes | none listed |
| pion/turn/v5 | 5.1.3 (2026-10-24) | MIT | yes | none known |
| pion/stun/v4 | 4.0.1 (2026-09-15) | MIT | yes | OSV none for v4.0.1; GHSA-34rh-wp3j-6cxc lists only older module paths (fixed 3.1.5) (OSV API, 2026-11-16, high) |
| coder/websocket | 1.8.15 (2026-06-15) | ISC | yes | OSV none |
| golang.org/x/crypto | 0.59.0 (2026-11-11) | BSD-3-Clause | yes | OSV none for 0.59.0 |
| golang.org/x/net (transitive, via Pion) | pin ≥ 0.62.0 (2026-10-27) | BSD-3-Clause | yes | govulncheck flagged v0.50.0 (S1/S2) and v0.59.0 (S3) for GO-2026-5942, -6603, -6610/6611/6612, -6617, -6860, -6866; 0.62.0 OSV none |
| kamal-proxy | 0.10.3 (2026-11-16) | MIT | yes | OSV none |
| react, react-dom | 19.3.1 (2026-10-14) | MIT | yes | the RSC advisories do not apply to a client-only SPA |
| vite (build only) | 8.3.8 (2026-11-11) | MIT | yes | dev-server advisories fixed by 8.3.7; dev server never exposed |
| @vitejs/plugin-react | 6.3.0 | MIT | yes | not queried (to be added to CI) |
| typescript | 7.0.2 | Apache-2.0 | yes | not queried |
| @sapphi-red/web-noise-suppressor (opt-in) | 0.4.1 (2026-09-19) | MIT; no runtime deps; bundled WASM from dev packages @shiguredo/rnnoise-wasm 2025.1.5 (Apache-2.0), @sapphi-red/speex-preprocess-wasm 0.4.0 (MIT), @sapphi-red/gtcrn-wasm 0.0.3 (MIT) per npm metadata; upstream C library licences not read | conditional (attribution and NOTICE for Apache-2.0) | OSV none |
| govulncheck (CI) | golang.org/x/vuln v1.9.0 (2026-10-11) | BSD-3-Clause | yes | — . govulncheck does not match forks under another module path (it did not flag `livekit/dtls`, S3) |

OSV was observed to lag GitHub Advisory data for pion/dtls (`scout/topology §4`), so CI must query both.
Not adopted: gnet, LiveKit (pending OD-01), coturn, gorilla/websocket, MaxMind GeoLite2, Next.js, quic-go/webtransport-go.

## 4. Owner decisions

| Id | Title | Question | Options | Recommendation | What the choice changes |
|---|---|---|---|---|---|
| OD-01 | SFU source | Write our own SFU core on Pion, or run LiveKit? | (a) own core on Pion; (b) LiveKit 1.13.11 as a process: **closed by S3** (fork lacks the fixes) until LiveKit ships a fork that carries them | (a) | (a): we own presence and F1 end to end, with more engineering (simulcast later). (b): less code and mature simulcast, but presence is split between two processes and the project depends on forked Pion |
| OD-02 | Transcription hosting | Host transcription on our VPS? | (a) off in v1; (b) in-browser opt-in, each speaker transcribes themselves; (c) server: sherpa-onnx + Parakeet v3 in a separate capped process | (b) for v1; (c) only after an RTF measurement on the VPS | (c) costs an estimated 0.06-0.65 core per continuous speaker (derived, HYPOTHESIS), about 2 GB RAM, cgo, and the server processing plaintext speech |
| OD-03 | Lobby country | Where does the country come from? | owner picks it; DB-IP Lite lookup (CC BY 4.0, attribution, monthly refresh) | owner picks it | the lookup adds IP processing and a refresh job |
| OD-04 | Room cap | Default per-room cap and global egress budget? | 25 / 150 / none, plus a budget | 50 per room, budget = 80% of the VPS port, configurable | sets when joins are refused with 4429 |
| OD-05 | F1 wording | Does a labelled "reconnecting" tile during an 8 s grace count as a ghost? | yes (removal on the first detection, ~13 s); no (21 s with resume) | no | a shorter bound, at the cost of losing seamless resume on Wi-Fi switches |
| OD-06 | Exposure | Accept that the VPS IP becomes public without Cloudflare? Add TURN-TLS (cert sharing with kamal-proxy)? | accept + defer TURN-TLS; second IP | accept and defer | DoS exposure of versatile.sh, which shares the IP |
| OD-07 | Restart behaviour | Do rooms survive a deploy? | atomic file; memory only | atomic file | memory only: links and owner secrets die on each deploy |
| OD-08 | Parity scope | Which parity items wait? | full parity (PR6); call, room and owner features first | call, room and owner features first; 4K and relay-only capped by the operator | build size and egress |

## 5. Deferred, each with an observable trigger

| Item | Trigger |
|---|---|
| Simulcast / SVC | rooms of more than 10 with cameras in weekly use, or quality complaints from viewers |
| Server transcription | OD-02 = (c), and a measured RTF ≤ 0.1 per stream on the VPS |
| TURN-TLS on 443 | more than 2% of joins fail ICE (measured with getStats), or a second IP |
| Zero-downtime media deploy | calls dropped by deploys more than once a week |
| Recording, whiteboard, effects, extensions | owner order after the core ships |
| E2EE (SFrame) | the owner adds a malicious server to the threat model |
| Multiple processes or VPSes | egress above 80% of the budget for a week |
| WebTransport | kamal-proxy enables HTTP/3, and Safari share above 26.4 is sufficient |

## 6. Spikes (local Linux, Go 1.27, Node 26, Docker; no cloud; no local browser)

1. **S1: F1 kill matrix (charter floor F1).** Build a stub `live` with the J-05/J-06 state machine on Pion 4.2.26 + coder/websocket 1.8.15. Go clients act as pion/webrtc stand-ins for browsers, one per network namespace. Cases:
   - clean leave;
   - **abrupt death**: `kill -9` of the client;
   - **frozen client**: (a) `SIGSTOP` of the whole client; (b) a mode where the socket keeps answering protocol Pongs and media keeps flowing but the app `hb` stops, to simulate a frozen page;
   - `iptables DROP` in both directions;
   - UDP only dropped;
   - resume at 3 s and at 9 s.

   Measure the time from the event to the `roster` removal received by the other clients, over 20 repetitions per case. Pass: every case ≤ 21 s, no pid duplicated in any roster version, and no false removals in a 1 h healthy run with 2% netem loss. This raises J-06 to **run**. It does not test real browser throttling: that stays a HYPOTHESIS.
2. **S2: forwarding cost and TURN policy.** A synthetic room of 30 with video, and one of 100 with audio only, through the UDP mux in a container limited to 1 CPU: measure CPU, RSS per PeerConnection, pkt/s and actor inbox depth. Then have a TURN client try permissions to 127.0.0.1, ::ffff:127.0.0.1, 10.0.0.1 and a non-mux port: all must be refused, while relayed media to the mux must work. This raises J-08, J-17 and J-19 to **run**.
3. **S3: LiveKit DTLS gate (decides OD-01 (b)).** Diff `livekit/dtls v3.1.5-warp.3` against the pion/dtls v3.1.13 fixes for GHSA-7c2r-jhm9-43vf, GHSA-jm57-r6vj-mwg9 and GHSA-jp25-wc3w-p9xp, and run `govulncheck` on a livekit-server v1.13.11 build. Pass: all three fixes present. Fail: OD-01 (b) is closed.

Spike state (audit 2026-11-16): S1 ran, passes only with the 12 s cap amendment. S2 ran; TURN policy passes with IP handler plus port write filter; capacity numbers above. S3 ran: fail, OD-01 (b) closed.

## 7. What this does not claim

- F1 is met only for Go stand-in clients in local network namespaces, with the 12 s cap amendment. No browser was killed or frozen.
- No browser behaviour (tab throttling, bfcache, Safari interop) was run. The Go stand-in clients in S1 do not prove it.
- The egress table is arithmetic from assumed bitrates. CPU and RAM come from a synthetic stub (S2), not the product SFU.
- The VPS plan, port speed and firewall state are unknown (PR7). The Contabo throttle threshold is not published.
- S3 showed the fix code absent from `livekit/dtls v3.1.5-warp.3`; exploitability in LiveKit's configuration was not tested.
- No noise-suppression quality claim is made. No independent data exists.
- Transcription cost figures are derived from third-party benchmarks on unknown hardware.
