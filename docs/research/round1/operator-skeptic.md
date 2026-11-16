# Round 1 seat: operator and simplicity skeptic

Date: 2026-11-16. Seat: operator-skeptic (charter §10). Inputs: `CHARTER.md`, `scout/{topology,transport,liveness,security,audio}.md`, the reference README feature list. Other round-1 files were not read.

Conventions. Proof level: **read** (source/doc read), **specified** (a standard says so), **run** (executed). This seat ran no media or liveness experiment: only GitHub API and OSV queries (marked "run (API)"). Anything without evidence is marked HYPOTHESIS. "scout/x §n" cites the scout file, which carries the primary evidence; I re-verified versions on 2026-11-16 where marked "re-checked".

## 0. Stance in one paragraph

The cheapest system that meets F1-F6 is: **one small Go binary we write (rooms, passwords, lobby, admission, owner actions) plus one unmodified LiveKit server binary we do not write (SFU, signalling for media, presence, TURN)**, behind the existing kamal-proxy, with a static React SPA served by the Go binary. No database, no Redis, no coturn, no gnet, no mesh, no server transcription in v1. The whole design is gated on one spike (S1): the LiveKit DTLS fork must carry the Pion DTLS 3.1.13 fixes, otherwise F4 fails and the fallback is a single-layer Pion SFU that we own (D-01b).

## 1. Decisions

### D-01 Media topology

| Field | Content |
|---|---|
| Options | (a) full mesh (PR4); (b) hybrid mesh-small / SFU-large; (c) SFU only; (d) MCU; (e) media over plain WebSocket (PR4) |
| Choice | (c) SFU only, every room size, including 2 people |
| Why | Mesh upload grows N-1 per sender: a 5 Mbps screen to 9 viewers is 45 Mbps uplink (scout/topology §2), which most home uplinks do not have. Hybrid needs the SFU anyway for large rooms and adds a second media path and a switchover (scout/topology §1.9): two code paths for one result. One path is cheaper to keep alive than two even if 2-person rooms cost the VPS some egress. Mesh also has no server authority over presence (F2). MCU decodes/encodes per participant: CPU the VPS does not have, no maintained OSS candidate (scout/topology §10). Media over WebSocket loses congestion control, jitter handling and hardware decode paths of WebRTC and runs over TCP (head-of-line blocking): HYPOTHESIS, no measurement read; rejected on the ground that nothing in the scout supports it and WebRTC is the browser's only real-time media API |
| Proof | specified (RFC 7667 §3.4, §3.7) + arithmetic |
| Evidence | RFC 7667 (Nov 2015) §3.4, §3.7, §3.12; scout/topology §2-3 |
| Cost to operator | All media egress passes through the VPS (section 4). This is the main cost and the reason PR1 needs a cap |
| Reopens it | Owner states privacy (no server sees media) as a requirement, or measured egress for 2-person rooms exceeds the Contabo fair-use average (100 Mbit/s for 10 days, section 4) |

### D-01b SFU implementation (the main operator decision)

