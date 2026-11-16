# Round 1, robustness and security seat

Date: 2026-11-16. Seat lens: correctness under failure, server authority, bounded detection, security boundaries.
Inputs read: `CHARTER.md`, `scout/{topology,transport,liveness,security,audio}.md`, the `screen-call` README feature list (features only). The other round-1 file was not read.

Conventions.
- Proof level of a design claim: **read** (I or a scout read source/spec text), **specified** (I specify the behaviour here precisely enough to test, and the inputs it relies on are read), **run** (executed). Nothing in this file is **run** by this seat. Where a scout ran something, it is cited as "scout run".
- Evidence forms: `scout/<file> §n` points at the scout row that carries the primary citation (repo@version path:line, or URL + 2026-11-16 + confidence + bias). Checks I made today are given inline as "seat check 2026-11-16".
- HYPOTHESIS marks every claim with no primary evidence.

Seat checks made today (2026-11-16, GitHub REST API and api.osv.dev, confidence high, no bias): latest releases coder/websocket v1.8.15 (2026-06-15), pion/webrtc v5.0.0-rc.3 (2026-11-10, pre-release; stable v4.2.26), pion/turn v6.0.0-rc.1 (pre-release; stable v5.1.3), pion/ice v5.0.0-rc.9 (stable v4.4.9), react 19.3.1 (2026-10-14), vite 8.3.8 (2026-11-11), golang/vuln v1.1.4 (2025-01-13). OSV returned no vulnerability for coder/websocket 1.8.15, pion/webrtc/v4 4.2.26, pion/turn/v5 5.1.3, pion/dtls/v3 3.1.15, golang.org/x/crypto 0.59.0 (latest tag). OSV did return GHSA-45gg-vh54-h5m9 for x/crypto 0.44.0, so the pin matters. npm registry: react 19.3.1, react-dom 19.3.1, vite 8.3.8, @vitejs/plugin-react 6.3.0, typescript 7.0.2 (Apache-2.0), @sapphi-red/web-noise-suppressor 0.4.1 (MIT). Note: `scout/topology §1.8` found OSV lagging GHSA for pion/dtls, so OSV "none" is necessary, not sufficient; GHSA is checked as well.

## 0. Summary of choices

| Id | Decision | Choice |
|---|---|---|
| D-01 | Media topology | SFU only, every room size. No mesh, no hybrid |
| D-02 | SFU implementation | Own forwarding core on upstream Pion v4 (webrtc 4.2.26), not embedded LiveKit |
| D-03 | Signalling transport and HTTP stack | `net/http` + coder/websocket v1.8.15 behind kamal-proxy. gnet rejected |
| D-04 | Authority and concurrency model | One goroutine (actor) per room owns all room state; versioned roster |
| D-05 | Liveness | Three detectors (socket deadline, app heartbeat, ICE state) feeding one participant state machine; stated bounds 0.3 s / 13 s / 21 s |
| D-06 | Reconnection | Resume by `(participantId, resumeSecret)` within an 8 s grace; new PeerConnection on every resume; supersede, never duplicate |
| D-07 | ICE / TURN on one VPS | Pion UDP mux + ICE-TCP mux + embedded pion/turn v5.1.3 with a deny-list permission handler; no coturn |
| D-08 | Room access and owner privilege | Unguessable slug for private rooms, Argon2id password check before any token, owner capability secret, per-room and per-IP limits |
| D-09 | Lobby and country | Opt-in listing; creator country at creation from DB-IP Lite; IP never stored |
| D-10 | WebSocket and HTTP hardening | Origin allow-list, token in first message, size and rate limits, CSP |
| D-11 | Encryption scope | DTLS-SRTP hop-by-hop; the server is trusted; no E2EE in v1 (stated, not hidden) |
| D-12 | Frontend stack and supply chain | React 19.3.1 + Vite 8.3.8 client-only SPA, no RSC framework, npm hardening |
| D-13 | System audio per OS | Chromium `getDisplayMedia` audio where offered; Linux remap-source helper documented |
| D-14 | Noise suppression | Browser built-in default; RNNoise via @sapphi-red/web-noise-suppressor as option |
| D-15 | Transcription placement | Not on the server in v1; in-browser opt-in; server path specified but gated by owner consultation and a spike |
| D-16 | Persistence and restart | Room config persisted (atomic file); presence never persisted; restart = clients resume-or-rejoin |

## 1. Decisions

### D-01 Media topology

- Options: (a) full mesh; (b) SFU for all sizes; (c) hybrid, mesh below N, SFU above; (d) MCU.
- Choice: (b) SFU for every room, including rooms of 2.
- Why:
  1. F2 says the server is the single authority on presence. In a mesh the media path never touches the server, so the server cannot observe media death (failure F-a, F-b in `scout/liveness §4`). With an SFU the server holds a PeerConnection per participant and gets ICE consent state for each (RFC 7675 §5.1, 30 s ceiling; Pion `SetICETimeouts`, `scout/liveness §1.19`).
  2. Mesh upload grows as N-1 per sender: a 5 Mbps screen to 9 viewers is 45 Mbps upload (RFC 7667 §3.4 plus arithmetic, `scout/topology §2`). PR4 fails above a few people.
  3. A hybrid carries two media paths and a switchover state; the switchover is one more transition where a participant can be duplicated or stranded. No source measures the hybrid as cheaper (`scout/topology §1.9`, "not found").
  4. Mesh reveals every participant's IP to every other participant (`scout/security §4`, HYPOTHESIS there; follows from host/srflx candidates being exchanged). SFU exposes IPs only to the server.
