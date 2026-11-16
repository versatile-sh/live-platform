# Scout: signalling transport and server networking (Go), ICE/TURN on one VPS

Date: 2026-11-16. Scope: facts only, no architecture proposal. Charter: `docs/research/CHARTER.md`.

Proof levels: **read** = source or doc read; **specified** = RFC/spec text read; **run** = executed here.
Confidence: high / medium / low. Local source clones and the benchmark live in the session scratchpad (outside every repo); they are not deliverables.

## 1. Short answer

1. gnet v2.10.0 has no TLS (README roadmap `[ ] TLS support`, issues #16, #565, #749 closed without it), no HTTP, no WebSocket. Its `Conn.SetDeadline/SetReadDeadline` return `ErrUnsupportedOp` (`gnet@v2.10.0 connection_unix.go:554-560`). PR3 ("gnet is a good fit") is not supported by what gnet provides.
2. Pion needs `net.PacketConn` (UDPMux) and `net.Listener` (TCPMux, TURN). gnet exposes neither. Pion can run beside gnet, on its own sockets, but not on it.
3. Measured here (run, loopback, 10,000 idle connections, no TLS): net/http + coder/websocket 23.4 KB/conn, gorilla 17.3, gobwas 16.7, gws 9.8, bare goroutine 7.6, gnet raw TCP 0.3 KB/conn. At 1,000 connections the goroutine stacks cost 17-23 MB, at 10,000 about 170-235 MB.
4. If WebSocket traffic reaches the app through kamal-proxy (`httputil.ReverseProxy`, `target.go:296`), kamal-proxy already pays a Go net/http cost per connection, so a gnet app would not remove it.
5. WebSocket is the only signalling transport with no caveat in browsers; WebTransport is in Safari only since 26.4 (MDN BCD), needs UDP and HTTP/3, and kamal-proxy has HTTP/3 off by default and is an HTTP reverse proxy. SSE+POST works but has a 6-connection limit per browser and domain on HTTP/1.1.
6. One-VPS ICE is feasible with Pion: one UDP port (`SetICEUDPMux`), one TCP port (`SetICETCPMux`), `SetNAT1To1IPs`/address rewrite for the public IP. TURN is optional software: coturn 4.19.1 (BSD-3, many advisories in 2026, all fixed in 4.16-4.17+) or pion/turn v5.1.3 (MIT).
7. kamal-proxy owns TCP 80/443 and only speaks HTTP. TURN/TLS on 443 on the same IP needs a second IP or an L4 demultiplexer in front (hypothesis, not tested). Relay candidates must not go through Cloudflare: DNS-only (grey cloud) for any host that serves UDP or non-HTTP TCP.
8. Relay share: no neutral current measurement found. Old measurements: 17-22% of peer-to-peer calls (2015-2017, vendor/engineer data), about 4% in an SFU setup (one 2017 post, read through a search summary only).
9. Contabo: the firewall is a panel feature, blocks all inbound once activated; no page found that states a UDP block. PR2 is not overturned by anything read.
10. Open items for the owner are in section 7.

## 2. Library versions, licences, advisories (checked 2026-11-16)

Advisory source: GitHub Advisory Database via `gh api advisories` (ecosystem go) and repo security advisories. "none" = no entry returned for the module path queried. Confidence: high for the query result, medium for completeness (the DB lists only reviewed or published advisories).

| Component | Latest stable (date) | Licence | Redistribute in OSS and host? | Maintained | Advisories |
|---|---|---|---|---|---|
| panjf2000/gnet v2 | v2.10.0 (2026-07-03) | Apache-2.0 | yes | last push 2026-07-09, 6 open issues | none |
| coder/websocket | v1.8.15 (2026-06-15) | ISC | yes | push 2026-11-14 | none |
| gorilla/websocket | v1.5.3 (2024-06-14) | BSD-2-Clause | yes | last release 2024-06-14, last push 2025-03-19, not archived | GHSA-w67g-5rqw-f597 (weak mask PRNG) fixed in 1.5.3; GHSA-3xh2-74w9-5vxm fixed 1.4.1 |
| gobwas/ws | v1.5.0 (2026-11-04) | MIT | yes | push 2026-11-10 | none |
| lxzan/gws | v1.10.2 (2026-09-11) | Apache-2.0 | yes | push 2026-11-14 | none |
| pion/webrtc v4 | v4.2.26 (tag 2026-10-28); v5.0.0-rc.3 exists (2026-11-10), not stable | MIT | yes | push 2026-11-16 | none for `webrtc/v4` |
| pion/ice v4 | v4.4.9 (tag 2026-11-09); v5.0.0-rc.9 | MIT | yes | push 2026-11-14 | none for `ice/v4` |
| pion/turn v5 | v5.1.3 (tag 2026-10-24); v6.0.0-rc.1 | MIT | yes | push 2026-11-16 | none for `turn/v5` |
| pion/dtls v3 (dep of webrtc 4.2.26: v3.1.15) | n/a | MIT | yes | n/a | GHSA-wg4g-wm44-ch5j (DoS panic, <= 3.1.2, fixed 3.1.4); GHSA-9f3f-wv7r-qc8r (AES-GCM nonce, fixed 3.1.1, 3.0.11). webrtc 4.2.26 pins 3.1.15, above both |
| pion/stun v3 | n/a | MIT | yes | n/a | GHSA-34rh-wp3j-6cxc (DoS panic, <= 3.1.4, fixed 3.1.5). webrtc 4.2.26 and ice 4.4.9 use `stun/v4 v4.0.1`, a different module path; whether v4 was affected: not checked (HYPOTHESIS: patched) |
| pion/interceptor | n/a | MIT | yes | n/a | GHSA-f26w-gh5m-qq77 (fixed 0.1.39); webrtc 4.2.26 pins 0.1.51 |
| quic-go/webtransport-go | v0.13.0 (2026-08-30) | MIT | yes | push 2026-11-15; pre-1.0 | 4 advisories 2026, fixed by 0.11.1 |
| quic-go/quic-go | v0.65.0 (2026-11-03) | MIT | yes | push 2026-11-16 | 8 advisories 2024-2026; newest GHSA-vvgj-x9jq-8cj9 fixed 0.59.1 |
| coturn | 4.19.1 (2026-11-16) | BSD 3-clause text in `LICENSE` (GitHub reports NOASSERTION; text read: "Redistributions of source code must retain...") | yes (permissive); run as a separate process | push 2026-11-16 | 22 published repo advisories 2020-2026; newest fixed in 4.17.0. Two have no patched version recorded: GHSA-j8mm-mpf8-gvjg (4.8.0 only, IPv4-mapped IPv6 bypass of denied-peer-ip) and GHSA-fvj6-9jhg-9j84 (> 4.6.2r5, weak randomness). Whether 4.19.1 contains fixes for these two: not verified |
| basecamp/kamal-proxy | v0.10.3 (clone HEAD 33e0f68, 2026-11-16) | MIT | yes | push 2026-11-16 | none for the module |

Sources: `gh api repos/<r>/releases`, `/tags`, `/license`, `advisories`, `repos/coturn/coturn/security-advisories`, accessed 2026-11-16, confidence high, bias none (first-party API).

## 3. gnet: what it provides and lacks

Source: `panjf2000/gnet@v2.10.0 (441457f)`; README.md accessed 2026-11-16. Proof: read.

| Question | Finding | Evidence |
|---|---|---|
| Transport | TCP, UDP, Unix sockets; epoll/kqueue event loop; Linux, macOS, BSD; Windows "only for development" | README Features |
| TLS | Not provided. Roadmap item unchecked | README "Roadmap: [ ] TLS support"; issues #16, #457, #496, #749 closed; #749 reply "There is still no plan for TLS"; PR #565 "feat: support TLS server" closed unmerged 2024-07-02 |
| HTTP | Not provided; README says users implement HTTP, WebSocket etc. on top | README intro |
| WebSocket upgrade | Not provided. Issues #9, #11, #18, #511 are questions; no `websocket` package in tree | repo tree `ls` at 441457f |
| net.Conn compatibility | `gnet.Conn` has `Read/Write` families of its own (not `io.Reader` blocking semantics), `LocalAddr/RemoteAddr`, `Close`. Deadline methods return `ErrUnsupportedOp` | `gnet.go:424-480`; `connection_unix.go:554-560`; README: "the philosophies can't be reconciled" with `net` |
| Accepting an existing net.Conn | `Enroll(ctx, net.Conn)` exists, i.e. an established conn can be handed to a loop | `gnet.go:405-407` |
| Pion on gnet | Pion UDPMux takes `net.PacketConn` (`ice/v4@v4.4.9 udp_mux.go:78-83`); TCPMux takes `net.Listener` (`tcp_mux.go:47-50`); pion/turn takes `net.PacketConn` and `net.Listener` (`turn/v5@v5.1.3 server_config.go:55-95`). gnet implements none. Pion sockets must be separate from gnet's | read |
| Deps | zap, lumberjack, ants, golang.org/x/sys pinned at v0.30.0 ("don't upgrade beyond"), go 1.20 | `go.mod` |

Consequence (read, not run): TLS, HTTP parsing and WebSocket framing would be written or imported by the project; with kamal-proxy terminating TLS in front, the TLS gap is moot only if the app is never exposed directly.

## 4. Signalling transports

### 4.1 Memory per idle connection (run)

Method: Go 1.27.3, linux/amd64, 16 cores, one server process and one client process on loopback, 10,000 connections completed the HTTP upgrade (client sends a fixed `Sec-WebSocket-Key`, reads the 101 response, then idles). Server reads and discards. `runtime.GC()` and `debug.FreeOSMemory()` before each reading of `VmRSS`. No TLS, no traffic, no compression, kernel socket buffers not in RSS. Single run each; no variance measured. Confidence: medium (one machine, one run, synthetic client). Bias: none, but the harness code is mine and unreviewed. Versions: the ones in section 2.

| Server variant | RSS base (KB) | RSS at 10,000 (KB) | KB per connection | Goroutines |
|---|---|---|---|---|
| net/http + coder/websocket v1.8.15 (`Accept`, `Read` loop) | 15,828 | 250,304 | 23.4 | 10,006 |
| net/http + gorilla/websocket v1.5.3 (`ReadMessage` loop) | 13,768 | 186,700 | 17.3 | 10,006 |
| net/http + gobwas/ws v1.5.0 (`UpgradeHTTP`, 1-byte `Read` loop) | 15,860 | 182,452 | 16.7 | 10,006 |
| net/http + lxzan/gws v1.10.2 (`Upgrade`, `ReadLoop`) | 15,616 | 113,816 | 9.8 | 10,006 |
| Plain TCP, 1 goroutine per conn, 4 KB buffer, no WebSocket | 13,764 | 90,256 | 7.6 | 10,006 |
| gnet v2.10.0 raw TCP, multicore, no WebSocket, no TLS | 20,248 | 23,216 | 0.3 | 23 |

Reading of the table:
- gnet figure excludes WebSocket framing and TLS; a gnet WebSocket server would add per-connection parser state. The 0.3 KB is a lower bound, not the cost of a working signalling server.
- Idle cost scales linearly. At 1,000 concurrent connections the goroutine variants cost about 8-23 MB; at 10,000 about 76-235 MB (above base).
- gws, gobwas and gorilla all use one goroutine per connection in this test; the differences are buffer allocation, not scheduling.
- TLS per-connection memory (Go `crypto/tls`): HYPOTHESIS, not measured. If kamal-proxy terminates TLS, the app side does not carry it, but kamal-proxy does.

### 4.2 Crossover

No source found that states a connection count where an event loop "beats" net/http for this workload (see section 6). From the table: memory difference is not a constraint on one VPS below about 10,000 concurrent signalling connections (about 230 MB for the heaviest variant). CPU under load, and latency, were not measured. Charter PR1 allows no fixed room size, but the media path (SFU/mesh) is the limit long before the signalling socket count; this scout did not measure media.

### 4.3 WebSocket library facts

Source read at the versions in section 2 (module cache). Proof: read.

| Library | Facts | Evidence |
|---|---|---|
| coder/websocket v1.8.15 | `context`-aware API; `Conn.Ping(ctx)`; `NetConn()` wrapper; default read limit 32768 bytes | `conn.go:223`, `netconn.go:48`, `read.go:107` |
| gorilla/websocket v1.5.3 | `WriteControl` for ping, `SetPongHandler`; no release since 2024-06 | `conn.go:413,1185` |
| gobwas/ws v1.5.0 | low-level: `UpgradeHTTP` returns `net.Conn`; framing and ping logic left to `wsutil` or the caller | `server.go:98` |
| lxzan/gws v1.10.2 | `WritePing`, `WriteAsync`, `ReadLoop`, `PermessageDeflate` option | `writer.go:45,77`, `conn.go:110`, `option.go:57` |

All four expose server-initiated ping. Browsers answer ping automatically: RFC 6455 section 5.5.2 requires a Pong in response, and the WHATWG WebSocket standard "Ping and Pong frames" says they are "not currently exposed in the API" and that "servers will solicit pongs whenever appropriate" (https://websockets.spec.whatwg.org/, accessed 2026-11-16, high, spec). So a server-side ping with a deadline is the only protocol-level liveness probe available to a browser WebSocket without page script; whether it meets floor F1 is for the liveness scout.

### 4.4 WebSocket vs WebTransport vs SSE+POST

| Property | WebSocket | WebTransport | SSE + POST |
|---|---|---|---|
| Spec | RFC 6455; WHATWG API | W3C WebTransport; IETF HTTP/3 | WHATWG HTML EventSource; plain HTTP |
| Browser support | all browsers (not re-verified here) | Chrome 97, Firefox 114, Safari 26.4 (MDN BCD `api/WebTransport.json`, main branch, accessed 2026-11-16, high). One search source (VideoSDK) claims Safari 17; contradicts BCD; discarded | all browsers (not re-verified) |
| Transport | TCP (HTTP/1.1 upgrade) | QUIC, UDP, HTTP/3; needs UDP port reachable | HTTP, TCP |
| Direction | full duplex, one socket | streams and datagrams | server to client stream; client to server needs a separate request per message |
| Limits | none beyond sockets | n/a | 6 connections per browser and domain on HTTP/1.1; HTTP/2 default 100 streams (MDN "Using server-sent events", accessed 2026-11-16, high) |
| Liveness | ping/pong, close frame; TCP half-open undetected until ping times out | QUIC idle timeout, connection-level (specified in RFC 9000, not re-read) | server write failure; EventSource auto-reconnects |
| Go server | coder, gorilla, gobwas, gws (section 4.3) | quic-go/webtransport-go v0.13.0, pre-1.0, 4 advisories in 2026 | net/http only |
| Through kamal-proxy | `httputil.ReverseProxy` carries upgrades (`target.go:296`); websocket-aware load balancer logic exists (`load_balancer.go:235`) | HTTP/3 off by default (`--http3`, `internal/cmd/run.go:32`); whether kamal-proxy forwards WebTransport CONNECT to an app: HYPOTHESIS no, not tested | works as plain HTTP |
| Through Cloudflare proxy | supported on all plans; idle timeout exists, length not published, send heartbeats (developers.cloudflare.com/network/websockets, accessed 2026-11-16, high, vendor) | not found in docs read | works |

Proof level for the whole table: read/specified; nothing run beyond section 4.1.

Cloudflare Tunnel versus direct (PR2): after the host leaves the tunnel, DNS-only mode returns the origin IP and does not route HTTP/HTTPS through Cloudflare (developers.cloudflare.com/dns/proxy-status, accessed 2026-11-16, high, vendor).

## 5. ICE / TURN on one VPS

### 5.1 Pion mechanisms (read, versions: webrtc v4.2.26, ice v4.4.9, turn v5.1.3)

| Mechanism | What it does | Evidence |
|---|---|---|
| `SettingEngine.SetICEUDPMux(ice.UDPMux)` | all ICE UDP through one port; "UDPMux should be started prior to creating PeerConnections" | `webrtc@v4.2.26 settingengine.go:497` |
| UDP mux routing | packets from unknown source addresses routed by the STUN `USERNAME` ufrag; one `connWorker` goroutine reads the socket | `ice@v4.4.9 udp_mux.go:596-653` |
| `SetICETCPMux(ice.TCPMux)` | ICE-TCP on one listener; "Make sure that NetworkTypeTCP4 or TCP6 is enabled" | `settingengine.go:490` |
| TCP mux details | RFC 4571 length-prefix framing; server candidates are `TCPTypePassive`; connection dropped if no STUN binding in `FirstStunBindTimeout` (default 30 s) | `tcp_mux.go:441-451`, `gather.go:470`, `tcp_mux.go:57-62`; RFC 6544 section 4 cites RFC 4571 framing |
| `SetNAT1To1IPs(ips, type)` | host candidate replaced by public IP (`ICECandidateTypeHost`) or srflx appended; marked Deprecated | `settingengine.go:340-363` |
| `SetICEAddressRewriteRules` | replacement for NAT1To1; cannot be combined with it | `settingengine.go:370-391` |
| `SetEphemeralUDPPortRange` | restrict ports without mux | `settingengine.go:284` |
| `SetLite(bool)`, `SetNetworkTypes`, `SetInterfaceFilter`, `SetIPFilter` | ICE-lite, udp4/udp6/tcp4/tcp6 selection, interface and IP filters | `settingengine.go:296-318` |
| `NewMultiUDPMuxDefault`, `NewMultiTCPMuxDefault`, `NewUniversalUDPMuxDefault` | multiple sockets (one per address), srflx via mux | `udp_mux_multi.go:25`, `tcp_mux_multi.go:27`, `udp_mux_universal.go:56` |
| ICE client TURN schemes | `turn:` and `turns:` over UDP or TCP are implemented in the client side of the agent | `gather.go:1088-1190` |
| pion/turn server | accepts `PacketConnConfig` (UDP) and `ListenerConfig` (TCP/TLS); relay port range via `RelayAddressGeneratorPortRange`; examples for TCP, TLS, mTLS, bandwidth quota, long-term credential generator | `server_config.go:55-150`, `relay_address_generator_range.go:20`, `examples/` |
| pion/turn RFCs listed | 5389, 5766, 6062, 6156 (README). RFC 8656 not listed | `turn@v5.1.3 README.md:69-74` |

Not read or not tested: pion/webrtc behaviour with `SetICEUDPMux` and many simultaneous PeerConnections (run proof absent); single-socket read goroutine as a throughput ceiling (HYPOTHESIS, from one `connWorker`); ICE-TCP interop with each browser (see 5.3).

### 5.2 TURN: coturn vs embedded pion/turn (read)

| Aspect | coturn 4.19.1 | pion/turn v5.1.3 embedded |
|---|---|---|
| Process | separate C process, separate port set | in the Go binary |
| Transports | UDP, TCP, TLS, DTLS listeners; `-p/--listening-port` default 3478, `--tls-listening-port` default 5349, `--alt-*`, `--no-udp/--no-tcp/--no-tls` | any `net.PacketConn` or `net.Listener`, including `tls.Listen` |
| Relay ports | `--min-port`/`--max-port` | `RelayAddressGeneratorPortRange` |
| NAT | `-X/--external-ip` | `RelayAddress` in the generator |
| REST/time-limited credentials | `--use-auth-secret`, `--static-auth-secret` | example `lt-cred-generator`, user `AuthHandler` |
| Single binary, no extra service (F5, self-hosting) | no | yes |
| Advisory history | 22 published, all with a fix at or below 4.17.0 except the two noted in section 2 | none for `turn/v5` |
| Evidence | coturn `README.turnserver` (4.19.1 tree), accessed 2026-11-16, high, first-party | `turn@v5.1.3` files above |

RFC 8656 section 3.1 (specified): TURN uses UDP between server and peer always; the client side may be UDP, TCP, TLS-over-TCP or DTLS-over-UDP; the server converts. So a browser behind a UDP-blocking firewall reaches the relay over TCP or TLS, and the relay still talks UDP to Pion's mux. Whether Pion's UDP mux accepts relayed traffic from the TURN server's source address with no issue: not tested.

### 5.3 ICE-TCP and browsers

| Claim | Evidence | Confidence |
|---|---|---|
| Firefox 54 enabled active ICE-TCP by default (April 2017); a server must offer passive candidates on a routable address | blog.mozilla.org/webrtc/active-ice-tcp-punch-firewalls-directly/, 2017-04-06, accessed 2026-11-16, vendor first-party | high (for 2017), stale |
| Chrome connects to a server's ICE-TCP candidate | one 2015 discuss-webrtc thread, seen only via search summary | low; current Chrome and Safari status not found |

ICE-TCP is therefore HYPOTHESIS for Chrome/Safari until a run test with each browser.

### 5.4 Ports to open on the VPS (derived, proof: read)

Reference: LiveKit self-hosting table (docs.livekit.io/transport/self-hosting/ports-firewall, accessed 2026-11-16, high, vendor): 50000-60000/UDP per-participant ports, 7882/UDP single-port mux, 7881/TCP ICE-TCP fallback, 3478/UDP TURN/STUN, 5349 TLS TURN ("if not using LB, this port needs to be set to 443"), cloud firewalls must be opened. Pion equivalent below; port numbers are choices, not requirements.

| Purpose | Protocol/port | Required when | Evidence |
|---|---|---|---|
| Web and signalling | TCP 80, 443 (kamal-proxy) | always | kamal-proxy `config.go:12-13` |
| ICE UDP media | one UDP port via `SetICEUDPMux`, or a range via `SetEphemeralUDPPortRange` | SFU or any server-side peer | `settingengine.go:284,497` |
| ICE-TCP fallback | one TCP port via `SetICETCPMux` | UDP blocked clients, if browsers support it (5.3) | `settingengine.go:490` |
| STUN | UDP 3478 (can be the same service as TURN) | to help clients behind NAT; a server with a public IP and ICE-lite needs no STUN of its own | LiveKit table; RFC 8445 not re-read for lite |
| TURN | UDP 3478, TCP 3478, TLS 5349 or 443; relay UDP range | clients that cannot reach UDP mux | coturn README, RFC 8656 section 3.1 |
| HTTP/3 | UDP 443 | only if `kamal-proxy --http3` is set (`run.go:32`) | read |

Docker: Kamal accessory docs show `port: "127.0.0.1:3306:3306"` and say nothing about UDP or `--network host` (kamal-deploy.org/docs/configuration/accessories, accessed 2026-11-16, high, first-party). How to publish UDP or use host networking for the Pion/TURN process under Kamal: not found; the app container's advertised address needs the public IP via NAT 1:1 or rewrite rules if bridged (`settingengine.go:361`).

### 5.5 kamal-proxy, Cloudflare, IPv6

| Topic | Fact | Evidence |
|---|---|---|
| kamal-proxy scope | HTTP/HTTPS reverse proxy; `httputil.ReverseProxy`; listens TCP 80 and 443 (flags `--http-port`, `--https-port`); optional UDP 443 for HTTP/3 (off by default) | `internal/server/server.go:111-160`, `target.go:296`, `run.go:29-32` |
| Non-HTTP traffic through kamal-proxy | no TCP/UDP pass-through found | `ls internal/server`, README read; absence, see section 6 |
| Timeouts | `ReadHeaderTimeout` 10 s, `IdleTimeout` 60 s (keep-alive between requests), drain timeout 30 s on deploy | `service.go:35,47-48`; a deploy drains for 30 s then drops remaining target connections (inferred from `--drain-timeout` help, "Maximum time to allow existing connections to drain before removing old target": proof read, not run) |
| TURN/TLS on 443, same IP as kamal-proxy | conflict: only one listener per IP:port. Options: second public IP; L4 demux by SNI/ALPN in front of both; use another TLS port (5349) and accept firewalls that only open 443. Not tested | HYPOTHESIS |
| Cloudflare proxied (orange) | proxies HTTP ports 80, 8080, 8880, 2052, 2082, 2086, 2095 and HTTPS 443, 2053, 2083, 2087, 2096, 8443; other ports and UDP need Spectrum, UDP/all-port Spectrum is Enterprise only | developers.cloudflare.com/fundamentals/reference/network-ports/, accessed 2026-11-16, high, vendor |
| Cloudflare DNS-only (grey) | returns the origin IP; no HTTP/HTTPS traffic through Cloudflare. So `live.versatile.sh` for a host that carries ICE/TURN traffic: grey | dns/proxy-status page above |
| Cloudflare record types | only A, AAAA, CNAME can be proxied | same |
| Tunnel removal | owner statement (PR2); effect: origin IP becomes public in DNS | charter |
| IPv6 | Pion: `SetNetworkTypes` accepts udp6/tcp6; mux code has `isIPv6` branches (`udp_mux.go:216-227`, `tcp_mux.go:126`); pion/turn README lists RFC 6156; coturn handles both families. Contabo IPv6 availability: not found | read; run: none |

### 5.6 Share of sessions needing a relay

| Source | Figure | Data | Confidence and bias |
|---|---|---|---|
| webrtcHacks, 2016-04-08, callstats.io (https://webrtchacks.com/?p=2560, accessed 2026-11-16) | 22% of conferences used some TURN relay | callstats.io service data, Jan 2015 to Feb 2016 | high that the page says it; medium on representativeness; vendor data source |
| Fippo, "What kind of TURN server is being used?" (medium.com, appear.in data, ~2017), via search summary; page blocked (HTTP 403 / challenge) | about 12% TURN/UDP, 5% TURN/TCP, under 0.5% TURN/TLS, about 17-18% total | one service's calls | low: not read directly; engineer, not vendor marketing |
| Same author, "So I read that 20% of WebRTC calls fail", via search summary only | about 17.7% of peer-to-peer calls relayed, about 4% of SFU calls | one service | low: not read |
| callstats.io metrics report, search summary only (page 404 on fetch) | about 8% in one window, 23% in another | callstats.io | low |
| Fora Soft 2026, Metered | 15-25% estimate | vendor estimates, no data | low; vendor |
| Measure-it-yourself method | count sessions whose selected candidate pair is `relay` in `getStats()` | search summary | medium |

No neutral 2023-2026 measurement found. The relay share for a server-side peer (SFU) is lower than for P2P in the only comparison seen (one source, low). TURN/TLS on 443 being under 0.5% in that data is a single data point.

## 6. Looked for and not found

| Looked for | Result |
|---|---|
| gnet TLS support in any release or branch | none; PR #565 closed unmerged, roadmap unchecked |
| gnet WebSocket or HTTP package | none in tree |
| A published connection count where gnet (or any event loop) beats net/http for WebSocket signalling | none; only the project's own README claims "in many specific scenarios" |
| Benchmarks of TLS memory per connection in Go for this stack | none read; not measured |
| Pion built on gnet, or a `net.PacketConn` adapter over `gnet.Conn` | none |
| kamal-proxy TCP/UDP pass-through or SNI routing | none in source |
| kamal-proxy behaviour for WebTransport | not found in source or docs |
| Kamal documentation for UDP port publishing | not found |
| Contabo documentation saying UDP is blocked or which inbound ports are open by default | none; only "all inbound blocked once the firewall is active, outbound unrestricted" via search summary (help.contabo.com, not fetched directly) |
| Current (2023-2026) neutral measurement of relay share | none |
| Current Chrome and Safari support for passive ICE-TCP candidates | none (Firefox 2017 post only) |
| Cloudflare statement that proxied hostnames carry UDP | none; docs say Spectrum (Enterprise) |
| Whether coturn 4.19.1 fixes GHSA-j8mm-mpf8-gvjg and GHSA-fvj6-9jhg-9j84 | advisory pages record no patched version |
| `hosting/README.md` (charter PR7) | not present in `live.versatile.sh/`; VPS size and provider firewall state unread |
| Autobahn or interop results for the four WebSocket libraries | not collected |

## 7. Questions only the owner can answer

1. Does the Contabo VPS have the Contabo panel firewall active, and can you open UDP and TCP ports (a single UDP port, a TCP port, 3478)? PR2 depends on this.
2. Does the plan include a second public IPv4 (or IPv6) so TURN/TLS can use 443 beside kamal-proxy, or is a non-443 TURN port acceptable?
3. Is IPv6 enabled on the VPS, and should clients on IPv6-only networks be supported?
4. Is `live.versatile.sh` to be DNS-only (grey cloud) in Cloudflare for the whole host, or do you want the page and WebSocket proxied and only a separate hostname (for example `turn.versatile.sh`) DNS-only?
5. Is a coturn container (C, own advisory stream, separate process) acceptable, or must TURN be inside the Go binary for self-hosting simplicity (F5)?
6. How much measured signalling concurrency should the design target (10, 1,000, 10,000)? The memory table above is the only input; it favours no event-loop library below about 10,000 connections.
7. May the app be reached directly (own TLS) rather than only through kamal-proxy, and does deploy-time dropping of WebSockets after the 30 s drain window matter?
8. Is WebTransport worth requiring Safari 26.4 or later and UDP 443?