| Field | Content |
|---|---|
| Options | (a) LiveKit server 1.13.11 as a separate unmodified process; (b) LiveKit embedded via `service.InitializeServer`; (c) own SFU on Pion v4.2.26; (d) Galene 1.2.2 as a process; (e) mediasoup 3.32.2 (C++/Node); (f) Janus 1.4.3 (GPL-3.0); (g) Jitsi Videobridge (JVM + Prosody + Jicofo) |
| Choice | (a) LiveKit as a separate process, **conditional on spike S1**. Fallback if S1 fails: (c) a deliberately small Pion SFU: single layer, no simulcast, no SVC, no own BWE beyond Pion defaults |
| Why | The rows LiveKit gives and Pion does not (fan-out with SSRC/seq rewriting, simulcast switching, dynacast, active speaker, reconnect/resume, presence, TURN) are what a small team cannot write and test across Chrome, Firefox and Safari (scout/topology §9). LiveKit is Go (F6), Apache-2.0, one binary, Redis optional, built-in TURN. Separate process, not embedded: upgrades are a binary swap, our go.mod does not inherit 154 modules and three forks (scout/topology §9), and LiveKit's own signalling owns presence, so F2 has one authority. (d) Galene is smaller (≈309 KB Go) and MIT, but it is an application with its own UI and protocol; its packages are not a stable library (scout/topology §1.6, HYPOTHESIS on stability). (e)(g) add Node or JVM runtimes. (f) GPL-3.0 needs a legal read and is C |
| Proof | read |
| Evidence | `livekit/livekit@v1.13.11 go.mod`, `pkg/service/wire.go:49`, `config-sample.yaml:95-160` (scout/topology §4, §9); releases re-checked via GitHub API 2026-11-16: livekit v1.13.11 (2026-10-25), pion/webrtc v4.2.26 stable, v5.0.0-rc.3 (2026-11-10) pre-release |
| Cost | One extra process (RAM: HYPOTHESIS, not measured; spike S2), one YAML config, one API key/secret pair generated at install. Lock-in to LiveKit's signalling and `livekit-client`. Risk: LiveKit pins `livekit/dtls v3.1.5-warp.3`, a fork based below 3.1.13; whether it carries the 2026-10-16 Pion DTLS fixes (GHSA-7c2r-jhm9-43vf critical, GHSA-jm57-r6vj-mwg9, GHSA-jp25-wc3w-p9xp) is not verified (scout/topology §4 notes) |
| Reopens it | S1 shows the fork lacks the fixes and LiveKit has no release within the audit window → fallback (c). LiveKit relicenses away from Apache-2.0. LiveKit RAM per idle room on the VPS above what the owner accepts |

### D-02 Backend networking: gnet vs net/http (PR3)

| Field | Content |
|---|---|
| Options | (a) gnet v2.10.0; (b) net/http + coder/websocket v1.8.15; (c) net/http + lxzan/gws v1.10.2; (d) gorilla v1.5.3; (e) gobwas/ws v1.5.0 |
| Choice | (b) net/http. Our binary needs little WebSocket at all (D-03): only one optional socket per waiting knock request. coder/websocket because it checks Origin by default and has a read limit by default |
| Why | gnet has no TLS, HTTP or WebSocket and its deadlines return `ErrUnsupportedOp`; Pion needs `net.PacketConn`/`net.Listener` which gnet does not provide (scout/transport §3). The memory gap matters only near 10,000 sockets (≈230 MB worst variant, scout/transport §4.1, run by the scout). kamal-proxy already pays a net/http goroutine per connection in front (scout/transport §1.4). PR3 is overturned by its own stated condition |
| Proof | read (gnet source) + run (scout memory table) |
| Evidence | `gnet@v2.10.0 connection_unix.go:554-560`, README roadmap; coder/websocket@v1.8.15 `accept.go:30-53`, `read.go:88-97` (scout/security §3) |
| Cost | Zero extra components; stdlib only plus one ISC library |
| Reopens it | A measured need for >10,000 concurrent idle sockets on one VPS |

### D-03 Signalling transport

| Field | Content |
|---|---|
| Options | WebSocket, WebTransport, SSE+POST, plain HTTP |
| Choice | Media signalling: LiveKit's own WebSocket (comes with D-01b). Our app: plain HTTPS JSON requests; one WebSocket only while a guest waits for owner approval in a private room |
| Why | WebTransport needs Safari 26.4+, UDP 443 and HTTP/3 through kamal-proxy, which is off by default (scout/transport §4.4). Our own state changes are rare (create, join, kick, lock) and fit request/response |
| Proof | read |
| Evidence | MDN BCD `api/WebTransport.json` (scout/transport §4.4); kamal-proxy `run.go:32` |
| Cost | none |
| Reopens it | Fallback (c) of D-01b: then our binary carries signalling over one WebSocket per participant (protocol in section 3.2) |

### D-04 Liveness and ghost removal (F1)

