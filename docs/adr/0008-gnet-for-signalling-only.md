---
status: accepted
---
# gnet carries signalling; Pion carries media; the standard HTTP server carries the rest

The owner wants gnet. The study had rejected it for the whole server, because gnet has no TLS, no HTTP and no WebSocket, and Pion cannot use its sockets. On 2026-11-16 the owner decided to use it where it fits, so the binary has three network planes:

| Plane | Runs on | Why |
|---|---|---|
| Signalling (one long WebSocket per participant) | gnet event loops, WebSocket framing by `gobwas/ws` | Long-lived, mostly idle connections: no goroutine and no stack per connection |
| Media and TURN | Pion, on Go sockets | Pion needs `net.PacketConn` and `net.Listener`; gnet offers neither |
| API and page | `net/http` | Short requests with nothing idle to save; a hand-written HTTP parser is a classic source of request-smuggling and header-limit bugs |

TLS ends at the proxy, so gnet's lack of it does not matter.

## Consequences

- gnet has no read deadlines. The handshake and hello deadline is a timer per new connection, and silence is measured by the room actor, which never depended on socket deadlines (ADR 0003).
- Nothing blocks an event loop: a join, a resume and an owner action wait for the room on their own goroutine; every other frame is a non-blocking message to the room.
- Writes to a slow connection queue inside gnet without bound, so each connection counts its pending bytes and is treated as too slow above a limit.
- The proxy must route `/ws` to the signalling port, or signalling gets its own hostname.
- Fragmented and binary frames are refused: lv.1 frames are small JSON text.
