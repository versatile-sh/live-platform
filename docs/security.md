# Security and privacy

## Room codes

In a private room the browser derives 64 bytes from the room code with **PBKDF2-SHA-256, 600,000 iterations**, salted with the room's address. The first 32 bytes are a verifier, sent to the server, which stores only its SHA-256. The other 32 are reserved as a media key and never leave the browser. A link carries the code after `#`, which browsers do not send. Ten wrong attempts lock the door for five minutes.

## Hardening

- **Content Security Policy**: `default-src 'none'`; scripts, styles, fonts and connections only from the page's own origin; no inline script or style. `'wasm-unsafe-eval'` is allowed for the voice filter and background blur, which compile WebAssembly from our own files.
- **Signalling limits**: 128 KiB per frame, 2 MiB of unsent data, 20 frames per second with a burst of 80. A client past them is disconnected with a close code that says why. The socket accepts only the configured origins.
- **Supply chain**: exact versions and committed lockfiles, npm install scripts disabled, base images and CI actions pinned by digest, Dependabot on Go, npm, Docker and Actions. CI runs `govulncheck`, `go mod verify`, `npm audit signatures` and `npm audit`, and publishes a CycloneDX SBOM for the server and the client.
- **Image**: distroless, static, non-root.

## What is not built yet

Stated plainly, because an open project is only as safe as what it admits:

- **No end-to-end encryption.** Media is encrypted between each browser and the server (DTLS-SRTP), and the server could read it. Chat, private messages and the whiteboard pass through the server in clear. The media key derived from a room code is reserved for this and not used yet.
- **No TURN relay.** A participant whose network blocks UDP has no media.
- **No simulcast or forwarding on demand.** Every stream reaches everyone, including streams a participant chose to hide.
- **Rooms do not survive a crash**, only a planned handover.
- Not built: recording, transcription, extensions.

## Privacy

The in-app page [/privacy](https://live.versatile.sh/privacy) tells visitors what is kept. In short: without `AUDIT_DIR` the server records nothing. With it, the server appends one JSON line per fact (room created, join, leave, chat, owner action, room ended) to a daily file and deletes files older than `AUDIT_RETENTION_DAYS`. A public room's chat text is recorded; a private room's chat keeps who, when and the length, never the content. The metrics log line carries counts only, and joins and leaves are logged without address, name or text.
