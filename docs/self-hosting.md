# Self-hosting

live is one container and needs no database.

This repository does not ship deployment configuration: run it with your own.

1. **TLS and one origin.** Browsers require HTTPS for the camera and microphone. Put the server behind a reverse proxy that terminates TLS and routes `/ws` (with WebSocket upgrade) to `SIGNAL_PORT` and everything else to `PORT`. Set `PUBLIC_ORIGIN` to the public origin.
2. **Media over UDP.** Media does not go through the proxy. Open one UDP port, set `MEDIA_UDP_PORT` to it and `MEDIA_PUBLIC_IP` to the address browsers reach. Without TURN, participants on UDP-blocking networks get no media.
3. **Visitor headers.** If your proxy or CDN sets the visitor's country and address, name those headers in `COUNTRY_HEADER` and `ADDRESS_HEADER`. Trust such headers only from your own proxy.
4. **Restarts without dropping rooms.** Give the old and the new process the same `HANDOVER_DIR` and start the new one before stopping the old.
5. **Records.** Decide whether you need an audit trail; if so, set `AUDIT_DIR` on persistent storage and a retention that matches the law where you operate, and update the privacy page to say so.
6. **Publishing the client alone.** Point `WEB_LIVE_DIR` at a directory the server may read; a newer client built there is served over the one in the image without a restart, so nobody in a call is touched. Put scripts and styles in first and keep the old ones, so a tab opened before still finds its files, then the page that names the new ones.
7. **Size.** One room is at most 10 people, and every stream is forwarded to every other participant, so the server's upload grows with the square of a room's size. Plan bandwidth for your busiest rooms.

See also: [Configuration](configuration.md).