| Field | Content |
|---|---|
| Options | (a) LiveKit's model (signal ping 5 s / 15 s timeout; ICE disconnected 10 s + failed 5 s; 5 s cleanup); (b) our own WebSocket read deadline; (c) beacon on unload; (d) RTCP inactivity timer |
| Choice | (a), unchanged defaults, plus the client calling `room.disconnect()` on `pagehide` (best effort). Stated bound for F1: **a participant who vanishes silently leaves everyone's view within 20 s; a clean close within 1 s**. Both are HYPOTHESIS until spike S3 runs them |
| Why | LiveKit cut its ghost window from 50 s to 20 s after user reports (PR #2077); every ghost report in the scout is a grace window or a rejoin race (scout/liveness short answer 6-7). Using the stock values means we do not own timer code. Rejoin race: LiveKit identity = our participant id; a rejoin with the same identity replaces the old session (HYPOTHESIS from LiveKit docs behaviour "duplicate identity"; not read in source, verified in S3) |
| Proof | read (code), not run. F1 requires run: S3 |
| Evidence | `livekit@80cfa6e pkg/rtc/transport.go:82-85`, `participant.go:80,1098-1103,2844-2877`; client-sdk-js `SignalClient.ts:694-700` (scout/liveness §3.1); RFC 7675 §5.1 30 s ceiling |
| Cost | none extra |
| Reopens it | S3 measures a bound above 20 s for any of: tab close, kill -9 of the browser, network unplug, laptop sleep |

### D-05 Reconnection

| Field | Content |
|---|---|
| Options | LiveKit resume + full reconnect (default policy ≈44 s of retries); own policy |
| Choice | LiveKit default. After the client gives up, the page shows "disconnected, rejoin" and rejoins through our `/join` with the stored per-tab participant id and rejoin secret (D-07) |
| Why | No code to own; the server-side ghost bound (20 s) is independent of the client retry length |
| Proof | read (`DefaultReconnectPolicy.ts:3-40`, scout/liveness §3.1) |
| Cost | none |
| Reopens it | S3 shows the client keeps a stale tile while the server has removed it |

### D-06 ICE/TURN on one VPS

| Field | Content |
|---|---|
| Options | (a) LiveKit built-in TURN; (b) coturn 4.19.1 process; (c) pion/turn v5.1.3 embedded in our binary; (d) no TURN, ICE-TCP only |
| Choice | Single UDP mux port 7882 + ICE-TCP 7881 + LiveKit built-in TURN on UDP 3478. TURN/TLS deferred (section 6) |
| Why | With an SFU on a public IP, the server is always reachable, so relay need is lower than for P2P (one source: ≈4 % of SFU calls vs ≈17.7 % P2P, low confidence, scout/transport §5.6). coturn adds a C process with 22 advisories, two without a recorded fix (scout/transport §2). TURN/TLS on 443 collides with kamal-proxy on the same IP (scout/transport §5.5) |
| Proof | read |
| Evidence | LiveKit ports table (docs.livekit.io/transport/self-hosting/ports-firewall, accessed 2026-11-16, high, vendor); scout/transport §5 |
| Cost | Three ports opened in the Contabo panel firewall; no extra process |
| Reopens it | getStats measurement: > 2 % of joins fail ICE from networks that allow only TCP 443 |

### D-07 Security model

| Field | Content |
|---|---|
| Options | password hash: Argon2id, scrypt, bcrypt; owner: account vs capability secret; tokens: JWT vs opaque |
| Choice | Room password: **server-generated** 8-char a-zA-Z0-9 (47.6 bits) by default, owner may set own; stored in memory as Argon2id m=19456 KiB t=2 p=1 (`golang.org/x/crypto/argon2`); global semaphore of 2 concurrent verifies; 10 failures/hour/room and 30/hour/IP. Owner: 128-bit capability secret returned once at creation, kept in the owner's localStorage, stored hashed (SHA-256 is enough for a 128-bit random value; HYPOTHESIS, reasoning). Per participant: 128-bit rejoin secret. Media access: LiveKit JWT minted by our binary after the check, TTL 60 s for the join, `roomJoin` grant for one room, `canPublish` per room policy. Origin check on every endpoint; Content-Security-Policy with `connect-src` limited to the host |
| Why | Everything in memory: rooms die when empty or on restart; nothing to back up, nothing to leak at rest. A restart drops all calls (cost accepted, section 7) |
| Proof | read (OWASP parameters), HYPOTHESIS for the token design |
| Evidence | OWASP Password Storage Cheat Sheet (accessed 2026-11-16, high); scout/security §1-3; x/crypto v0.59.0 (tag commit 2026-11-11, BSD-3-Clause), OSV query for 0.59.0 returned no vulns (run (API), 2026-11-16) |
| Cost | 19 MiB × 2 = 38 MiB peak for hashing; no DB |
| Reopens it | Owner wants rooms that survive restarts (then: one SQLite file, not a server DB) |

### D-08 Lobby and country

| Field | Content |
|---|---|
| Options | (a) CF-IPCountry (gone once out of the tunnel); (b) DB-IP Lite CC BY 4.0 + MMDB reader; (c) MaxMind GeoLite2 (EULA blocks bundling); (d) the owner picks the country from a list when creating a public room |
| Choice | (d). Lobby lists only rooms the owner marked public: name, owner-chosen country, participant count, locked flag. Cached 5 s; 50 rooms per page |
| Why | Zero dependency, zero monthly DB refresh job, no IP processing (GDPR recital 30), no attribution UI. Geo-IP is wrong for VPN users anyway (HYPOTHESIS) |
| Proof | read (licences, scout/security §7) |
| Cost | none |
| Reopens it | Owner requires automatic country. Then (b), DB-IP Lite with the attribution link, fetched by the operator at deploy, never committed |

### D-09 Frontend stack

| Field | Content |
|---|---|
| Options | Next.js 16.4.6; React 19.3.1 + Vite 8.3.8 SPA; plus `@livekit/components-react` or not |
| Choice | React 19.3.1 + Vite 8.3.8, static build embedded in the Go binary (`embed`). `livekit-client` 2.24.1 only, no component library. pnpm 12.21.0 with lockfile, exact versions, `minimumReleaseAge` 7 days, builds allow-listed; target ≤ 15 direct runtime dependencies |
| Why | All 2025-2026 React critical advisories hit `react-server-dom-*` only; an SPA ships none (scout/security §8). Next.js adds a Node server process and its own RCE stream. Vite advisories are dev-server only. Fewer npm packages = smaller worm surface |
| Proof | read; versions re-checked via GitHub API 2026-11-16: react v19.3.1 (2026-10-14, MIT), vite v8.3.8 (2026-11-11, MIT); OSV for `vite@8.3.8`, `react-dom@19.3.1`: none (run (API)) |
| Cost | Node only at build time, not at run time |
| Reopens it | A feature that needs server rendering (none in scope) |

### D-10 System audio capture

| Choice | Chromium `getDisplayMedia({audio:true, systemAudio:'include', restrictOwnAudio:true})` on Windows and macOS ≥ 14.2. Linux: documented helper of one `pactl load-module module-remap-source` line (option B, scout/audio §1.3), picked as a microphone with processing off; headphones advised where `restrictOwnAudio` is absent. Firefox/Safari: no system audio, shown in UI |
|---|---|
| Why | Smallest helper that works with Chrome's hiding of monitor sources (`audio_manager_pulse.cc:396`) |
| Proof | read (Chromium M160 source, scout/audio §1.2); not run |
| Cost | none on server |
| Reopens | Chrome enables `PulseaudioLoopbackForScreenShare` by default |

### D-11 Noise suppression

| Choice | Browser built-in `noiseSuppression` by default (zero bytes). Opt-in RNNoise via `@sapphi-red/web-noise-suppressor` 0.4.1 (MIT; RNNoise BSD-3), loaded lazily. Do not port DTLN/DeepFilterNet in v1 |
|---|---|
| Why | No independent quality data for any browser denoiser (scout/audio §2); the cheapest thing first, measure complaints |
| Proof | read; versions per scout/audio §2 (npm 2026-09-19) |
| Cost | none on server; ≈ one AudioWorklet per sender |
| Reopens | Owner listening test rates built-in + RNNoise as poor |

### D-12 Transcription placement (PR5)

| Choice | **Not on the server in v1.** If the owner wants it in v1: in the browser of the person who starts it, transformers.js 4.3.2 (Apache-2.0) with Whisper weights (MIT) self-hosted by our binary (not fetched from Hugging Face, F5), WASM fallback where WebGPU is absent |
|---|---|
| Why | Server cost ≈1 core per continuously speaking stream for Whisper small int8 (DERIVED, scout/audio §3.2); one 10-person meeting can take a 4-vCPU shared VPS. Parakeet v3 is cheaper (0.06-0.65 core, unknown hardware) but needs cgo + onnxruntime, breaking the pure-Go binary. Server-side also needs Opus decode (`pion/opus` v0.1.0 has an open divergence issue) |
| Proof | read + DERIVED arithmetic |
| Cost | none on server; weights served once per client (≈ tens to hundreds of MB, HYPOTHESIS per model size) |
| Reopens | S-deferred spike: Parakeet v3 int8 RTF measured on the VPS ≤ 0.1 per stream, and owner approves hosting |

## 2. State machines

### 2.1 Room (our binary, in memory)

| From | Event | To | Timeout |
|---|---|---|---|
| — | `POST /api/rooms` | `Reserved` | becomes `Closed` if nobody joins in 10 min |
| Reserved | first participant `Active` (LiveKit webhook `participant_joined`) | `Live` | — |
| Live | last participant left (webhook `participant_left`, count 0) | `Empty` | LiveKit `departure_timeout` 20 s |
| Empty | a participant joins | `Live` | — |
| Empty | 20 s elapse (webhook `room_finished`) | `Closed` | — |
| any | owner `DELETE` with owner secret | `Closed` (LiveKit `DeleteRoom`) | immediate |
| any | process restart | gone | — (accepted, D-07) |
| Closed | — | slug free after 10 min (avoid reuse by a stranger mid-rejoin) | 10 min |

Source of the LiveKit timers: `config.go:658-659`, `room.go:766-800` (scout/liveness §3.1), read. Webhook delivery and ordering: HYPOTHESIS; as a guard our binary also reconciles with `ListParticipants` every 30 s.

### 2.2 Participant

| From | Event | To | Timeout |
|---|---|---|---|
| — | `POST /join` (password ok or public) | `Admitted` (token issued) | token valid 60 s; discarded if unused |
| — | `POST /join` on private room | `Knocking` (WebSocket open to us) | 120 s then `Denied`; socket ping 10 s / read deadline 25 s |
| Knocking | owner approves / denies | `Admitted` / `Denied` | — |
| Admitted | LiveKit signal connect | `Joining` (LK JOINING/JOINED) | LiveKit `JoinTimeout` 60 s if ICE never connects; signal close before ICE → removed at once (`participant.go:1098-1103`) |
| Joining | ICE+DTLS up | `Active` | — |
| Active | clean `disconnect()` / tab close | `Left` | ≈1 s (HYPOTHESIS, S3) |
| Active | ICE disconnected | `Resuming` | 10 s disconnected + 5 s failed |
| Resuming | ICE restart succeeds | `Active` | — |
| Resuming | no resume | `Left` | +5 s cleanup → ≈20 s total |
| Active | signal ping missed | client closes signal, starts resume | 15 s |
| any | owner kick (`RemoveParticipant`) | `Removed`; rejoin secret revoked | immediate |
| Left | `/join` with same participant id + rejoin secret | `Admitted` (same identity replaces any ghost) | rejoin secret valid 10 min |

### 2.3 Gap a reviewer should probe

The 60 s `JoinTimeout` is the longest tile-visible window: a participant who got signal but never ICE. LiveKit does not show a participant to others before `JOINED`? HYPOTHESIS; S3 checks whether such a tile is visible and for how long.

## 3. Wire protocol outline

### 3.1 With LiveKit (chosen path)

Our HTTP API (JSON, same origin, Origin checked, body limit 4 KiB):

| Method path | Body → Response |
|---|---|
| `POST /api/rooms` | `{name, public, country?, password? , privacy:"open"\|"knock"}` → `{slug, ownerSecret, password?}` |
| `GET /api/lobby?cursor=` | → `[{slug,name,country,count,locked}]` |
| `POST /api/rooms/{slug}/join` | `{displayName, password?, participantId?, rejoinSecret?}` → `{lkUrl, token, participantId, rejoinSecret}` or `{knock:true, wsUrl}` |
| `GET /api/rooms/{slug}/knock` (WebSocket) | server → `{type:"approved", token,...}` / `{type:"denied"}`; client sends nothing |
| `POST /api/rooms/{slug}/owner` | header `Authorization: Owner <secret>`; `{op:"kick"\|"approve"\|"deny"\|"lock"\|"transfer"\|"close", target?}` |
| `POST /lk/webhook` | LiveKit webhooks, signed with the API secret (LiveKit's own scheme; read in docs, HYPOTHESIS on details) |

In-room messages (chat, raised hand, reactions, layout hints) go as LiveKit reliable data packets; room settings visible to all go in LiveKit room metadata written only by our binary. Our binary relays knock requests to the owner by `SendData` to the owner's identity.

### 3.2 Fallback (own Pion SFU, if S1 fails)

One WebSocket `/ws?slug=` per participant, JSON frames `{t, id, ...}`: `join`, `joined{you, peers, rejoinSecret}`, `peer-joined`, `peer-left{reason}`, `offer`/`answer`/`ice` (server-initiated renegotiation on track add/remove), `chat`, `state{mic,cam,screen,hand}`, `owner{op}`, `ping`/`pong` app-level not needed (server RFC 6455 Ping every 5 s, read deadline 15 s). Removal on read deadline OR Pion `PeerConnectionStateFailed` (5 s disconnected + 25 s failed by default, set via `SetICETimeouts(10s, 5s, 2s)`), whichever first.

## 4. Deployment on one VPS

| Process | Listens | Notes |
|---|---|---|
| kamal-proxy (existing) | TCP 80, 443 | TLS for `live.versatile.sh`; DNS-only (grey) record in Cloudflare (scout/transport §5.5) |
| `live` (our Go binary, container) | 127.0.0.1:8080 HTTP | serves SPA, API, and reverse-proxies `/rtc` to LiveKit 127.0.0.1:7880 (stdlib `httputil.ReverseProxy`, carries WebSocket upgrade) so only one HTTP target sits behind kamal-proxy |
| `livekit-server` 1.13.11 (container, `network_mode: host`) | 127.0.0.1:7880 (signal, behind us), UDP 7882 (ICE mux), TCP 7881 (ICE-TCP), UDP 3478 (TURN/STUN) | `rtc.use_external_ip` or `node_ip` set to the public IP; no Redis |

Open in the Contabo firewall: UDP 7882, TCP 7881, UDP 3478. Self-hoster form: one `compose.yaml` with two services and one generated `.env` (API key/secret). Kamal publishing UDP for an accessory is undocumented (scout/transport §5.4); host networking for the LiveKit accessory is HYPOTHESIS until S2.

## 5. Capacity arithmetic

Assumptions (HYPOTHESIS, stated so the judge can swap them): one screen at 1080p15 2.5 Mbps (LiveKit preset, scout/topology §2); Opus 40 kbps per unmuted speaker; cameras: ≤ 4 people all cameras 500 kbps mid layer; 10 people 300 kbps; 30 and 100 people only 9 tiles visible at 150 kbps low layer (dynacast pauses the rest); unmuted speakers ≤ 5 in rooms ≥ 30. Packet size ≈ 1,100 bytes. CPU from LiveKit's meeting benchmark ≈ 47.7k pkt/s per core at 85 % (vendor, scout/topology §5).

| Room | Screen egress | Camera egress | Audio egress | Total egress | pkt/s out | Cores (est.) | 1 h transfer |
|---|---|---|---|---|---|---|---|
| 4 | 3 × 2.5 = 7.5 | 4×3×0.5 = 6 | 4×3×0.04 = 0.5 | ≈ 14 Mbps | ≈ 1.6k | < 0.1 | ≈ 6 GB |
| 10 | 9 × 2.5 = 22.5 | 10×9×0.3 = 27 | 10×9×0.04 = 3.6 | ≈ 53 Mbps | ≈ 6k | ≈ 0.15 | ≈ 24 GB |
| 30 | 29 × 2.5 = 72.5 | 30×9×0.15 = 40.5 | 5×29×0.04 = 5.8 | ≈ 119 Mbps | ≈ 13.5k | ≈ 0.3 | ≈ 54 GB |
| 100 | 99 × 2.5 = 247.5 | 100×9×0.15 = 135 | 5×99×0.04 = 19.8 | ≈ 402 Mbps | ≈ 46k | ≈ 1 | ≈ 181 GB |

Contabo limits (https://contabo.com/vps, accessed 2026-11-16, medium confidence, vendor page summarised by search; the pricing page says "Unlimited Traffic*"): port 200 Mbit/s on entry tiers to 1 Gbit/s on top tiers; 32 TB outbound per month; throttled to 100 Mbit/s if the average exceeds 100 Mbit/s for 10 consecutive days. Consequences (derived): on a 200 Mbit/s port a single 100-person room with a screen does not fit, and it competes with versatile.sh itself; two concurrent 30-person rooms fill it. CPU is not the limit; the port is. Proposed caps for v1: **25 participants per room, 200 Mbit/s total SFU egress budget enforced by refusing new joins** (our binary sums per-room estimates; LiveKit `limit.num_tracks`/room `max_participants` set too). Signalling and our binary RAM are negligible below 10,000 sockets (scout/transport §4.1).

## 6. Dependencies

| Component | Version, date | Licence | Redistribute + host | Advisory state (2026-11-16) |
|---|---|---|---|---|
| Go toolchain | 1.27.4 (2026-11-10) | BSD-3 | yes | pin toolchain; rebuild per minor (scout/security §9) |
| coder/websocket | v1.8.15 (2026-06-15) | ISC | yes | OSV none (run (API)) |
| golang.org/x/crypto | v0.59.0 (2026-11-11) | BSD-3 | yes | OSV none for 0.59.0 (run (API)) |
| livekit/server-sdk-go (token mint + RoomService client) | version not checked: HYPOTHESIS, verify in S2 | Apache-2.0 (HYPOTHESIS, same org) | yes | not checked |
| livekit-server | v1.13.11 (2026-10-25) | Apache-2.0 | yes | no repo advisory; DTLS fork status unknown → S1 |
| livekit-client | 2.24.1 (2026-11-14) | Apache-2.0 | yes | not queried by scout |
| react, react-dom | 19.3.1 (2026-10-14) | MIT | yes | OSV none for react-dom 19.3.1 (run (API)); RSC advisories do not apply |
| vite (build only) | 8.3.8 (2026-11-11) | MIT | yes | OSV none; dev server never exposed |
| pnpm (build only) | 12.21.0 (2026-11-13) | MIT | yes | per scout/security §8 |
| @sapphi-red/web-noise-suppressor (lazy, opt-in) | 0.4.1 (2026-09-19) | MIT; wraps RNNoise BSD-3 | yes | OSV none (scout/audio) |
| Fallback only: pion/webrtc v4.2.26 (2026-10-28) → dtls v3.1.15 | MIT | yes | dtls fixes included (≥ 3.1.13) |

Not adopted: gnet, gorilla (no release since 2024-06), coturn, Redis, any DB, Next.js, GeoIP DB, any server ML runtime.

## 7. Deferred, with triggers

| Item | Trigger to build it |
|---|---|
| TURN/TLS on 443 (second IP or SNI demux) | > 2 % ICE failures from TCP-443-only networks in getStats |
| Server transcription | owner approves and S-deferred RTF ≤ 0.1 per stream on the VPS |
| Recording | owner asks; browser-local recording first (no server disk) |
| Whiteboard (Excalidraw) | owner orders after core ships; data channel only |
| Camera effects (blur, virtual background) | after core; browser-only, no server cost |
| Extension model "like VS Code" | never in v1; reopened only by a second team wanting to extend |
| Rooms surviving restarts (SQLite) | owner states it |
| Simulcast tuning, SVC (VP9/AV1) | measured viewer complaints in rooms ≥ 10 |
| Zero-downtime deploys | owner complaint about deploy drops (kamal-proxy drains 30 s then drops, scout/transport §5.5) |
| Multi-node / Redis | one VPS port saturated for a week |

## 8. Objections to the charter premises

1. **PR1 "no fixed limit"** is overturned by its own condition: the port, not CPU, caps rooms (section 5). The honest statement is a number: 25 per room and a global egress budget, raised when the VPS plan changes.
2. **PR3 gnet** fails its own overturning condition: no TLS/HTTP/WebSocket and Pion cannot use its sockets (scout/transport §3). Drop it.
3. **PR4 P2P or WebSocket media**: mesh upload is N-1 per sender, no server authority (F2), and leaks every participant's IP to every other. Drop both; keep the SFU even for 2.
4. **PR6 feature parity with 53 features** is the largest cost in the charter. Parity includes a VS Code-style extension system, GPU background effects, Excalidraw, local recording, DTLN on WebGPU, 4K. Each is maintenance for a small team. Propose: parity for call, room and owner features; everything in "Reunião" and "Plataforma" deferred behind triggers.
5. **PR2 same VPS as versatile.sh**: media egress shares the port with the main site; a busy room slows versatile.sh. Accepted only with the egress budget enforced. Also the origin IP becomes public (no Cloudflare in front of the main site's IP if it is the same address): HYPOTHESIS, owner to confirm whether versatile.sh stays proxied on another record.
6. **"good voice filter"** has no independent quality evidence for any browser denoiser; start with built-in + RNNoise.
7. **Lobby with country** costs a GeoIP pipeline and personal-data processing for one flag icon; owner-chosen country gives the same UI.
8. **F2 single authority with two processes**: with LiveKit, LiveKit is the authority on presence; our binary is the authority on admission. The judge should accept that split explicitly or reject D-01b(a).

## 9. Spikes worth running locally

- **S1 (gate, ~2 h, no media):** diff `livekit/dtls@v3.1.5-warp.3` against `pion/dtls` v3.1.13 for the three fixes (GHSA-7c2r-jhm9-43vf, -jm57-r6vj-mwg9, -jp25-wc3w-p9xp); run `govulncheck` on a `livekit-server` v1.13.11 build. Pass = all three present and govulncheck clean. Fail → D-01b fallback.
- **S2 (~half day):** `docker compose` with our stub binary + livekit-server 1.13.11 (host network, no Redis) on this machine; measure RSS idle, RSS with 1 room of 10 synthetic participants (`lk load-test`), CPU, and whether `/rtc` through `httputil.ReverseProxy` carries the signal WebSocket.
- **S3 (F1, needs run, ~half day):** 3 Chromium + 1 Firefox clients in that setup; for each of tab close, `kill -9`, network namespace down, `SIGSTOP` (sleep proxy), reload-rejoin: time from event to tile removal on the other clients. Pass = all ≤ 20 s and no duplicate tile on rejoin.
