---
status: accepted
---
# Every room goes through our own SFU on Pion

The owner first thought of peer-to-peer. The study showed that a mesh makes the sharer upload one copy per viewer, exposes every participant's IP to the others (unacceptable in a public lobby) and leaves no single authority on who is present, which is where ghosts come from. So every room, even of two, sends media through a forwarding server we write on upstream Pion, inside the one Go binary.

## Considered Options

- **Mesh, or hybrid (mesh below 4):** rejected. Two media paths to keep, IP exposure, and the removal bound would hold only in SFU mode. The bandwidth it saves is in rooms that are already cheap (about 3 Mbps for two people).
- **LiveKit as a process:** rejected on 2026-11-16. Its `livekit/dtls v3.1.5-warp.3` fork lacks the pion/dtls fixes of October 2026 (`docs/research/spikes/S3`), and presence would be split across two processes. Reopens if LiveKit ships a fork that carries them.
## Consequences

Media crosses the VPS, so bandwidth is managed by forwarding on demand (only visible tracks, low-resolution camera tiles, nothing for a muted microphone) and an egress budget. Simulcast is deferred.
