---
status: accepted
---
# The site stays behind Cloudflare; only media reaches the VPS directly

Versatile's hosting has no open port. WebRTC media and TURN cannot cross Cloudflare, so the page, the API and the WebSocket stay proxied by Cloudflare as a public app with no Access login, and media uses a separate DNS-only hostname with only the media ports open on the firewall. The VPS address becomes visible to anyone who joins a room; the owner accepted that on 2026-11-16.

## Consequences

- A denial-of-service attack on the media address also hits the other apps on the VPS. A second address or a media-only host reopens this if it happens.
- The embedded TURN relays only to the SFU's own address and media port, enforced twice (permission by IP, write filter by port), because the permission hook alone left other local ports reachable (`docs/research/spikes/S2`).
- A self-hoster may run everything on one hostname.
