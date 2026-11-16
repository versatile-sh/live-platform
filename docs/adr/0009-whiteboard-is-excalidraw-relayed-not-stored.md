---
status: accepted
---
# The whiteboard is Excalidraw, bundled and pinned, and the server only relays it

The owner asked for an embedded Excalidraw. Writing a drawing tool of that quality ourselves is out of proportion to the product, so the library is used, under these terms.

**Supply chain.** `@excalidraw/excalidraw` 0.18.1 is pinned exactly and built into our own bundle; nothing is fetched from another origin at run time, and its fonts are copied to `/assets/board/` at build (the 13 MB CJK hand-drawn font is left out). As published it pulls 12 advisories (9 high) through `lodash-es`, `nanoid`, `katex` and `mermaid`; `overrides` in `web/package.json` move those to fixed versions and `npm audit` reports none. An upgrade of the library re-checks the overrides. It loads only when someone opens the whiteboard, so the room itself stays the size it was (about 360 kB of script before compression; the whiteboard adds about 4 MB on demand).

**This bends ADR 0007.** That decision says every feature is first-party until an isolated extension system exists, because code in the page can read an end-to-end key. Excalidraw is not code loaded from elsewhere, but it is a large body of code we did not write, in the page. Today no key exists in the page. Before end-to-end encryption ships (ADR 0003), the whiteboard moves into a sandboxed frame without access to the key or the media, or the encryption does not ship.

**Sync.** The board lives in the browsers. A browser sends the elements that changed as a `board` frame (a JSON object of at most 48 KiB); the server checks only that shape and size, relays it to the others and stores nothing. Each element carries a version and a nonce: the higher version wins and, on a tie, the lower nonce, so every browser settles on the same element without a coordinator. Whoever arrives asks for the board and the participant with the lowest pid answers, to that person only. Frames are paced 150 ms apart to stay under the signalling rate limit. Images are disabled, because their bytes would not fit this channel.

**What it costs.** The board is gone when the last person holding it leaves. In a private room it travels in clear through the server, like chat, until encryption exists. Two people editing the same element at once: one edit wins whole.

**Opening it is seen by the room.** A participant who opens the whiteboard sets one more bit of their flags (128), like a shared screen. The others then see the whiteboard as a frame on the stage, in front, and each may close it for themselves; it leaves their stage when nobody has it open.
