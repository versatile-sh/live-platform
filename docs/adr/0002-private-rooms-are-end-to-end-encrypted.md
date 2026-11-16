---
status: accepted
---
# Private rooms are end-to-end encrypted; transcription runs in the browser

The owner wanted peer-to-peer for privacy as well as cost. An SFU sees media unless frames are encrypted before they leave the browser, so a private room encrypts every frame with a key derived from the room password in the browser. The server receives only a separate derivative of the password to check entry, never the password or the key. A public room is encrypted in transit only: anyone can enter it, the operator included, so end-to-end encryption would promise nothing.

## Consequences

- The server cannot transcribe or record a private room. Transcription is opt-in and runs in each participant's browser, for every room.
- A participant's browser must support encoded transforms; one that does not cannot enter a private room and is told why.
- Ships after the core is stable and before the repository is made public.

## State on 2026-11-16

Not built yet. The media key is derived in the browser and kept in memory, but nothing uses it: there is no media plane, and chat in a private room crosses the server as plain text. Both must be closed before the repository is made public.
