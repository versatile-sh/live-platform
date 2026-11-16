# Scout: liveness, presence and ghost participants

Date: 2026-11-16. Scope: mechanisms, timings, failure modes. No architecture is proposed.
Charter floor F1: a vanished participant leaves for everyone within a bounded, stated time.

Conventions. Proof level: `read` = I read the source or text, `specified` = a standard says so, `run` = I executed it. Nothing in this file is `run` except the local `go version` and `sysctl` readings in section 3. No liveness experiment was run, so F1 has no `run` evidence yet.
Source forms: `repo@sha path:line` for code (shas are the `main`/`master` HEAD I cloned on 2026-11-16, shallow clones, so tags are not recorded; release tags are in section 8). URL entries carry access date 2026-11-16, confidence (H/M/L) and bias.

## Short answer

1. No single signal covers every way a client can vanish. Clean tab close sends a WebSocket Close 1001 (specified). Crash, sleep and network loss send nothing, and the server learns only by silence.
2. Silence detection is always a timer chosen by the server. TCP defaults are far too slow (Linux 2h11m keepalive default; 13-30 min retransmit), so every product studied adds an application-level ping/read-deadline or relies on ICE consent.
3. ICE consent (RFC 7675) gives a 30 s protocol ceiling to "failed". Pion defaults: disconnected 5 s, failed 30 s total. LiveKit tightens this to 10 s / 15 s total.
4. Browser unload events are not reliable (Chrome docs, MDN): crash, discard and mobile task-kill fire nothing. `sendBeacon` is best-effort and only covers the cases where JS still runs.
5. LiveKit, Jitsi, Galene and mediasoup use four different authorities for "who is present": ICE state plus signal (LiveKit), XMPP MUC presence in Prosody (Jitsi), WebSocket read-deadline (Galene), and the application, with the library only emitting events (mediasoup).
6. Every product has a grace window so a brief blip does not remove a person: LiveKit ~15-20 s, Jitsi Prosody smacks hibernation 60 s, mediasoup/Galene none built in (Galene: 45-50 s dead-client rule).
7. The grace window is the ghost window. Every ghost report found (Jitsi #17352, #15537; LiveKit PR #2077 "50 s to 20 s") is the grace window being longer than users tolerate, or a rejoin racing the old session (no identity to replace the ghost: Jitsi #15537 comment).
8. Half-open TCP and a sleeping laptop are the failure modes where nothing arrives; only a server-side read deadline plus ping works. Browsers cannot send WebSocket pings from JS, and the standard forbids them from pinging to help the server (WHATWG WebSockets §5).
9. Go gives default TCP keepalive 15 s idle + 9 probes at 15 s (150 s) but no `TCP_USER_TIMEOUT`; gnet exposes keepalive but not `TCP_USER_TIMEOUT` either.
10. Worst-case detection for a silent vanish, from the read sources: 15-20 s (LiveKit), 45-50 s (Galene), 60-70 s (Jitsi XMPP layer, protoo), 30 s (RFC 7675 ceiling).

## 1. Detection signals and real timings

| # | Signal | Fires when | Timing | Proof | Evidence | Failure mode |
|---|---|---|---|---|---|---|
| 1.1 | WebSocket Close frame 1001 on document unload | Page navigates away or tab closes while JS-host still runs | Immediate (one RTT) | specified | WHATWG WebSockets Living Standard, "make disappear" steps: "start the WebSocket closing handshake, with the status code ... 1001" (fetched https://html.spec.whatwg.org/multipage/web-sockets.html, 2026-11-16, H, standards body) | Not sent on crash, kill, discard, power loss. Not guaranteed to leave the NIC before the process dies. |
| 1.2 | TCP FIN/RST from kernel after process death | Browser process killed, OS still up | Immediate | HYPOTHESIS (standard TCP behaviour, not read from a spec here, not run) | none | OS asleep, battery out, NAT dropped state: no FIN or RST sent. |
| 1.3 | Half-open TCP (no FIN, peer gone) | Server only learns by write timeout or keepalive | Linux defaults: `tcp_keepalive_time` 7200 s, `intvl` 75 s, `probes` 9 = 2 h 11 min; `tcp_retries2` 15 = "approximately 13 to 30 minutes" | specified | man7.org tcp(7) (https://man7.org/linux/man-pages/man7/tcp.7.html, 2026-11-16, H, kernel man-pages) | Server holds a connection and a participant for hours. |
| 1.4 | Local machine sysctl (for contrast) | n/a | this host: keepalive_time 120, intvl 75, probes 9, retries2 15 | run | `sysctl net.ipv4.tcp_keepalive_time ...` on 7.2.5-3-omarchy, 2026-11-16 | Distro defaults differ from man page; do not rely on host defaults. The VPS (Contabo `vmi3756348`) was not read. |
| 1.5 | `TCP_USER_TIMEOUT` | Transmitted data unacked for N ms | Per-socket, ms; overrides keepalive's close decision; Linux 2.6.37+ | specified | tcp(7) same URL; RFC 5482 (TCP User Timeout Option, March 2009) | Only helps when the server is writing. Not set by default anywhere. |
| 1.6 | Go listener keepalive default | Accepted TCP conn, `ListenConfig.KeepAlive == 0` | idle 15 s, interval 15 s, count 9 = 150 s to kill | read | go1.27.3 `src/net/dial.go:20-27` and `ListenConfig` doc; version from `$GOROOT/VERSION` | 150 s is still far above a 15-20 s target. No `TCP_USER_TIMEOUT` field in `net` (grep of `src/net/*.go`, no hit). |
| 1.7 | gnet keepalive | Option `TCPKeepAlive`, `TCPKeepInterval`, `TCPKeepCount` | Interval default 1/5 of keepalive, count 5 | read | gnet clone `options.go:103-115` (HEAD 441457f, 2026-07-03, Apache-2.0) | No `TCP_USER_TIMEOUT` option (grep no hit). WebSocket framing and pings would be the application's job. |
| 1.8 | WebSocket ping/pong | Server sends Ping (0x9); peer MUST answer Pong "as soon as is practical" | App-chosen period and read deadline | specified | RFC 6455 section 5.5.2-5.5.3 (`6455.txt` lines 2038-2064) | Browsers answer pongs automatically but JS cannot send pings; WHATWG says UAs "must not use pings or unsolicited pongs to aid the server" (WebSockets Standard section 5, same URL as 1.1). So server-driven pings are the only transport-level liveness for browsers. A frozen/throttled page still has the browser net stack answer pongs (HYPOTHESIS, not verified), which means pong success does not prove the page code is alive. |
| 1.9 | gorilla/websocket reference pattern | `SetReadDeadline(pongWait)` reset in pong handler | example: pongWait 60 s, pingPeriod 54 s | read | gorilla/websocket `examples/chat/client.go:21-24,62-63` (HEAD e064f32, 2025-03-19) | Worst-case detection = pongWait (60 s) in the example; values are the integrator's. |
| 1.10 | Browser-side visibilitychange to `hidden` | Tab hidden, tab close, app switch (mobile) | Immediate, JS still runs | specified | MDN visibilitychange: "last event that's reliably observable by the page" (https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event, 2026-11-16, H, vendor-neutral docs) | `hidden` is not "left"; a hidden tab with a live call is normal. It cannot distinguish background from departure. |
| 1.11 | `pagehide` / `beforeunload` / `unload` | Page teardown | Immediate if fired | read | MDN sendBeacon (https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon, 2026-11-16, H): on mobile the browser "may never fire `unload`, `beforeunload`, or `pagehide`" when closed from the app manager. Chrome Page Lifecycle (https://developer.chrome.com/docs/web-platform/page-lifecycle-api, 2026-11-16, H, Google): discarded state "No tasks, event callbacks, or JavaScript of any kind can run"; `beforeunload` needs prior user interaction in Chrome. | Unreliable by documentation. `unload` also disables bfcache in Firefox. |
| 1.12 | `navigator.sendBeacon` | Queued POST that survives unload | Best effort; 64 KiB cap; returns true if queued, not if delivered | read | MDN sendBeacon, same URL | Needs an HTTP endpoint that maps the beacon to the participant. A forged beacon removes someone else: needs an unguessable per-session token (HYPOTHESIS, not tested). Not sent on crash or discard. |
| 1.13 | bfcache | Page frozen into cache, then restored | Page may be restored minutes later | read | web.dev bfcache (https://web.dev/articles/bfcache, 2026-11-16, M, Google): "strongly recommend closing connections ... during the `pagehide` or `freeze` event"; Chrome (as of 149) and Safari "do not block on open WebSockets but other browsers do". | A page restored from bfcache with an old WebSocket object sees it closed or dead; the app must rejoin. During caching the page is silent, so only server timeout removes it. |
| 1.14 | Mobile / background throttling | Hidden tab | Chrome intensive throttling: timers run once per minute when hidden >5 min, chain count >=5, silent >=30 s, WebRTC not in use; a page with an open data channel or live track is exempt (regular throttling, once per second) | read | Chrome blog (https://developer.chrome.com/blog/timer-throttling-in-chrome-88, 2026-11-16, H, Google). Article does not say whether an open WebSocket alone exempts. | A client-side ping timer in a hidden tab with no peer connection can run once per minute. Server-driven pings avoid this dependency. iOS/Android suspension behaviour: not read, see "not found". |
| 1.15 | ICE consent freshness, RFC 7675 | Selected 5-tuple has no valid STUN response | Check every 4-6 s (basic 5 s, randomized 0.8-1.2x, MUST NOT be below 4 s); expiry 30 s after last valid response; sent once, not retransmitted | specified | RFC 7675 section 5.1 (fetched https://www.rfc-editor.org/rfc/rfc7675.html, 2026-11-16, H, IETF) | Needs a media path to exist. A participant who joined (signalling) but never completed ICE has no consent clock at all; that case is covered by a join timeout (1.28). |
| 1.16 | ICE consent: immediate revocation | Authenticated close, e.g. TLS fatal alert, or STUN 403 | Immediate | specified | RFC 7675 section 5.2 (same fetch). TCP FIN does not revoke; SRTCP BYE "does not terminate consent". | Revocation can be lost; fall back to the 30 s expiry. |
| 1.17 | ICE keepalive (non-consent) | No packet sent on a used pair for Tr | Tr >= 15 s, SHOULD be 15 s | specified | RFC 8445 section 11 (`8445.txt:3033-3034`) | NAT binding keepalive, not a liveness bound. Pion defaults to 2 s (1.19). |
| 1.18 | ICE-lite server | Lite agent only answers checks | Cannot send consent checks itself; relies on the client's checks | read | mediasoup `worker/src/RTC/ICE/IceServer.cpp:941-957,972-990` (HEAD 74270d3, mediasoup 3.32.2, ISC): consent timer (default 30 s, `iceConsentTimeout`) is restarted when a binding request arrives; on expiry state becomes `disconnected`. Pion `ice/agent.go` `nextConsentDeadline` returns zero for lite agents (line 762-768). Pion lite default disconnected timeout 10 s (`agent_options.go:31-36`). | If the client browser stops sending checks (frozen tab) the server sees expiry, which is correct for liveness but identical to a network drop. |
| 1.19 | Pion ICE agent (full) | Selected pair `LastReceived()` age | disconnected after `disconnectedTimeout` default 5 s; failed after `disconnectedTimeout + failedTimeout` = 30 s; keepalive default 2 s; consent expiry constant 30 s; initial `Checking` timeout = 30 s; max binding requests 7; `SetICETimeouts(d, f, k)` | read | pion/ice@7cb5850 `agent_options.go:25-40,69-70`, `agent.go:429-500,531-551,762-786,795-835`; pion/webrtc@0e35f80 `settingengine.go:232-251`. Latest release pion/ice v5.0.0-rc.9 (2026-11-10, MIT); stable line v4.x (go.mod of webrtc master requires ice v4.4.9). pion/webrtc latest tag v5.0.0-rc.3 (2026-11-10), latest v4 tag v4.2.26 (2026-10-28), MIT. | `failed` also triggers when consent expires with no response for 30 s. Per `agent.go:795-835` the disconnected time is measured from the last packet received on the selected pair. After `failed` the agent drops all candidates and sends no more checks (`agent.go:535-542`), so only an ICE restart or a new agent recovers. |
| 1.20 | Chrome ICE internals | Per-connection receive/write timers | Unwritable after 5 s with 5 pings (`CONNECTION_WRITE_CONNECT_TIMEOUT`, `_FAILURES`); `CONNECTION_WRITE_TIMEOUT` 15 s inactive; `DEAD_CONNECTION_RECEIVE_TIMEOUT` 30 s; `WEAK_CONNECTION_RECEIVE_TIMEOUT` 2.5 s; stable ping 2.5 s; `STUN_KEEPALIVE_INTERVAL` 10 s; transport state `kDisconnected` when `!writable() && has_been_writable_`; `kFailed` when all connections lost after having had one | read | chromium.googlesource.com/external/webrtc `p2p/base/p2p_constants.cc:46-73`, `p2p_transport_channel.cc:484-515` (main, fetched 2026-11-16, no tag recorded, H, Google; the Chrome version that ships these values was not pinned) | Chrome and Pion disagree about when "disconnected" happens; do not assume one number. |
| 1.21 | Firefox ICE | Binding request every 5 s | `disconnected` after one unanswered request (Firefox 52+); `failed` after 6 consecutive misses (30 s) or about 25 s after disconnected | read (blog), not source | Mozilla WebRTC blog, 2016-11-17 (https://blog.mozilla.org/webrtc/ice-disconnected-not/, 2026-11-16, M: first-party but nine years old, nICEr source not read) | Value may have changed. Treat as unverified for current Firefox. Bug 1318180 (offline events to disconnected) seen only in search result titles. |
| 1.22 | W3C state definitions | Browser state machine | `disconnected` = any ICE transport disconnected; `failed` = ICE failed or any DTLS transport failed | specified | W3C WebRTC Recommendation 2025-03-13, sections 4.3.3 and 4.3.4 (https://www.w3.org/TR/webrtc/, 2026-11-16, H). The spec text I could read does not give timings. | `disconnected` is not terminal; it can return to `connected`. Mozilla blog recommends waiting before restarting. |
| 1.23 | DTLS close_notify | Remote closes the DTLS session cleanly | Immediate if sent | read | mediasoup docs: `dtlsstatechange` fires `closed` when the remote sends a DTLS Close Alert, "before the ICE disconnected event" (https://mediasoup.org/documentation/v3/mediasoup/api/, 2026-11-16, H, vendor). Pion: `DTLSTransport.Stop()` closes the DTLS conn and sets `closed` (`webrtc/dtlstransport.go:666-695`); `PeerConnection.updateConnectionState` treats only `failed` as a failure trigger and `closed` DTLS counts as "new/closed" (`peerconnection.go:849-880`). | In Pion, a remote close_notify alone does not put `PeerConnectionState` into `failed` (read of the mapping; the end-to-end behaviour was not run). `pc.close()` in a browser sends it; a crash does not. |
| 1.24 | RTCP BYE | Peer sends SRTCP BYE | n/a | specified | RFC 7675 section 5.2: authenticated BYE "does not terminate consent" | BYE says the source quit, not that the participant left. |
| 1.25 | RTCP / RTP inactivity timer | No incoming media | JVB `Endpoint.shouldExpire`: ICE failed, or no incoming packet for `videobridge.entity-expiration.timeout` = 1 min, or never connected within `epTimeout` | read | jitsi-videobridge@f8efaa7 `jvb/.../Endpoint.kt:1051-1099`; `reference.conf:3-7` (stable/jitsi-meet_11248, 2026-09-14, Apache-2.0) | A muted, audio-less listener still sends RTCP/consent; JVB keys on any incoming packet. In the Pion and LiveKit sources I grepped I found no RTCP-based inactivity timer (see "not found"). |
| 1.26 | App-level ping on the signalling socket | Server and client send JSON ping | Galene: client pings after 15 s silence, errors after 65 s; server pings after 20 s silence, declares dead after 45 s without any read (ticker every 10 s, so 45-55 s) | read | galene@09072c5 `static/protocol.js:323-336`, `rtpconn/webclient.go:970-1030`; MIT, Galene 1.2.2 tagged 2026-11-09 (CHANGES) | A dead client is also removed from the group when the read loop returns an error (inferred from code path, not run). |
| 1.27 | Jitsi XMPP ping | lib-jitsi-meet XEP-0199 pings | interval 10 s, timeout 5 s, threshold 2 | read | lib-jitsi-meet@fb7890d `modules/xmpp/strophe.ping.ts:11-23` (Apache-2.0) | Detects the client's own dead connection (client-side). Server-side departure is Prosody's job (3.2). |
| 1.28 | Join verification | Participant created but never became ACTIVE | LiveKit: removed after 1 min with `JoinTimeout` | read | livekit@80cfa6e `pkg/rtc/room.go:502-506`, `participant.go:1989-1997` | Between join and ICE connect, the only guard is this 1 min timer (plus `HandleSignalSourceClose`, 3.1). |

## 2. Browser behaviour that hides a departed user

| Case | What the server sees | Evidence | Proof |
|---|---|---|---|
| Normal tab close | Close 1001, then TCP FIN | 1.1 | specified |
| Reload | Close 1001 immediately, new socket within seconds, old session still present until server notices (race) | Jitsi #15537 comment: "no mechanism to replace the 'ghost'" (https://github.com/jitsi/jitsi-meet/issues/15537, 2026-11-16, M, user reports) | read |
| Laptop lid closed / OS sleep | Nothing; socket half-open | 1.3 | specified |
| Mobile app switch then task kill | Possibly no event | 1.11, 1.12 | read |
| Wi-Fi switch / IP change | ICE consent stops on old 5-tuple; ICE disconnected then failed; WebSocket may survive or die | Jitsi #17352 (Firefox 149 on meet.jit.si: after 4 network switches, ghost connections; maintainer: "There is a timeout giving some time for the connection to quickly recover") | read |
| Tab in bfcache | Silent | 1.13 | read |
| Hidden tab, long | Timers throttled to 1/min if no WebRTC | 1.14 | read |

## 3. Product state machines

### 3.1 LiveKit (livekit@80cfa6e, tag v1.13.11, 2026-10-25, Apache-2.0; client-sdk-js v2.24.1, 2026-11-14, Apache-2.0)

Participant state (server, `participant.go`): `JOINING` (line 447) -> `JOINED` (`participant_signal.go:69`, when join response is sent) -> `ACTIVE` (`participant.go:2828`, primary transport fully established) -> `DISCONNECTED` (`participant.go:1677` in `Close`). Proof: read.

| Mechanism | Value | Evidence |
|---|---|---|
| Signal ping | server tells client `PingInterval` 5 s, `PingTimeout` 15 s in the join response; client resets a timeout on each pong and closes the signal on expiry | `participant.go:92-93`, `room.go:1056-1057`, `client-sdk-js src/api/SignalClient.ts:694-700,1198-1215` |
| Server use of ping | `lastSignalAt` is used to decide whether the signal is "recent" (<15 s); I did not find the server closing a participant because pings stopped | `transportmanager.go:1081-1123` (read of usages only) |
| ICE timeouts | `iceDisconnectedTimeout` 10 s ("compatible for ice-lite with firefox client"), `iceFailedTimeout` 5 s, total 15 s, keepalive 2 s | `transport.go:82-85,437` |
| Signal closes, ICE never connected | participant closed at once | `participant.go:1098-1103` (`HandleSignalSourceClose`) |
| Signal closes, ICE connected | participant kept; relies on ICE failure | same function, read |
| Transport failed | server sends a leave request with "expected to resume", closes the signal connection, then starts a 5 s `disconnectCleanupDuration` timer; if not cleared by resume (`ICERestart` clears it, `participant.go:1898`) the participant is closed with `PeerConnectionDisconnected` | `participant.go:80,2844-2877` |
| Resulting bound for a silent vanish | roughly 15 s (ICE) + 5 s = ~20 s (derived arithmetic, not run) | PR "Reduce ghost participant disconnect timeout" #2077 states the timeout was cut "from 50s to 20s" (https://github.com/livekit/livekit/pull/2077, 2026-11-16, M, vendor) |
| Docs claim | "your participant disappears after 15 seconds" if the app closes without disconnect() | https://docs.livekit.io/home/client/connect/ (2026-11-16, M, vendor docs; differs from the code-derived ~20 s) |
| Room lifetime | `empty_timeout` 300 s, `departure_timeout` 20 s: room closes after the last participant left plus 20 s ("need to give time in case participant is reconnecting") | `config.go:658-659`, `room.go:766-800` |
| Client reconnect | policy delays [0 (+0-0.5 s jitter), 300, 1200, 2700, 4800, 7000 x5] ms, 10 retries, then give up and close: about 44 s total | `client-sdk-js src/room/DefaultReconnectPolicy.ts:3-40` |
| Reconnect modes | resume (ICE restart over a new signal connection, `reconnect=1`), then full reconnect (new join) | docs above; `rtcservice.go:240` |

Observation from the numbers (derived, not run): the client keeps retrying for ~44 s while the server removes the old participant after ~20 s, so a late client must fall back to a full rejoin as a new participant under the same identity; LiveKit then evicts the old one via `DuplicateIdentity` (`roommanager.go:401`).

LiveKit bug reports touching this: #2077 (above, closed); #3521 "Client Stuck in 'Joined' State, Fails to Switch to 'Active'" (closed 2025-03-12, https://github.com/livekit/livekit/issues/3521); #2046 "Unable to connect in certain network conditions" (open). I read the titles only for #3521 and #2046 and did not verify root causes.

### 3.2 Jitsi (jitsi-videobridge and jicofo at stable/jitsi-meet_11248, 2026-09-14, Apache-2.0)

Three layers, no single participant state machine: Prosody MUC presence (who is in the room), Jicofo (conference focus, Jingle sessions), JVB (media endpoint). Proof: read.

| Layer | Mechanism | Value | Evidence |
|---|---|---|---|
| Prosody presence | XEP-0198 stream management; on disconnect the session hibernates and the user stays "present" until hibernation ends | docker-jitsi-meet@ff341de default `smacks_hibernation_time = 60`, `smacks_max_unacked_stanzas = 5`; some vhosts 15 | `prosody/rootfs/defaults/conf.d/jitsi-meet.cfg.lua:104-106,291`; Prosody default for the module is 600 s (https://prosody.im/doc/modules/mod_smacks, 2026-11-16, M, vendor docs; the page does not state whether presence-unavailable is emitted at expiry) |
| Client XMPP ping | 10 s interval, 5 s timeout, threshold 2 | 1.27 | |
| Jicofo on ICE failure | Does not remove the participant: it removes the colibri endpoint and re-invites (new Jingle session, ICE restart) | `JitsiMeetConferenceImpl.java:1354-1379` |
| Client retries | `MAX_CONNECTION_RETRIES = 3` ICE restarts, then "something went wrong" and full reconnect | `lib-jitsi-meet service/connectivity/Constants.ts:2`, `JitsiConference.ts:1994` |
| JVB endpoint expiry | expires on ICE failed, or no incoming packet for 1 min, or never connected within `epTimeout` (value not located) | 1.25 |
| JVB websocket (colibri) idle | 60 s | `reference.conf:283-284` |

Known ghost reports: jitsi-meet #17352 "Ghost connections after max reconnect is reached" (closed 2026-04-27; reproduced on meet.jit.si Firefox 149; ghosts disappear after 1-2 min); #15537 "Ghost users while reconnecting from the same device" (closed 2025-01-29; comment names a JVB commit and ice4j socket re-creation after network change, and says there is no mechanism to replace the ghost and that a student project was opened); #16969 filmstrip ghost tiles fix (UI-side, closed 2026-02-19). I read the first comments of #17352 and #15537 only; root causes beyond the quoted maintainer statements are unverified.

### 3.3 Galene (galene@09072c5, tag galene-1.2.2, 2026-11-09, MIT)

State is per group, per WebSocket client. There is no separate presence layer. Proof: read.

| Mechanism | Value | Evidence |
|---|---|---|
| Handshake read deadline | 15 s | `rtpconn/webclient.go:823` |
| Dead client | no read for 45 s checked by a 10 s ticker, so 45-55 s; server pings after 20 s silence "Some reverse proxies timeout connexions at 60 seconds" | `webclient.go:970-1030` |
| Client side | pings after 15 s silence; errors after 65 s | `static/protocol.js:323-336` |
| ICE failed | does not remove the client: renegotiates with ICE restart (down connections) or asks the client to renegotiate (up) | `webclient.go:195,304,1129-1150` |
| Web server | `ReadHeaderTimeout` 60 s, `IdleTimeout` 120 s, WebSocket handshake 30 s | `webserver/webserver.go:57-58,559` |

No issue titles with "ghost" or similar were found for Galene (issues are enabled on GitHub).

### 3.4 mediasoup (mediasoup@74270d3, node 3.32.2, rust 0.33.2 released 2026-11-04, ISC; protoo@7c25825 MIT; mediasoup-demo@46b2748 ISC)

mediasoup has no participant concept: a Router with Transports, Producers and Consumers. Presence is the application's. Proof: read plus docs.

| Mechanism | Value | Evidence |
|---|---|---|
| ICE | ICE-lite; `iceConsentTimeout` default 30 s (0 disables), clamped to a min/max constant; on expiry `icestatechange` = `disconnected`; app should close the transport | 1.18; mediasoup docs (1.23 URL) |
| DTLS | `dtlsstatechange` = `closed` on remote close alert; app should close the transport | docs |
| Demo app | on `icestatechange`/`dtlsstatechange` closes the peer; protoo WebSocket keepalive via websocket-node: protoo sets `keepaliveInterval` 60 s (default 20 s), `dropConnectionOnKeepaliveTimeout` default true, `keepaliveGracePeriod` default 10 s, so 60-70 s worst case on the socket | `mediasoup-demo server/src/Peer.ts:1017-1028`, `protoo server/lib/transports/WebSocketServer.js:28-29`; websocket-node docs (https://raw.githubusercontent.com/theturtle32/WebSocket-Node/master/docs/WebSocketServer.md, 2026-11-16, M; websocket-node release/licence not checked) |
| Request timeouts | protoo request timeout 2000 ms x (15 + 0.1 x pending) = 30 s plus | `protoo server/lib/Peer.js:130` |

Ghost-participant issues in mediasoup: none found (see "Looked for and not found"). The mediasoup advisories that exist are DoS in the worker (section 8).

### 3.5 Comparison of what removes a participant

| Product | Authority on "present" | Silent-vanish bound | Grace |
|---|---|---|---|
| LiveKit | Server participant object; ICE state plus signal | ~15-20 s (code), 15 s (docs) | ICE failed 15 s plus 5 s cleanup; room-level 20 s departure |
| Jitsi | Prosody MUC presence (XMPP) | 60 s smacks hibernation by default config, 15 s on some vhosts; JVB media endpoint 1 min inactivity | Jicofo reinvites rather than removes on ICE failure |
| Galene | WebSocket read loop | 45-55 s | none beyond that |
| mediasoup (demo) | Application peer over protoo | 60-70 s socket; 30 s ICE consent | none built in |

## 4. Failure modes catalogue

| # | Failure mode | Mechanism | Evidence |
|---|---|---|---|
| F-a | Signalling alive, media dead | WebSocket ping passes while ICE has failed; presence stays unless ICE state is also an input | LiveKit handles by closing on transport failure; Galene does not remove on ICE failed (3.3) |
| F-b | Media alive, signalling dead | Participant keeps sending media; LiveKit keeps the participant if ICE connected (`HandleSignalSourceClose`) | 3.1 |
| F-c | Ghost from rejoin race | Same person reloads or switches network; old session lingers during grace | Jitsi #15537, #17352 |
| F-d | Grace longer than ghost tolerance | Users see a tile for the length of the grace | LiveKit #2077 (50 s cut to 20 s) |
| F-e | Server holds half-open socket for hours | No read deadline and default kernel keepalive | 1.3 |
| F-f | `failed` terminal state | Pion drops candidates after `failed`; recovery requires ICE restart or a new session | pion/ice `agent.go:535-542` |
| F-g | Late reconnect after removal | Client retries up to ~44 s, server removed at ~20 s | 3.1 |
| F-h | Chrome vs Firefox vs Pion `disconnected` timing differences | 1.19, 1.20, 1.21 | |
| F-i | Hidden-tab timers throttled | Client heartbeats may slip to 1/min without a peer connection | 1.14 |
| F-j | Frozen page, browser stack alive | Browser answers WebSocket pongs and STUN checks while page JS is frozen (HYPOTHESIS, not tested) | none |
| F-k | Join without ICE | Participant exists but never connected | LiveKit 1 min `JoinTimeout` (1.28); mediasoup consent timer starts only after connect (`IceServer.cpp:941-946`) |
| F-l | Resource leak after departure | LiveKit goroutine leaks and unreleased pending tracks fixed in 2026 (#4591, #4970, #4636) | titles read only (https://github.com/livekit/livekit/issues/4591 etc., 2026-11-16, M) |
| F-m | Proxy idle timeouts | Reverse proxies drop idle sockets around 60 s; Galene pings every 20 s for this reason | `webclient.go:1017-1030` comment. Cloudflare Tunnel and nginx timeouts for this deployment: not read. |

## 5. Components named, licences, versions, advisories

All checked 2026-11-16 with `gh api` and OSV (`api.osv.dev` Go ecosystem queries). "Advisory" means GitHub Advisory Database or OSV entries found for the module name queried.

| Component | Version / date | Licence | Open-source redistribution and hosting | Maintained | Advisories found |
|---|---|---|---|---|---|
| pion/webrtc | v5.0.0-rc.3 (2026-11-10); v4.2.26 (2026-10-28) | MIT | Yes | pushed 2026-11-16 | GHSA-74xm-qj29-cq8p (2021, patched v3.0.15); OSV query for v4 module: none |
| pion/ice | v5.0.0-rc.9 (2026-11-10); webrtc master uses v4.4.9 | MIT | Yes | pushed 2026-11-14 | none for v4 module |
| pion/dtls | v4.0.2 (2026-11-12) in releases list; v3 advisories GHSA-9f3f-wv7r-qc8r (fixed 3.1.1/3.0.11), GHSA-wg4g-wm44-ch5j (fixed 3.1.4) | MIT | Yes | active | the two above are fixed in v3.1.4+ |
| livekit/livekit | v1.13.11 (2026-10-25) | Apache-2.0 | Yes (patent grant, NOTICE) | pushed 2026-11-16 | repo advisories: none; OSV none |
| livekit/client-sdk-js | v2.24.1 (2026-11-14) | Apache-2.0 | Yes | active | not queried (npm) |
| jech/galene | galene-1.2.2 (2026-11-09) | MIT | Yes | pushed 2026-11-09 | none |
| jitsi-videobridge / jicofo | stable/jitsi-meet_11248 (2026-09-14) | Apache-2.0 | Yes | active | JVB: GHSA-9v3c-r7vg-gpxv (log4j, critical, old; affects callstats-enabled builds); jicofo: none |
| lib-jitsi-meet | fb7890d (2026-11-12) | Apache-2.0 | Yes | active | not queried (npm) |
| Prosody | not pinned | MIT (not verified in this run) | not checked | not checked | not checked |
| mediasoup | node 3.32.2; rust 0.33.2 (2026-11-04) | ISC | Yes | pushed 2026-11-16 | Several (GHSA-prx9-f2m2-6236, GHSA-6p5q-wg3x-j8x5 high, GHSA-j93j-ccgc-x8q5, GHSA-rq7g-r9qr-rwpq high ...): remote DoS in the C++ worker; patched versions not checked |
| protoo | 7c25825 (2026-09-13) | MIT | Yes | low activity | not queried |
| gorilla/websocket | v1.5.3 (2024-06-14); last push 2025-03-19 | BSD-2-Clause | Yes | slow; repo not archived | GHSA-w67g-5rqw-f597 (weak mask PRNG, fixed 1.5.3), old integer-overflow fixed 1.4.1 |
| coder/websocket | v1.8.15 (2026-06-15); pushed 2026-11-14 | ISC | Yes | active | none found |
| panjf2000/gnet | HEAD 441457f 2026-07-03 in a shared clone (release not queried) | Apache-2.0 | Yes | not checked | not queried |
| Go standard library | go1.27.3 (2026-10-19) | BSD-3-Clause | Yes | yes | not queried |

## Looked for and not found

- A "ghost participant" issue in Galene, mediasoup, or mediasoup-discourse: `gh` search over the GitHub repos returned nothing; the mediasoup Discourse forum was not searched (no API tried).
- A RTCP- or RTP-silence inactivity timer in Pion webrtc or in LiveKit `pkg/rtc` and `pkg/sfu` (grep for rtcp near inactivity/timeout: no hits). JVB has one (1.25).
- `TCP_USER_TIMEOUT` in Go `net` or in gnet options (grep: no hit). Setting it needs `syscall.RawConn.Control` or `golang.org/x/sys`; I did not verify that route.
- A Chrome release number for the p2p constants in 1.20, and a current-Firefox source read for 1.21.
- iOS Safari and Android Chrome documented behaviour for WebSocket and WebRTC in a locked or backgrounded app, including whether `visibilitychange` and `pagehide` fire there. Only generic MDN and Chrome statements were read.
- A LiveKit documentation page that defines the participant state enum; the states come from the code and the protobuf names used in it (`ParticipantInfo_JOINING` etc.).
- The actual value of JVB `epTimeout` and the exact Prosody presence behaviour at smacks hibernation expiry (docs page silent).
- Server-side behaviour when a Pion ICE-lite or full agent receives a DTLS close_notify, end to end; only the state-mapping code was read.
- Whether a WebSocket pong is still produced by a frozen or bfcached page (F-j); no source states it.
- Any run evidence: no WebSocket, ICE or kill test was executed. F1 requires `run` and is open.

## Questions only the owner can answer

1. Bound for F1: what is the longest a ghost tile may remain, for a silent vanish (sleep, Wi-Fi loss) and for a crash? The studied products sit at 15-20 s (LiveKit) up to 60-70 s (Jitsi, protoo).
2. Is a grace window for a brief blip wanted at all (person keeps their tile through a 5 s outage), or is immediate removal acceptable with a fast rejoin?
3. With no login, what identifies "the same person reloading"? Without an identity, a rejoin cannot replace its own ghost (Jitsi #15537).
4. A phone locked or a tab backgrounded with the call open: stay present (media may keep flowing) or count as left after a period? How long?
5. Participant who is connected by WebSocket but whose media path never forms (blocked UDP): present, shown as "connecting", or removed, and after how long?
6. Does a listener with no microphone and no camera count as present? Consent checks and WebSocket pings continue, but no media flows.
7. Should a participant removed by timeout be told (and may they rejoin automatically), or should the UI show "reconnecting" until it gives up?
8. Is the WebSocket to be served by the same listener that runs outside the Cloudflare Tunnel (PR2), or will any proxy with idle timeouts sit in front? That sets the ping period floor (F-m).
