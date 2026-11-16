---
status: accepted
---
# The strong voice filter is RNNoise running in the browser

The standard filter is the browser's own noise suppression, which lets keyboards and fans through. The owner asked for a stronger one. RNNoise, a small recurrent network for speech, runs as WebAssembly inside an audio worklet through `@sapphi-red/web-noise-suppressor` 0.4.1 (MIT, no dependencies, pinned). The microphone is captured with the browser's suppression off and echo cancellation on, passed through the network at 48 kHz, and only the cleaned track is published. Nothing is sent to a server to be filtered, so the server's load and the privacy of the room are unchanged.

The module and its 150 kB network load only when someone chooses Strong. If the worklet or WebAssembly cannot start, the plain microphone is used and the call goes on. The content security policy gains `'wasm-unsafe-eval'` in `script-src`: it allows compiling WebAssembly from our own origin and nothing else; scripts are still only our own files.

Not measured yet: how much processor it takes on a weak machine, and how it sounds next to the standard filter. Both need a person with a microphone.