- Proof level: read (topology, cost arithmetic); specified (authority argument).
- Evidence: RFC 7667 §3.4, §3.7 (Informational, Nov 2015, https://www.rfc-editor.org/rfc/rfc7667, 2026-11-16, high, IETF); `scout/topology §2-3`.
- Cost to the operator: all media crosses the VPS. A 2-person call costs 2x the participants' bitrate in VPS egress instead of zero. Capacity arithmetic in §5.
- Reopens it: a measured VPS port or transfer quota that cannot carry the rooms of §5 while a mesh could (only plausible for rooms of 2-3); or the owner ranking "server never sees media" above F2.

### D-02 SFU implementation

- Options: (a) own forwarding core on upstream Pion v4; (b) embed LiveKit v1.13.11 via `service.InitializeServer`; (c) Galene as a separate process; (d) mediasoup or Jitsi as a separate process; (e) Janus (GPL-3.0).
- Choice: (a) upstream Pion: `pion/webrtc/v4 v4.2.26`, `pion/ice/v4 v4.4.9`, `pion/interceptor v0.1.51`, `pion/dtls/v3 v3.1.15` (resolved by webrtc 4.2.26).
- Why:
  1. Presence, resume and eviction are the F1/F2 surface; with LiveKit they are LiveKit's state machine (`JOINING -> JOINED -> ACTIVE -> DISCONNECTED`, ~20 s derived bound, `scout/liveness §3.1`) and its client SDK's ~44 s retry policy, which already disagree with each other (F-g). Owning the state machine is the point of this seat.
  2. LiveKit v1.13.11 replaces pion/dtls with `livekit/dtls v3.1.5-warp.3`, a fork based below 3.1.13, the version that fixes the 2026-10-16 DTLS advisories (GHSA-7c2r-jhm9-43vf critical, GHSA-jm57-r6vj-mwg9, GHSA-jp25-wc3w-p9xp). Whether the fork carries the fixes is not verified (`scout/topology §4` notes). Under F4 this is an open question I will not inherit.
  3. Galene and mediasoup are separate processes with their own presence model; mediasoup had remote DoS advisories in its C++ worker (`scout/liveness §5`). Janus is GPL-3.0.
- What we write (`scout/topology §9`): fan-out with per-subscriber SSRC/seq/timestamp rewrite, PLI/FIR forwarding with throttle, last-N video forwarding, audio-level based speaker detection (`audiolevel` extension parser exists in pion/rtp v1.10.6). Deferred: simulcast layer switching and VP9/AV1 SVC (see §9).
- Proof level: read.
- Evidence: `scout/topology §4, §7, §9`; Pion versions seat check above.
- Cost to the operator: no extra process; one Go binary. Engineering cost is real: interop across Chrome, Firefox, Safari is ours to test (HYPOTHESIS on effort; no source measures it).
- Reopens it: a diff showing `livekit/dtls` carries the 3.1.13 fixes and a spike showing our forwarding core cannot reach the room-30 load of §5 on the VPS; or interop failures on Safari we cannot fix within the round's budget.

### D-03 Signalling transport and HTTP stack (PR3)

- Options: (a) gnet v2.10.0 with our own HTTP/WebSocket; (b) `net/http` + coder/websocket v1.8.15; (c) + gorilla v1.5.3; (d) + gobwas v1.5.0; (e) + lxzan/gws v1.10.2; (f) WebTransport (quic-go/webtransport-go v0.13.0); (g) SSE + POST.
- Choice: (b).
- Why:
  1. gnet has no TLS, HTTP or WebSocket, and its `SetReadDeadline` returns `ErrUnsupportedOp` (`gnet@v2.10.0 connection_unix.go:554-560`, `scout/transport §3`). A read deadline is the core of D-05. Pion needs `net.PacketConn`/`net.Listener`, which gnet does not provide. PR3 is overturned by its own stated condition.
  2. kamal-proxy already terminates TLS with Go `net/http` per connection (`kamal-proxy target.go:296`, `scout/transport §1.4`), so gnet would not remove that cost.
  3. Memory: coder/websocket 23.4 KB per idle connection (scout run, 10,000 connections loopback, one run, medium confidence). At 1,000 participants that is ~23 MB. Not a constraint.
  4. coder/websocket verifies Origin by default (`OriginPatterns`), has a 32 KiB default read limit, context-aware `Ping(ctx)`, ISC licence, push 2026-11-14 (`scout/security §3`). gorilla has had no release since 2024-06-14.
  5. WebTransport: Safari only since 26.4, pre-1.0 library with 4 advisories in 2026, needs UDP 443 which kamal-proxy has off (`scout/transport §4.4`).
- Proof level: read (library facts); scout run (memory table).
- Cost to the operator: ~23 KB RAM per connection; kamal-proxy keeps owning 80/443.
- Reopens it: >10,000 concurrent signalling connections measured on the VPS (memory then exceeds ~230 MB), or coder/websocket becoming unmaintained or carrying an unpatched advisory.

### D-04 Authority and concurrency model (F2)

- Options: (a) shared maps under mutexes; (b) one actor goroutine per room, all mutations by message; (c) external store (Redis) as authority.
- Choice: (b). Each room is a goroutine that owns `Room` and its `Participant` records. Sockets, PeerConnection callbacks and timers never mutate state; they post events (`SocketClosed{pid, gen}`, `PongSeen{pid, gen}`, `ICEState{pid, gen, state}`, `TimerFired{pid, gen, kind}`) to the room inbox. Every participant record carries a `gen` (generation, incremented on each resume); an event whose `gen` is not the current one is dropped. That single rule makes late callbacks from a dead PeerConnection or socket harmless.
- Roster: the room keeps `rosterVersion` (uint64, incremented on every membership or state change). Every server push carries it; clients apply only strictly higher versions and request a full snapshot on a gap. This makes reordering on reconnect harmless.
- Inbox bound: 1,024 events; a full inbox closes the room with an error metric (HYPOTHESIS on the size; spike 3 measures).
- Why: a ghost is a membership decision that never happened or happened twice. A single writer per room removes the races that produce both (the rejoin race in Jitsi #15537, `scout/liveness §2`).
- Proof level: specified.
- Evidence: failure catalogue `scout/liveness §4` (F-c, F-g); no external source prescribes the actor model.
- Cost to the operator: one goroutine per room; no external process (F5).
- Reopens it: needing more than one server process (horizontal scale), at which point a room must still be pinned to one process.

### D-05 Liveness (F1)

- Options: (a) WebSocket only (Galene style, 45-55 s); (b) ICE state only (mediasoup style); (c) both plus an app heartbeat, with a grace window; (d) beacons on unload.
- Choice: (c). Three detectors, one state machine (§2.2), and `sendBeacon`/explicit `leave` used only as accelerators.

Detectors and timings:

| Detector | Mechanism | Value | Basis |
|---|---|---|---|
| T1 socket close | Close frame or TCP FIN/RST observed by the read loop | immediate | WHATWG WebSockets close 1001 on unload (`scout/liveness §1.1`, specified) |
| T2 transport silence | Server sends WebSocket Ping every 4 s; read deadline 12 s reset by any frame incl. Pong | 12 s max | RFC 6455 §5.5.2-5.5.3 (browser must answer Pong); WHATWG: JS cannot ping (`scout/liveness §1.8`) |
| T3 page silence | Client JS sends `{"t":"hb"}` every 4 s; server requires one within 12 s | 12 s max | Proves the page is alive; a frozen or bfcached page may still answer Pongs (F-j, HYPOTHESIS). Chrome keeps regular 1/s throttling while WebRTC is active (`scout/liveness §1.14`, read), so a 4 s JS timer holds in a hidden tab with a live call (HYPOTHESIS until spike 1) |
| T4 media path | Pion `SetICETimeouts(disconnected=4 s, failed=4 s, keepalive=2 s)` on the server agent | `failed` at 8 s after last received packet | `pion/ice agent.go:795-835`, `settingengine.go:232-251` (`scout/liveness §1.19`) |
| T5 never connected | ICE not `connected` within 15 s of the offer | 15 s | covers F-k; LiveKit uses 60 s (`scout/liveness §1.28`), too long for F1 |
| T6 explicit | `leave` message, or `POST /api/leave` via `sendBeacon` with the resume secret on `pagehide` | immediate | best-effort only (`scout/liveness §1.11-1.12`) |

Grace: T1, T2, T3, T4 move a participant from `ACTIVE` to `SUSPECT`. Others see the tile marked "reconnecting" (not a normal tile, so not a ghost by the charter's own words). After 8 s in `SUSPECT` without a successful resume, the participant is removed. T6 removes at once with no grace.

Stated bounds (time from the event to the `left` push reaching other participants, excluding their RTT):

| Case | Bound | Path |
|---|---|---|
| Clean leave (button, tab close with JS alive) | ~0 s + RTT | T6 or T1 then explicit `leave`; if only T1 (close 1001 without `leave`), 8 s grace |
| Browser process killed, OS alive | 8 s | T1 (FIN/RST, HYPOTHESIS that the kernel sends it, `scout/liveness §1.2`) + grace |
| Sleep, network loss, half-open TCP, crash of the OS | 20 s | T2 or T3 at 12 s + 8 s grace |
| Page frozen (bfcache, discard) with socket alive | 20 s | T3 at 12 s + 8 s grace |
| Signal alive, media dead | 16 s | T4 `failed` at 8 s + 8 s grace (resume renegotiates; if ICE fails again, removed) |
| Joined, media never formed | 15 s | T5, removed with reason `media-timeout` shown to the user |

The single bound to publish for F1: **a vanished participant leaves for everyone within 21 s** (20 s + one 1 s scheduler tick margin; HYPOTHESIS on the margin until spike 1). For comparison, LiveKit ~15-20 s, Galene 45-55 s, Jitsi 60 s (`scout/liveness §3.5`).

- Why these numbers: ping 4 s keeps proxy idle timeouts (kamal-proxy `IdleTimeout` 60 s concerns keep-alive between requests; Cloudflare is out of the path, PR2) far away; 3 missed periods before declaring dead tolerates one lost burst. The 8 s grace covers a Wi-Fi switch, a reload (sessionStorage resume, D-06) and Chrome's `kDisconnected` after ~5 s unwritable (`scout/liveness §1.20`). T4 at 8 s is above RFC 7675's 4 s minimum check interval, so at least one consent check is missed before `failed` (HYPOTHESIS that one miss is not common on healthy links; spike 1 measures false removals).
- Proof level: specified. F1 requires run; it is not met by this file. Spike 1 is the run.
- Evidence: as in the table.
- Cost to the operator: a Ping every 4 s and an `hb` every 4 s per participant: 2 small frames / 4 s, ~0.5 frame/s each way. At 1,000 participants ~500 frames/s (arithmetic). Negligible.
- Reopens it: spike 1 showing false removals of healthy participants above 1 per 1,000 participant-hours (threshold is my proposal; owner to confirm), or T3 timers throttled below 1/12 s in a hidden tab with a live call on any supported browser.

### D-06 Reconnection

- Options: (a) no resume, every reconnect is a new join (ghost until timeout); (b) LiveKit-style resume with ICE restart; (c) resume by secret with a new PeerConnection; (d) identity by display name.
- Choice: (c).
  - On `join` success the server issues `participantId` (128-bit random, public in the roster) and `resumeSecret` (256-bit, crypto/rand, never broadcast). The client keeps both in `sessionStorage` (per tab, survives reload, not shared across tabs).
  - `resume{pid, secret}` on a new socket: accepted if pid exists in `SUSPECT` or `ACTIVE` and the secret matches (constant-time compare against the stored SHA-256 of the secret). On accept: `gen++`, the old socket (if any) is closed with code 4001 `superseded`, the old PeerConnection is closed, a fresh `resumeSecret` is issued (rotation), and a new offer/answer runs. The participant keeps its pid, tile, hand-raise and owner status.
  - A `resume` for a removed pid gets `4404 gone`; the client then performs a fresh `join` (new pid). Since removal has already been broadcast, no duplicate exists.
  - A second tab doing `join` is a second participant by design (no identity without login, F3).
  - Client retry schedule: 0, 0.5, 1, 2, 3, 4 s (cumulative 10.5 s, beyond the 8 s grace on purpose so the last attempts hit `gone` and rejoin cleanly). Then show "disconnected, rejoin?" and stop. No silent infinite "connecting" (F1 participant side).
- Why: (a) produces F-c; (b) keeps a Pion agent alive across `failed`, but Pion drops candidates after `failed` (`pion/ice agent.go:535-542`, F-f), so a new PeerConnection is the uniform path; one path is easier to prove than two. (d) is spoofable.
- Duplicate impossibility argument: a pid has at most one `gen`; only the actor changes `gen`; every socket and PeerConnection is tagged with the `gen` it was born under; events from an older `gen` are dropped (D-04). A pid therefore has at most one live media path and one live socket at any time.
- Stranding impossibility argument: every non-terminal participant state has a timer (§2.2); every timer leads to `ACTIVE` or `REMOVED`.
- Proof level: specified.
- Evidence: `scout/liveness §3.1` (LiveKit resume and `DuplicateIdentity`), `§2` (Jitsi #15537: "no mechanism to replace the ghost", https://github.com/jitsi/jitsi-meet/issues/15537, 2026-11-16, medium, user reports).
- Cost to the operator: a full renegotiation per resume (DTLS handshake CPU per resume; HYPOTHESIS: small; spike 3).
- Reopens it: resume renegotiation time above the 8 s grace on real networks (spike 1), which would favour ICE restart on the existing PeerConnection for `disconnected` (not `failed`).

### D-07 ICE and TURN on one VPS (PR2)

- Options: (a) per-participant UDP port range; (b) one UDP mux port + one ICE-TCP port; (c) (b) + embedded pion/turn; (d) (b) + coturn 4.19.1 container.
- Choice: (c). `SetICEUDPMux` on UDP 7882, `SetICETCPMux` on TCP 7881, `SetICEAddressRewriteRules` with the public IP (not the deprecated `SetNAT1To1IPs`), and pion/turn v5.1.3 on UDP+TCP 3478 and TLS 5349, relay UDP range 49160-49200 (port numbers are choices; `scout/transport §5.4`).
- TURN security, all mandatory:
  1. `PermissionHandler` that allows only the VPS's own public IP and the UDP mux port as a peer (the only legitimate peer of a relayed client is our SFU). This is stricter than a deny-list: everything else is refused, including loopback, RFC 1918, link-local, IPv4-mapped IPv6. Default pion/turn admits all peers (`turn@v5.1.3 server_config.go:40-65`, `scout/security §4`). coturn's peer ACL was bypassed twice (IPv4-mapped loopback, GHSA fixed 4.13.0/4.16.0), which is the reason for allow-list over deny-list.
  2. REST-style ephemeral credentials (`GenerateLongTermTURNRESTCredentials`), TTL 600 s, issued only in the `joined` message, username `expiry:pid`; HMAC secret generated at first start and kept in the data dir, never in the repo (F4).
  3. Allocation quota: 2 allocations per pid, 1 per credential refresh; allocation lifetime cap 600 s; per-allocation bandwidth cap (pion/turn has a bandwidth-quota example, `scout/transport §5.1`).
- Why (c) over (d): F5 single binary; coturn has 22 published advisories with two lacking a recorded patched version (`scout/transport §2`).
- Relay need: for an SFU with a public IP and ICE-TCP, relay is needed only where UDP and the TCP port are both blocked; one 2017 source says ~4% of SFU calls (low confidence, `scout/transport §5.6`). TURN-TLS on 443 would reach more corporate networks but conflicts with kamal-proxy on the same IP (HYPOTHESIS, `scout/transport §5.5`); 5349 accepted for v1.
- Proof level: read (Pion APIs); specified (policy).
- Cost to the operator: ports UDP 7882, TCP 7881, UDP/TCP 3478, TCP 5349, UDP 49160-49200 opened at the Contabo panel firewall if active (`scout/transport §7` Q1). Relayed media crosses the VPS twice (in to TURN, out to the SFU over loopback-free public IP; HYPOTHESIS that Pion's mux accepts it, `scout/transport §5.2`).
- Reopens it: a run showing the UDP mux single read goroutine (`udp_mux.go` `connWorker`) saturates below room-30 load; or a second IP becoming available (TURN-TLS 443).

### D-08 Room access and owner privilege

- Options: password chosen vs generated; bcrypt vs scrypt vs Argon2id; owner identity by first-joiner vs capability secret.
- Choice:
  - Slug: public rooms may use a human slug; private rooms get a server-generated 80-bit random slug (base32, 16 chars). HYPOTHESIS: 80 bits is enough against enumeration given the rate limits below.
  - Password: optional; owner may choose it; server offers a generated 8-char a-zA-Z0-9 value (47.6 bits, `scout/security §1`). Stored as Argon2id m=19456 KiB, t=2, p=1 (OWASP minimum, read) with salt and parameters in the encoded string, via `golang.org/x/crypto/argon2` (pin v0.59.0, BSD-3-Clause, OSV none today).
  - Verification happens before any join token: `POST /api/rooms/{slug}/join {password}` → returns a single-use join ticket (128-bit, 30 s TTL, bound to slug) that the WebSocket `join` must present. The WebSocket never sees the password.
  - Memory DoS guard: a global semaphore of 4 concurrent Argon2id verifications (4 x 19 MiB = 76 MiB peak; HYPOTHESIS on the number until measured).
  - Rate limits: per room 30 failed attempts per hour, then a 15 min cool-down for password attempts only (the owner and already-admitted participants are unaffected; the owner can rotate the password); per IP 10 failed attempts per 10 min across rooms; room creation 10 per IP per hour. Arithmetic in `scout/security §1` shows 60 failures/hour leaves a 47.6-bit password at ~2.1e8 years.
  - Owner: room creation returns `ownerSecret` (256-bit), shown once, stored as SHA-256 (high-entropy secret needs no slow hash; HYPOTHESIS that this is acceptable, it is the usual API-key practice). Presenting it in `join` or `claimOwner` grants owner. Ownership transfer issues a new secret to the new owner and invalidates the old. Lost secret = no owner powers; room still usable (owner question).
  - Lobby admission (R2): participants of a private room without password land in `LOBBY` state; only the owner's `admit`/`deny` moves them; lobby entries time out at 120 s.
  - Removal (R4): owner `remove{pid}` → participant `REMOVED` with reason `kicked`, its resume secret is invalidated, a kick-ban of that pid's join-ticket IP for 10 min (owner can disable). IP ban is coarse under CGNAT (HYPOTHESIS on collateral).
- Proof level: read (OWASP, Argon2id), specified (flow).
- Evidence: OWASP Password Storage Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html, 2026-11-16, high, community standard body; via `scout/security §1`).
- Cost to the operator: ~19 MiB and tens of ms CPU per password verification (HYPOTHESIS on time; spike not proposed, cheap to measure later).
- Reopens it: owner wanting account recovery for owners (adds personal data); measured Argon2id time on the VPS above 250 ms.

### D-09 Lobby and country

- Options: Cloudflare `CF-IPCountry`; MaxMind GeoLite2; DB-IP Lite; no country.
- Choice: DB-IP Lite country MMDB (CC BY 4.0, attribution link in the lobby footer), looked up once at room creation from the creator's IP; store the 2-letter code only; never store the IP. Listing is opt-in per room (default unlisted); the lobby shows name, country, participant count bucket (1, 2-5, 6-20, 20+), never names. Lobby endpoint cached 5 s, page size cap 50.
- Why: `CF-IPCountry` disappears once the host leaves the tunnel (PR2) and is spoofable at a directly reachable origin; GeoLite2 EULA §6.1/§6.3 conflicts with bundling in an open repository (`scout/security §7`).
- MMDB reader: `github.com/oschwald/maxminddb-golang` (ISC per its repo; version not checked today: HYPOTHESIS, to verify before adoption) or the database shipped as a CSV range table read by our own code (no dependency). I prefer our own reader of the CSV to keep the dependency list short.
- Proof level: read.
- Cost to the operator: a monthly database refresh (~tens of MB; HYPOTHESIS on size); IP addresses are personal data (GDPR recital 30, `scout/security §7`) only transiently in memory.
- Reopens it: owner wanting member-level country or city.

### D-10 WebSocket and HTTP hardening

- Choice:
  - `websocket.Accept` with `OriginPatterns: ["live.versatile.sh"]` (self-hosters configure theirs). No cookies at all; authentication by join ticket or resume secret in the first message, which must arrive within 5 s or the socket is closed (Galene uses 15 s, `scout/liveness §3.3`).
  - Read limit 16 KiB per message (chat 2,000 characters max); per-socket token bucket 20 messages/s burst 40; overflow closes with 1008.
  - Per-IP: 20 concurrent WebSockets; per-room: no fixed limit (PR1) but a configurable soft cap per VPS (default 150 participants per room, D-01 cost table).
  - `http.Server{ReadHeaderTimeout: 5 s, MaxHeaderBytes: 8 KiB, IdleTimeout: 60 s}` (stdlib fields; HYPOTHESIS that kamal-proxy's 10 s header timeout makes ours secondary).
  - Text from users (names, chat, room names): NFC-normalise, strip C0/C1 controls and bidi overrides, length-limit server-side; render only as React text children; links only `https:`/`http:` with `rel="noopener noreferrer"`; no `dangerouslySetInnerHTML`. React escaping: HYPOTHESIS here (`scout/security §6` did not verify against react.dev).
  - Headers: CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' wss://live.versatile.sh; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)`. `wasm-unsafe-eval` is for RNNoise WASM (HYPOTHESIS that it is required; CSP primary sources were not read by any scout).
- Proof level: specified; read for coder/websocket defaults (`coder/websocket@v1.8.15 accept.go:30-53, read.go:88-97`).
- Cost to the operator: none.
- Reopens it: a found bypass or a needed third-party origin (none planned).

### D-11 Encryption scope

- Options: hop-by-hop DTLS-SRTP with a trusted server; SFrame (RFC 9605) E2EE.
- Choice: hop-by-hop. The server decrypts media. This is stated in the UI privacy note.
- Why: without accounts the only trust root for E2EE keys is the server or the room password; server-side transcription (PR5) would be impossible; RFC 9605 leaves key management out of scope (`scout/security §5`).
- Proof level: read.
- Cost: none now.
- Reopens it: owner putting a malicious server in the threat model.

### D-12 Frontend stack and supply chain (F6, F4)

- Choice: React 19.3.1 + react-dom 19.3.1 (MIT), Vite 8.3.8 (MIT) build only, @vitejs/plugin-react 6.3.0 (MIT), TypeScript 7.0.2 (Apache-2.0). Client-only SPA served as static files by the Go binary (`embed.FS`). No Next.js, no `@vitejs/plugin-rsc`, no `react-server-dom-*` in the lockfile (CI check).
- Supply chain: committed lockfile, `npm ci`, `save-exact=true`, `ignore-scripts=true`, `allow-git=none`, `min-release-age=7` with emergency per-package exclude (npm config, `scout/security §8`, read); CI with read-only token, `npm audit signatures`, OSV-Scanner over `package-lock.json` and `go.mod`, `govulncheck ./...` (golang/vuln v1.1.4, BSD-3-Clause); direct runtime dependencies capped and reviewed on add. Vite dev server never bound beyond localhost (GHSA-p4f5-76q4-ffq7, fixed 8.3.7, needs `--host`).
- Why: every 2025-2026 React critical advisory is in RSC packages; vendor statement says client-only apps are not affected (react.dev blog 2025-12-03 and GHSA-xqc2-xf4c-x3h3, `scout/security §8`, high, vendor bias).
- Proof level: read.
- Cost: a 7-day lag on non-emergency updates.
- Reopens it: an advisory in `react`/`react-dom` client code, or a need for SSR.

### D-13 System audio per OS

- Choice: request `getDisplayMedia({audio: true, systemAudio: "include", restrictOwnAudio: true, windowAudio: "system"})` (hints; UA MAY ignore, W3C Screen Capture WD 2026-08-27 §5.4). Windows and macOS ≥ 14.2 Chromium: native. Linux Chromium: tab audio natively; system audio via the documented helper: one `pactl load-module module-remap-source` plus a separate call-output sink (the minimum that avoids echo of remote voices, `scout/audio §1.3`), shipped as a readable shell script with `on|off|status`. Firefox and Safari: mic and tab only, stated in the UI.
- Security: the helper is served from our origin with a pinned SHA-256 shown on the tutorial page; it never needs root.
- Proof level: read (Chromium M160 source, `scout/audio §1.2`).
- Cost: none on the server.
- Reopens it: Chromium enabling `PulseaudioLoopbackForScreenShare` by default.

### D-14 Noise suppression

- Choice: default `noiseSuppression: true` (W3C Media Capture CRD 2026-11-12 §4.3.8); option RNNoise in an AudioWorklet via `@sapphi-red/web-noise-suppressor` 0.4.1 (MIT; transitive WASM licences unverified, `scout/audio §2`: must be checked before adoption); GTCRN from the same package as a second option after a listening check. All client-side; zero server cost.
- Proof level: read.
- Reopens it: the transitive WASM packages carrying a non-redistributable licence.

### D-15 Transcription placement (PR5)

- Options: server (whisper.cpp v1.9.5 MIT, faster-whisper, sherpa-onnx v2.0.1 Apache-2.0 + Parakeet TDT 0.6B v3 CC-BY-4.0), browser (transformers.js 4.3.2 Apache-2.0 on WebGPU/WASM), off.
- Choice: v1 ships browser-side opt-in transcription of the local user's own mic (each participant transcribes themselves, which also labels speakers without diarization), results shared as chat-like messages with a visible "transcribing" notice for everyone (M6). The server path is specified but off: Opus RTP → `pion/opus` v0.1.0 decode (MIT; open divergence issue 251) → 16 kHz → Silero VAD → sherpa-onnx Parakeet v3, run in a separate process with a CPU quota (cgo and ~2 GB RAM must not take down the SFU).
- Why (robustness lens): a model process sharing the SFU's address space through cgo can crash or starve the process that is the presence authority; and server decoding means the operator processes plaintext speech (privacy, D-11). Parakeet v3 RTF 0.028-0.325 at 2 threads on unknown hardware (`scout/audio §3.2`) is too wide a range to commit a VPS to.
- Proof level: read.
- Cost to the operator: zero in v1; server path ~0.06-0.65 core per continuous speaker (derived, HYPOTHESIS).
- Reopens it: owner consultation (charter) plus a measured RTF on the VPS; Firefox users without WebGPU getting unusable WASM speed.

### D-16 Persistence and restart

- Choice: room configuration (slug, password hash, owner-secret hash, listed flag, country, created-at) written to `data/rooms.json` with write-to-temp + fsync + rename; presence, chat and roster never persisted. On deploy, kamal-proxy drains for 30 s then drops connections (`scout/transport §5.5`); the new process loads rooms; clients' `resume` gets `4404 gone` and they `join` again with the slug (and saved ticket path re-asks the password only if the room has one; the client may cache the join ticket's room password in sessionStorage: HYPOTHESIS that this is acceptable). Owner re-claims with `ownerSecret`.
- Media during a deploy: interrupted for the rejoin time (HYPOTHESIS: a few seconds). Zero-downtime media handover is deferred.
- Rooms expire: no participants for 24 h and not listed → deleted.
- Proof level: specified.
- Reopens it: deploys more often than daily during calls.

## 2. State machines

All timers are owned by the room actor; firing posts `TimerFired{pid, gen, kind}`; stale `gen` is ignored.

### 2.1 Room

| From | Event | To | Timeout / action |
|---|---|---|---|
| (none) | `POST /api/rooms` valid, under rate limit | IDLE | persisted; returns slug and ownerSecret |
| IDLE | first participant reaches ACTIVE | LIVE | |
| LIVE | last participant REMOVED | EMPTY | start 30 s empty timer (lets a lone reloader resume) |
| EMPTY | participant ACTIVE | LIVE | cancel empty timer |
| EMPTY | empty timer 30 s | IDLE | release SFU resources (router, TURN allocations) |
| IDLE | no join for 24 h and unlisted | DELETED | remove from file |
| IDLE/LIVE/EMPTY | owner `close` | CLOSING | push `room-closed` to all; all participants → REMOVED(reason `closed`); 2 s flush then DELETED |
| any | process restart | IDLE (from file) | presence empty |
| LIVE | inbox overflow or panic in actor | CLOSING | recover(), log, metric; never crash the process |

### 2.2 Participant

Terminal state: REMOVED (pid never reused). `gen` increments on entering CONNECTING from SUSPECT.

| From | Event | To | Timeout / action |
|---|---|---|---|
| (none) | WS opened | AUTH | 5 s for first message, else close 4401 |
| AUTH | `join` with valid ticket, public room or password room | CONNECTING | issue pid, resumeSecret, TURN creds; send offer; start T5 15 s |
| AUTH | `join` to private room without password | LOBBY | notify owner; 120 s lobby timer |
| AUTH | `resume` valid (pid SUSPECT or ACTIVE) | CONNECTING (gen+1) | supersede old socket 4001, close old PC, rotate secret; T5 15 s |
| AUTH | `resume` invalid or pid gone | (closed) | 4404 |
| LOBBY | owner `admit` | CONNECTING | as join |
| LOBBY | owner `deny` / 120 s / socket loss | REMOVED | reason `denied` / `lobby-timeout` / `left`; no grace in lobby |
| CONNECTING | PC `connected` and DTLS done | ACTIVE | broadcast roster v+1; start T2/T3 deadlines |
| CONNECTING | T5 15 s | REMOVED | reason `media-timeout`; client shows network help |
| CONNECTING | socket closed | SUSPECT | 8 s grace |
| ACTIVE | `leave` or beacon with valid secret | REMOVED | reason `left`, immediate |
| ACTIVE | socket close (T1), 12 s read deadline (T2), 12 s no `hb` (T3) | SUSPECT | 8 s grace; roster v+1 shows "reconnecting" |
| ACTIVE | ICE `failed` (T4, 8 s) | SUSPECT | close PC; ask client to resume over its socket if alive; 8 s grace |
| ACTIVE | owner `remove` | REMOVED | reason `kicked`, secret invalidated |
| SUSPECT | valid `resume` | CONNECTING (gen+1) | |
| SUSPECT | 8 s grace | REMOVED | reason `timeout`; broadcast roster v+1 |
| any non-terminal | room CLOSING | REMOVED | reason `closed` |
| REMOVED | any event | REMOVED | dropped; resources freed within the same actor step (PC close, TURN allocation revoke, subscriber detach) |

Ownership on removal: if the owner is REMOVED (not SUSPECT), ownership stays vacant; any holder of `ownerSecret` reclaims. No automatic transfer (avoids a race on who gets owner). HYPOTHESIS: acceptable to the owner.

## 3. Wire protocol outline

- HTTPS JSON (through kamal-proxy): `POST /api/rooms` (create), `GET /api/lobby?cursor=` (listed rooms), `POST /api/rooms/{slug}/ticket {password?}` → `{ticket, ttl:30}`, `POST /api/leave {pid, secret}` (beacon).
- WebSocket `wss://live.versatile.sh/ws`, subprotocol `lv.1`, JSON text frames `{"t": type, "id": n?, ...}`. Binary frames rejected. Every server push carries `rv` (roster version) where it changes state.
- Client → server: `join{ticket, name, ownerSecret?}`, `resume{pid, secret}`, `hb`, `answer{sdp}`, `offer{sdp}` (renegotiation from client for new tracks), `ice{candidate}`, `leave`, `media{mic,cam,screen states}`, `chat{text}`, `react{emoji}`, `hand{up}`, `sub{visible:[pid...]}` (receiver-driven: which tiles are on screen, for last-N and pause, N1), `owner{admit|deny|remove|transfer|close|setPassword|setListed, ...}`.
- Server → client: `joined{pid, secret, rv, roster, turn:{urls,user,cred,ttl}, owner:bool}`, `roster{rv, full|delta}`, `offer{sdp}`/`answer{sdp}`, `ice`, `resumed{secret}`, `chat`, `react`, `lobby{pending}`, `error{code}`, `bye{reason}`.
- Close codes: 4001 superseded, 4401 auth timeout, 4403 forbidden, 4404 gone, 4429 rate limited, 1008 policy.
- Negotiation: server is the offerer for downstream tracks; client offers when adding its own tracks; perfect-negotiation glare handling with the server as the "polite = false" side (HYPOTHESIS that the W3C perfect negotiation pattern is the right fit; not read today).
- Versioning: subprotocol `lv.N`; the server accepts N and N-1.

## 4. Deployment on one VPS

| Process | Listens | Notes |
|---|---|---|
| kamal-proxy v0.10.3 (MIT) | TCP 80, 443 | TLS, routes `live.versatile.sh` to the app's HTTP port on localhost; `IdleTimeout` 60 s irrelevant to WS with 4 s pings |
| `live` (one Go binary, Go 1.27.4 toolchain pinned) | HTTP 127.0.0.1:8080 (behind proxy); UDP 7882 (ICE mux); TCP 7881 (ICE-TCP); UDP+TCP 3478, TLS 5349 (TURN); UDP 49160-49200 (TURN relay) | container with host networking (Kamal UDP publishing not documented, `scout/transport §5.4`); runs as non-root; `GOMEMLIMIT` set; data dir `/data` volume |
| (deferred) transcriber | unix socket | separate process with cgroup CPU quota, only if D-15 reopens |

DNS: `live.versatile.sh` A/AAAA grey (DNS-only) in Cloudflare (`scout/transport §5.5`). TLS cert for TURN-TLS 5349: same hostname, read from the proxy's cert store or a separate ACME client (HYPOTHESIS: kamal-proxy cert files are not meant to be shared; owner question). Firewall: open exactly the ports above. Go version: 1.27.4 fixes net/http and crypto issues (`scout/security §9`).

## 5. Capacity arithmetic

Assumptions (HYPOTHESIS, vendor presets from `scout/topology §2`): audio Opus 40 kbps per unmuted speaker; screen 1080p15 2.5 Mbps (one sharer); camera bitrate set by the server per room size through `sub` and sender `maxBitrate`: ≤4 people 1.2 Mbps, ≤10 0.6 Mbps, >10 0.3 Mbps; last-N video: each viewer receives at most 9 camera tiles; audio forwarded for at most 6 unmuted speakers (top by audio level). Packets: ~1,100 B/packet video, 50 pkt/s audio. SFU egress = Σ per viewer of what it receives; ingress = Σ senders.

| Room | Ingress | Egress | Egress/hour | Notes |
|---|---|---|---|---|
| 4 (all cams, 1 screen, 4 speakers) | 4x1.2 + 2.5 + 4x0.04 = 7.5 Mbps | each viewer: 3x1.2 + 2.5 (3 viewers) + 3x0.04 → 4x3.6 + 3x2.5 + 4x0.12 = 22.4 Mbps | ~10 GB | mesh would cost the sharer 3x2.5+3x1.2 = 11.1 Mbps upload |
| 10 | 10x0.6 + 2.5 + 0.24 = 8.7 Mbps | 10 x 9 x 0.6 + 9 x 2.5 + 10 x 5 x 0.04 = 54 + 22.5 + 2 = 78.5 Mbps | ~35 GB | |
| 30 | 30x0.3 + 2.5 + 0.24 = 11.7 Mbps | 30x9x0.3 + 29x2.5 + 30x6x0.04 = 81 + 72.5 + 7.2 = 160.7 Mbps | ~72 GB | ~18k video pkt/s |
| 100 | 100x0.3 + 2.5 + 0.24 = 32.7 Mbps | 100x9x0.3 + 99x2.5 + 100x6x0.04 = 270 + 247.5 + 24 = 541.5 Mbps | ~244 GB | ~62k pkt/s; at LiveKit's ~47.7k pkt/s per core (vendor, `scout/topology §5`) ~1.3 cores, Pion core unmeasured |

Other per-participant costs: signalling 23.4 KB (scout run); PeerConnection memory HYPOTHESIS (not measured by any scout; spike 3); SRTP encryption per outgoing packet is the dominant CPU (HYPOTHESIS).
Reading: rooms of 4 and 10 are bandwidth-cheap; a room of 100 with cameras needs ~0.55 Gbps sustained, likely above the Contabo port and the monthly transfer (unknown, PR7). "No limit" (PR1) is therefore an operator setting: I propose a soft cap of 150 per room and a VPS-wide egress budget that refuses new joins with `4429 capacity` above 80% of the configured port speed. Audio-only rooms of 100 cost 100x6x0.04 = 24 Mbps.

## 6. Dependency list

| Component | Version, date | Licence | Redistribute + host | Maintained | Advisories (2026-11-16) |
|---|---|---|---|---|---|
| Go toolchain | 1.27.4 (2026-11-10) | BSD-3-Clause | yes | yes | security fixes in 1.27.x minors; pin and rebuild (`scout/security §9`) |
| pion/webrtc/v4 | 4.2.26 (2026-10-28) | MIT | yes | push 2026-11-16 | none for v4 (GHSA, OSV seat check) |
| pion/ice/v4 | 4.4.9 (2026-11-09) | MIT | yes | yes | none |
| pion/dtls/v3 | 3.1.15 (commit 2026-10-20) | MIT | yes | yes | 2026-10-16 advisories fixed in 3.1.13; 3.1.15 above |
| pion/interceptor | 0.1.51 (2026-10-23) | MIT | yes | yes | CVE-2025-49140 fixed 0.1.39 |
| pion/rtp | 1.10.6 (2026-10-21) | MIT | yes | yes | none listed |
| pion/turn/v5 | 5.1.3 (2026-10-24) | MIT | yes | yes | none |
| pion/stun/v4 | 4.0.1 (via ice) | MIT | yes | yes | v3 advisory GHSA-34rh-wp3j-6cxc; v4 not checked (HYPOTHESIS patched) |
| coder/websocket | 1.8.15 (2026-06-15) | ISC | yes | push 2026-11-14 | none |
| golang.org/x/crypto (argon2) | 0.59.0 | BSD-3-Clause | yes | yes | none for 0.59.0 (OSV); older 0.44.0 affected by GHSA-45gg-vh54-h5m9 (ssh, unused) |
| kamal-proxy | 0.10.3 | MIT | yes | push 2026-11-16 | none |
| DB-IP Lite country | monthly | CC BY 4.0 | yes with attribution link | monthly | n/a |
| react, react-dom | 19.3.1 (2026-10-14) | MIT | yes | yes | none for client packages |
| vite (build only) | 8.3.8 (2026-11-11) | MIT | yes | yes | dev-server advisories fixed ≤ 8.3.7 |
| @vitejs/plugin-react | 6.3.0 (npm modified 2026-11-09) | MIT | yes | yes | not queried (to do in CI) |
| typescript | 7.0.2 | Apache-2.0 | yes | yes | not queried |
| @sapphi-red/web-noise-suppressor | 0.4.1 (2026-09-19) | MIT (transitive WASM licences unverified) | conditional | push 2026-11-15 | OSV none |
| govulncheck (CI) | golang/vuln 1.1.4 (2025-01-13) | BSD-3-Clause | yes | repo pushed 2026-10-11 | n/a |

Not taken: gnet, LiveKit, coturn, gorilla/websocket, MaxMind GeoLite2, Next.js, quic-go/webtransport-go (reasons in D-02, D-03, D-07, D-09, D-12).

## 7. Deferred, with triggers

| Item | Trigger |
|---|---|
| Simulcast / SVC layer switching (C4 zoom-to-full-res, N1 lower layers) | rooms >10 with cameras routinely, or viewers on weak links complaining; needs VP8 munging or DD parser (`scout/topology §9`) |
| Server transcription | owner consultation + spike RTF on VPS (D-15) |
| TURN-TLS on 443 | second public IP, or measured join failures on 5349-blocked networks |
| Zero-downtime deploy for media | calls disrupted by deploys more than once a week |
| Recording, whiteboard, camera effects, extensions | charter "mapped for later" |
| E2EE (SFrame) | owner adds a malicious server to the threat model |
| Multi-process / multi-VPS | sustained egress above 80% of port speed |

## 8. Objections to charter premises

1. PR1 "no limit": not a property a single VPS can have. §5 shows a 100-person room with cameras at ~0.54 Gbps. I propose the limit be a configured egress budget enforced by the server (admission control), not a fixed room size.
2. PR3 gnet: overturned by its own condition (no TLS, HTTP, WebSocket, deadlines; Pion needs its own sockets). Should be closed, not carried.
3. PR4 P2P/plain WebSocket for media: plain WebSocket cannot carry real-time media with congestion control in browsers at all (it is TCP; HYPOTHESIS on quality, no source read today), and mesh conflicts with F2 (D-01).
4. F1 vs grace: the charter forbids "eternal connecting" but does not say whether an 8 s "reconnecting" tile counts as a ghost. I treat a labelled tile during a bounded grace as compliant; the owner should confirm, and the published bound must be the total (21 s).
5. F2 and restart: a server restart erases presence by design; the floor should say "single authority while running; after restart clients rejoin within X s".
6. PR2 leaves origin IP public: with the host out of the tunnel, the VPS (also serving versatile.sh) loses Cloudflare's DDoS shield for this hostname, and the same IP serves the other site. The charter lists no DoS budget. Rate limits here protect the app, not the link.
7. PR6 parity includes "up to 4K" (C1) and "relay-only mode" (N6): 4K screen through an SFU multiplies egress by viewers; relay-only routes media twice through the VPS. Both should be operator-capped features.

## 9. Spikes worth running locally

1. **F1 kill matrix (the floor's required run).** Go server with the D-04/D-05 state machine on Pion 4.2.26 + coder/websocket 1.8.15; Go test clients (pion/webrtc as the browser stand-in, since local browsers are excluded by the owner's rule) in network namespaces. Cases: clean leave, `kill -9`, `SIGSTOP` (frozen page), `iptables DROP` both ways (sleep/network loss), drop UDP only (media dead, signal alive), reload-resume within 3 s, resume at 9 s. Measure: removal time distribution per case vs the §1 D-05 table; zero duplicates of a pid in any roster version; false removals over a 1 h healthy run with 2% random loss (`tc netem`). Accept: every case ≤ 21 s, zero duplicates, zero false removals.
2. **Resume race and supersede.** 50 clients doing reload storms (resume every 1-3 s) plus owner kicks concurrently; assert roster invariants after every `rv` (one entry per pid, no REMOVED pid reappears, every pid in a non-terminal state has a live timer). Also fuzz the WS message parser and rate limits.
3. **Forwarding cost and TURN policy.** Synthetic room of 30 (and 100 audio-only) through UDP mux on one core-limited container: CPU, RSS per PeerConnection, pkt/s, actor inbox depth; plus a TURN client trying to allocate permissions to 127.0.0.1, ::ffff:127.0.0.1, 10.0.0.1 and the VPS IP on a non-mux port: all must be refused.
