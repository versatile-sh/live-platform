# Scout: audio (system audio capture, noise suppression, transcription)

Access date for every web source: 2026-11-16. Written by the audio scout. No architecture is proposed.
Proof levels: read (source or doc read), specified (a spec says it), run (executed). Nothing here is "run": no experiment was executed, only reading. Where a number is derived by me it is marked DERIVED and counts as HYPOTHESIS.

## Short answer

1. System audio from a browser works in Chromium on Windows (all surfaces) and on ChromeOS; on macOS it needs macOS 14.2 or later; on Linux it is off by default (feature flag `PulseaudioLoopbackForScreenShare`, disabled), so Linux gets tab audio only. Read, Chromium main (M160) source.
2. Firefox and Safari: no system audio from getDisplayMedia. Firefox bug 1541425 is open, P3, no plan. Safari: no source found that says otherwise (low confidence).
3. Echo of the call audio: `restrictOwnAudio` (Chrome 140) removes the capturing page's audio on Windows 11 and macOS 14.2+ only. Not on Linux, ChromeOS or Windows 10. `suppressLocalAudioPlayback` is for tab capture.
4. Smallest Linux helper: one `module-remap-source` on the default sink monitor (Chrome hides monitor sources from its mic list, so a non-monitor alias is needed). Alternative with no helper: the user launches Chrome with the feature flag on. Both are read-level only; neither was run.
5. Noise suppression: RNNoise (BSD-3-Clause, 0.06 M parameters) via `@sapphi-red/web-noise-suppressor` (MIT) is the lightest maintained npm path; the same package also ships GTCRN. DeepFilterNet3 WASM exists on npm (`deepfilternet3-noise-filter`, Apache-2.0 OR MIT) but is a LiveKit-oriented package from one org with 66 stars. No quality evidence that is independent was found for any of them in a browser.
6. Server transcription for Portuguese plus English on CPU: Whisper family (MIT) via whisper.cpp or faster-whisper, or Parakeet TDT 0.6B v3 (CC-BY-4.0, includes pt) via sherpa-onnx (Apache-2.0, has a Go API). Moonshine (no pt), Kyutai (en, fr only) and Vosk (pt WER 27 to 69) do not fit.
7. None of these is natively streaming for Whisper; practical use is VAD-cut utterances. Cost is roughly 1 core per continuously speaking stream for Whisper small int8 (DERIVED), and 0.03 to 0.33 core for Parakeet v3 int8 (measured by its maintainers on unstated hardware).
8. An SFU can feed audio to a server transcriber by decoding Opus RTP: `pion/opus` (pure Go, MIT, v0.1.0 2026-06-08, has an open decoder-divergence issue) or `hraban/opus` (cgo, needs libopus).
9. Browser transcription (transformers.js on WebGPU) costs the server nothing, but WebGPU is not usable on Firefox per caniuse, and Web Speech API in Chrome sends audio to a Google service.
10. Feature parity list with `screen-call`: 53 features in the table at the end; the audio-related ones are rows A1 to A12.

## 1. System audio capture

### 1.1 Spec and constraint facts

| Fact | Evidence | Proof | Confidence |
|---|---|---|---|
| `systemAudio` (include/exclude) is a hint for monitor surfaces only; "The user agent MAY ignore this hint." | W3C Screen Capture WD 2026-08-27, §5.4.5 and §5.4.10, https://www.w3.org/TR/screen-capture/ | specified | high |
| `windowAudio` (system/window/exclude) is a hint for window surfaces; UA MAY ignore. | same, §5.4.6, §5.4.10 | specified | high |
| `suppressLocalAudioPlayback`: only meaningful when a browser surface is chosen; UA SHOULD suppress local playback; "MUST NOT be observable to the captured document". | same, §5.4 | specified | high |
| `restrictOwnAudio`: UA "MUST attempt to remove any audio" produced by the capturing document; track stays muted if nothing remains. | same, §5.4 | specified | high |
| getDisplayMedia needs a secure context and transient user activation; permission cannot be persisted. | MDN getDisplayMedia, https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia (Security section) | read | high (vendor docs) |
| `noiseSuppression`, `echoCancellation`, `autoGainControl` are constrainable properties. | W3C Media Capture and Streams CRD 2026-11-12, §4.3.8, https://www.w3.org/TR/mediacapture-streams/ | specified | high |
| `restrictOwnAudio` shipped in Chrome 140; Windows and macOS only ("Linux and ChromeOS lack the functionality it needs"); no signal from Gecko or WebKit. | Intent to Ship, https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZfg29iwPc (posted 2025-07-21, LGTMs 2025-07-30) | read | high, source is the vendor |
| `windowAudio` shipped in Chrome 141 (desktop); no signal from Gecko or WebKit. | Intent to Ship, https://groups.google.com/a/chromium.org/g/blink-dev/c/66dDyQoX3RI (2025-08-13) | read | high, vendor |

### 1.2 Per OS and browser (Chromium source at main, chrome/VERSION 160.0.8166.0)

Source files: `chromium/src@main` `media/base/media_switches.cc` (lines 1880-1888, 1944-1955, 1990-2010), `chrome/browser/media/webrtc/desktop_media_picker_controller.cc` (lines 103-126), `chrome/browser/media/webrtc/desktop_capture_devices_util.cc` (lines 485-545), `media/audio/pulse/audio_manager_pulse.cc` (line 396). Read, not run. Confidence high that this is the code at that commit; medium that it matches the stable channel that users run.

| OS | Browser | Tab audio | Window audio | Whole-screen (system) audio | restrictOwnAudio | Evidence |
|---|---|---|---|---|---|---|
| Windows | Chrome/Edge | yes (all Chromium) | per-app audio only on Windows 11 (`IsWindowsProcessLoopbackCaptureSupported` = version >= WIN11) | yes (`IsSystemLoopbackCaptureSupported` returns true) | Windows 11 only (same function) | media_switches.cc:1880-1888, 1944-1946, 2008-2010 |
| macOS | Chrome | yes | per-app audio via CoreAudio tap if macOS >= 14.2 (`kApplicationAudioCaptureMac` enabled by default) | macOS >= 14.2 via CATap; below 15.0 also via ScreenCaptureKit | macOS >= 14.2 | media_switches.cc:1816, 1948, 1990-1999, 1881-1882 |
| ChromeOS | Chrome | yes | not supported ("Linux/ChromeOS don't support this yet") | yes via CRAS (`USE_CRAS`) | no | desktop_capture_devices_util.cc:~505-508; media_switches.cc:1945 |
| Linux | Chrome | yes | no | NOT offered unless feature `PulseaudioLoopbackForScreenShare` is on; it is `FEATURE_DISABLED_BY_DEFAULT` | no | desktop_media_picker_controller.cc:117-123; media_switches.cc:1492-1494 |
| Any | Firefox | tab audio not offered by default | no | no. Bug 1541425 open, P3/S3, no assignee; triage says spec "MAY" makes it low priority; a PipeWire duplicate exists | n/a | https://bugzilla.mozilla.org/show_bug.cgi?id=1541425 (read 2026-11-16, medium: summary by tool) |
| Any | Safari | not found | not found | not found | n/a | HYPOTHESIS: a secondary article (https://dev.to/alexneamtu/how-we-added-system-audio-to-screen-recording-54kg, vendor-blog bias, low confidence) says Safari ignores the constraints and captures no audio |

Notes:
- A secondary article says "Linux system audio generally works without extra setup". It contradicts the source above, and the source wins. Possible reconciliation, not verified: that author tested a Chrome with the flag on, or tab audio only.
- The Chromium Linux path is PulseAudio API (`PulseLoopbackManager`, given a "default monitor name"); PipeWire serves it through pipewire-pulse. HYPOTHESIS: works on PipeWire, not verified.
- Chrome's Linux microphone list excludes monitor sources (`if (info->monitor_of_sink != PA_INVALID_INDEX) return;`, audio_manager_pulse.cc:396). So the owner's reference helper builds a remapped source, which is not a monitor, and the page reads it as a microphone.
- Surfaces and a `restrictOwnAudio`/echo: with a whole-screen share, the system mix contains the call's own remote voices. `restrictOwnAudio` maps to `kLoopbackWithoutChromeId` for whole-screen (desktop_capture_devices_util.cc:537-538), which removes Chrome's audio, as stated in the code comments and in the intent. Where it is unsupported (Linux, Windows 10, ChromeOS) the call audio must be routed away from the shared mix, or the user must use headphones plus a separate output (this is what the reference `Call-Output` sink does). Read.
- Chromium also has `kChromeWideEchoCancellation` enabled by default (media_switches.cc:1157), which is about microphone echo; irrelevant to the share path. Read.

### 1.3 Linux helper: smallest option

| Option | What the user does | Needs | Evidence | Proof |
|---|---|---|---|---|
| A. Flag | Start Chrome with `--enable-features=PulseaudioLoopbackForScreenShare` | Chromium built with PulseAudio | media_switches.cc:1493 | read; behaviour unverified (the feature may be experimental) |
| B. One remap source | `pactl load-module module-remap-source master=@DEFAULT_MONITOR@ source_name=...` once, then pick it as the mic with echoCancellation, noiseSuppression and AGC off | pactl (PulseAudio or pipewire-pulse) | reference `screen-audio`:52 uses `module-remap-source master="$DESKTOP_SINK.monitor"`; Chromium line 396 shows why | read; the reference's own production use is a claim in its README, not run by me |
| C. Reference script `screen-audio` (72 lines) | virtual `Desktop-Audio` sink, share source, `Call-Output` sink, two `module-loopback`, moves Discord streams | pactl, jq | reference `screen-audio` lines 10-57 | read |

Option B does not stop the call's own audio from entering the mix; the call output must be moved to another sink (what C does with `Call-Output`), or headphones with the remote voices on a separate sink. Without a separate sink the remote participants hear themselves on the shared mix. Specified by reading, not run.

## 2. Noise suppression in the browser

| Component | Version, date | Licence | Redistribute and host in OSS? | Maintained? Advisories? | Cost and quality evidence | Proof |
|---|---|---|---|---|---|---|
| Browser built-in (`noiseSuppression: true`) | W3C Media Capture CRD 2026-11-12 §4.3.8 | n/a (browser) | n/a | n/a | Chromium has an ML denoiser path in the audio service behind `IsAudioProcessMlModelUsageEnabled`; it depends on Chrome-wide echo cancellation (media_switches.cc:1159-1836). Algorithm and quality not read. | specified (constraint); ML path read only |
| RNNoise (xiph) | v0.2, 2024-04-15; repo pushed 2025-02-22 | BSD-3-Clause | yes | no open GitHub advisory found (`gh api security-advisories`, empty); OSV query empty for npm wrapper | 0.06 M params, 0.04 GMAC/s (GTCRN paper table, via https://github.com/Xiaobin-Rong/gtcrn); DNSMOS P.808 3.15 vs noisy 2.96 on DNS3 blind (same table, third-party, medium). 48 kHz mono, 480-sample frames (README). | read |
| `@sapphi-red/web-noise-suppressor` | 0.4.1, 2026-09-19 (npm modified) | MIT | yes. It wraps shiguredo/rnnoise-wasm, speex-preprocess-wasm, gtcrn-wasm; I did not read their licences. | repo pushed 2026-11-15; 4 open issues; OSV query empty | Provides AudioWorklet nodes: NoiseGate, RNNoise, Speex, GTCRN. No CPU numbers in the README. | read |
| `@jitsi/rnnoise-wasm` | 0.2.1, 2026-10-29 | repo Apache-2.0 (wraps BSD-3 rnnoise); npm shows no licence field | yes | 3 open issues; repo pushed 2026-10-27 | Used by Jitsi; no benchmark in README | read |
| GTCRN | repo MIT; paper ICASSP 2024 | MIT (code) | yes (weights licence not separately stated) | not checked | 48.2 K params, 33 MMAC/s; DNS3 DNSMOS P.808 3.44 vs RNNoise 3.15; RTF 0.07 on i5-12400 streaming (own README, author bias) | read |
| DTLN (breizhn) | repo last push 2023-07-28; paper Interspeech 2020 | MIT | yes | unmaintained for 3 years | "less than one million parameters", beats the DNS baseline by 0.24 MOS (arXiv 2005.07551 abstract); browser build in the reference project is its own. | read |
| DeepFilterNet (3) | v0.5.6, 2023-08-31; repo pushed 2026-11-06 | MIT or Apache-2.0, code and weights (README lines 325-330) | yes | 64 open issues; no GitHub advisory found | RTF 0.19 single-threaded notebook CPU (arXiv 2305.08227, author bias, medium). No param or MAC figure on the abstract page. | read |
| `deepfilternet3-noise-filter` (npm, mezonai) | 1.3.0, 2026-11-03 | Apache-2.0 OR MIT | yes | 66 stars; one-org package aimed at LiveKit; OSV empty | No quality or CPU data in README | read |
| NSNet2 (Microsoft) | not checked | not checked (DNS-Challenge repo is CC-BY-4.0 for data) | HYPOTHESIS: unknown | not checked | not found | none |
| AudioWorklet cost | | | | | No measurement found for any of these in a browser. The reference project's README claims DTLN picks WebGPU, WebNN or WASM automatically; I did not measure it. | none |

## 3. Transcription

### 3.1 Candidate table (server)

Versions from `gh api repos/.../releases` on 2026-11-16. "Advisories" = `gh api repos/X/security-advisories` published list plus OSV query for the package; "none found" means both returned empty.

| Engine | Version, date | Licence (code / weights) | Hosted, open-source OK? | pt and en | Streaming | CPU speed and RAM (evidence) | Go feed path |
|---|---|---|---|---|---|---|---|
| whisper.cpp | v1.9.5, 2026-10-06 | MIT / Whisper weights MIT | yes | multilingual models, 99 languages claimed upstream (not checked per language) | no native streaming; an example `whisper-stream` re-runs on a sliding window; VAD (Silero) built in | RAM: tiny ~273 MB, base ~388 MB, small ~852 MB, medium ~2.1 GB (README "Memory usage"). Encode of one 30 s window, 8 threads, Ryzen 9 5950X: tiny 197 ms, base 421 ms, small 1393 ms (issue #89, commit fcf515d, from 2022, old code). | Go bindings in repo (`bindings/go`, cgo) |
| faster-whisper | v1.2.1, 2025-10-31 (a year old; repo pushed 2026-11-12) | MIT / MIT | yes | same Whisper models | no (batch of segments) | small, CPU, beam 5, 13 min audio, 8 threads, i7-12700K: int8 1m42s, 1477 MB RAM; fp32 2m37s, 2257 MB (own README, v1.1.0, author bias) | Python only; a sidecar process is needed |
| WhisperX | v3.8.6, 2026-05-25 | BSD-2-Clause; diarization uses pyannote (code MIT, `speaker-diarization-community-1` CC-BY-4.0, gated: Hugging Face token plus agreement) | code yes; the gated diarization model needs an HF account, which conflicts with F5 "no third-party account" at build or install time (HYPOTHESIS: files may be mirrored under CC-BY-4.0, not checked) | Whisper | no (batched offline) | GPU-oriented ("70x realtime large-v2") | Python only |
| Parakeet TDT 0.6B v3 | HF created 2025-08-04, modified 2026-08-05 | weights CC-BY-4.0 (attribution required, redistribution allowed) / NeMo code Apache-2.0 (not checked) | yes with attribution | 25 European languages incl. pt and en. WER: pt 4.76 FLEURS, 7.50 MLS; en 4.85 FLEURS (model card, vendor bias). Card says training used European Portuguese while benchmarks are Brazilian. | model card shows a NeMo chunked streaming script (2 s chunks); in sherpa-onnx it runs as VAD plus offline ("simulated streaming") | int8 ONNX: encoder 652 MB, decoder 12 MB, joiner 6 MB on disk (HF tree). RTF 0.325 on a 3.8 s clip and 0.028 on a 334 s clip, 2 threads, greedy; hardware not stated (file ownership `501 staff` suggests a Mac, HYPOTHESIS) (sherpa docs `code-nemo/*.txt`). Card: "at least 2 GB of RAM". | sherpa-onnx Go API (cgo) |
| sherpa-onnx | v2.0.1, 2026-10-26; repo pushed today | Apache-2.0 | yes | depends on model; has Go API, VAD, diarization, GTCRN enhancement in `go-api-examples` | streaming transducers exist (zh/en listed); simulated streaming for others | see model rows | native Go (cgo) |
| Moonshine | v0.1.6, 2026-11-06 | MIT; models MIT except legacy non-English non-streaming ones (Moonshine Community License, non-commercial) | yes for MIT models | STT languages listed: en, es, de, zh, ja, ko, vi, tl, uk, ar. Portuguese is listed only for TTS. NO pt STT. | yes ("optimized for live streaming") | no numbers on README | C API |
| Kyutai STT | repo pushed 2026-01-26; no releases | code MIT (Python) / Apache-2.0 (Rust); weights CC-BY-4.0 | yes | `stt-1b-en_fr` (en, fr), `stt-2.6b-en` (en). NO pt. | yes, delay 0.5 s (1B) and 2.5 s (2.6B) | GPU numbers only: L40S serves 64 streams at 3x real time; H100 400 streams. CPU: not stated. | Rust server, WebSocket |
| Vosk | v0.3.50, 2024-04-22 (no release in 2.5 years; repo pushed 2026-10-15) | Apache-2.0 code; pt models: small Apache-2.0, large GPLv3 | small only, for the Apache pt model | pt small: WER 32.60 (Common Voice), 68.92 (CORAA); pt large 27.70 and 54.34 (GPLv3). en 0.22: 5.69 LibriSpeech | yes | small models ~300 MB RAM runtime; big up to 16 GB (vendor page) | C API, Go bindings exist (not checked) |

No GitHub advisory was returned for any of the repos above (`gh api repos/<r>/security-advisories`), and OSV returned no entry for `onnxruntime-web 1.31.1`, `@huggingface/transformers 4.3.2`, `sherpa-onnx 2.0.1`, `@sapphi-red/web-noise-suppressor 0.4.1`, `deepfilternet3-noise-filter 1.3.0`, `faster-whisper 1.2.1`, `whisperx 3.8.6`. This means "none known to these two sources on 2026-11-16", not "audited". pion/webrtc has one published advisory GHSA-74xm-qj29-cq8p (medium, DTLS certificate verification) patched in v3.0.15; current is v5.0.0-rc.3 (2026-11-10, pre-release; no stable v5 release found).

### 3.2 CPU cost of N speakers on a 4 to 8 vCPU VPS

None of these figures was measured on the target host. Assumptions stated per line. Contabo vCPUs are shared (HYPOTHESIS, not checked).

| Engine and model | Basis | Cost per continuously speaking stream | N continuous streams on 4 vCPU / 8 vCPU | Proof |
|---|---|---|---|---|
| faster-whisper small int8, beam 5 | 102 s to process 780 s with 8 threads (i7-12700K): RTF 0.131 at 8 threads, so about 1.05 core-seconds per audio second if scaling is linear | about 1 core | about 3 / about 7 (DERIVED, ignores OS and SFU load, ignores that real speech is not continuous, and assumes linear thread scaling) | read of README, arithmetic DERIVED |
| Whisper base (whisper.cpp) | encoder only, one 30 s window: 421 ms with 8 threads on a 5950X (2022 code) is 0.014 RTF at 8 threads; decoder cost not included | well below 1 core, number not usable | not stated | read; HYPOTHESIS |
| Parakeet v3 int8 (sherpa-onnx) | RTF 0.028 to 0.325 at 2 threads, hardware unknown: 0.06 to 0.65 core | 0.06 to 0.65 core | 6 to 60 / 12 to 120 (DERIVED, wide because the hardware is unknown) | read of maintainer output; DERIVED |
| Opus decode of one stream in Go | no benchmark found; `pion/opus` issue 143 "Add steady-state decode benchmark" is open | HYPOTHESIS: small versus the models above | not stated | none |
| Browser (transformers.js) | runs on the speaker's device | 0 server cores | unlimited by server | read |

A VAD gate (Silero VAD v6.2.3, MIT, 2026-09-23) cuts load to the fraction of time people speak. No source for what that fraction is in meetings was found, so the table does not apply one.

### 3.3 How an SFU feeds audio to a server transcriber

| Step | Fact | Evidence | Proof |
|---|---|---|---|
| Receive Opus RTP | Pion gives RTP packets per track; payload is Opus (48 kHz, 20 ms typical) | not re-read for this scout; HYPOTHESIS from general Pion knowledge | none |
| Decode | `pion/opus` v0.1.0 (2026-06-08, MIT): README says decoder SILK and CELT implemented (roadmap 0.0.1 done); open issue 251 "Decoder transition state diverges from libopus around redundancy and PLC" | https://github.com/pion/opus issues, 2026-11-16 | read |
| Decode alt | `hraban/opus` (MIT, last push 2026-07-08): cgo bindings, needs libopus and libopusfile dev packages, README lists "cross compiling" and "self-contained binary" as drawbacks | repo README | read |
| Resample | models take 16 kHz mono; `pion/opus` has an internal `resample` package; sherpa-onnx resamples inputs itself (log line `Creating a resampler` in its sample output) | repo tree; docs output | read |
| Cut utterances | Silero VAD feeds sherpa-onnx or whisper.cpp (both ship VAD integration) | READMEs | read |
| Run the model | in-process through cgo (`sherpa-onnx-go`, Apache-2.0, pushed 2026-10-27; whisper.cpp `bindings/go`) or a sidecar process | repos | read |
| Per-speaker diarization | In an SFU each participant is a separate track, so speaker labels come from the track, no diarization model needed | HYPOTHESIS from the design of an SFU | none |

### 3.4 Browser side

| Option | Facts | Evidence | Proof |
|---|---|---|---|
| transformers.js Whisper on WebGPU | `@huggingface/transformers` 4.3.2, 2026-10-28, Apache-2.0; WASM CPU by default, `device: 'webgpu'` optional, `dtype` fp32/fp16/q8/q4; README warns WebGPU is experimental in many browsers | repo README | read |
| `onnxruntime-web` | 1.31.1, 2026-11-12, MIT | npm | read |
| WebGPU support | caniuse (tool summary, low confidence): Chrome 113 to 160, Edge 113 to 156, Safari 26+ partial, Firefox disabled by default | https://caniuse.com/webgpu | read |
| Web Speech API | "On some browsers, like Chrome ... Your audio is sent to a web service", so it is not offline; `processLocally`, `available()`, `install()` exist for on-device packs; "Limited availability", not Baseline | MDN SpeechRecognition | read |
| Model download | the reference README says the Whisper weights come from Hugging Face on first use, which is a third-party fetch (F5) | reference README "Run locally" | read |
| Whisper weights licence | MIT (openai/whisper README) | https://github.com/openai/whisper | read |

## 4. Feature list of `screen-call` (features only)

Source: the `screen-call` reference README (a local copy, not in this repository), read in full. Ids are for later cross-reference.

| Id | Feature |
|---|---|
| C1 | Screen share up to 4K |
| C2 | Quality presets switchable live |
| C3 | PC sound with no echo of the call |
| C4 | Zoom on the received screen (Ctrl+wheel, drag, double click) asking the sender for full resolution |
| C5 | Camera: background blur |
| C6 | Camera: virtual backgrounds, including the user's own image |
| C7 | Camera: light correction (processed on the GPU in a Worker) |
| A1 | Microphone suppressor: browser built-in |
| A2 | Microphone suppressor: RNNoise (WASM) |
| A3 | Microphone suppressor: DTLN AI on the GPU (WebGPU, WebNN or WASM, automatic pick) |
| A4 | Microphone suppressor: "External" (NVIDIA Broadcast, Krisp) |
| A5 | Balanced voice (compressor) |
| A6 | Noise gate |
| A7 | Push to talk |
| A8 | Per-person volume for voice and screen, up to 200% |
| A9 | Alert sounds |
| A10 | Linux PC-audio helper (`screen-audio`) |
| A11 | Windows: "Entire screen" plus "Share system audio"; tab's own sound excluded |
| A12 | Local audio recording (WebM/Opus in OPFS) |
| L1 | Layout: Automatic |
| L2 | Layout: Grid |
| L3 | Layout: Highlight (follows the speaker) |
| L4 | Layout: bottom strip |
| L5 | Pin a tile |
| L6 | Cinema mode |
| L7 | Picture-in-Picture |
| L8 | Fill or fit per tile |
| E1 | Raise hand |
| E2 | Emoji reactions |
| E3 | Chat with links |
| R1 | Public room (default) |
| R2 | Private room: owner accepts or refuses entry requests |
| R3 | Optional room password for direct entry |
| R4 | Remove a person |
| R5 | Transfer ownership |
| R6 | Rules enforced on the server |
| M1 | Live whiteboard (Excalidraw), owner draws, can allow collaborators with cursors |
| M2 | AI transcription, local (Whisper on GPU or CPU) |
| M3 | Transcription separates who spoke |
| M4 | Live captions |
| M5 | Transcript export: Markdown, TXT, SRT, JSON |
| M6 | Recording notice shown to everyone |
| N1 | Receiver-driven quality (pause and lower what nobody watches) |
| N2 | Codecs chosen per stream type |
| N3 | GPU hardware encoder |
| N4 | WebGPU render with sharpening |
| N5 | Adjustable jitter buffer |
| N6 | Relay-only mode |
| N7 | Stats panel (RTT, loss, jitter, codecs, route) |
| P1 | Extension platform (VS Code model): commands, shortcuts with `when`, command palette (Ctrl+K), contribution points, schema-generated settings, live enable/disable, third-party extensions without a build |
| P2 | Keyboard shortcuts (Ctrl+D mic, Ctrl+E camera, Ctrl+Shift+E share, `?` list, Ctrl+Alt+H hand, Alt+1..8 reactions, Ctrl+Alt+B whiteboard, Ctrl+Shift+B blur, Ctrl+Alt+R record, Ctrl+Alt+T transcribe, Ctrl+Alt+L layout, Ctrl+Alt+F cinema) |
| P3 | No time limit, no sign-up |
| P4 | Room link `/{room}` |

Row count: 53 (7 C, 12 A, 8 L, 3 E, 6 R, 6 M plus M1 counted, 7 N, 4 P). The README states "up to 10 people per room" (full mesh); that is engineering, not a feature to copy, and the charter says no fixed room limit.

## Looked for and not found

- Any measured browser CPU or latency number for RNNoise, GTCRN or DeepFilterNet3 inside an AudioWorklet. None in the READMEs read.
- Independent listening-test or DNSMOS comparison of RNNoise vs DeepFilterNet3 vs DTLN on the same set. Only author tables and the GTCRN paper table.
- Maintained Portuguese streaming ASR model for sherpa-onnx (streaming transducers listed are zh/en); not exhaustively searched.
- Whisper Portuguese WER by model size: the language chart in the Whisper README is an image; I did not open paper Appendix D.
- whisper.cpp and faster-whisper RTF on a Contabo-class shared vCPU, or any benchmark with 4 to 8 vCPUs and concurrent streams. Only desktop CPUs.
- Hardware used for the sherpa-onnx Parakeet RTF numbers.
- Whether PulseaudioLoopbackForScreenShare works on current Chrome stable on PipeWire.
- Chromium Safari/WebKit source on getDisplayMedia audio; Firefox current stable behaviour per OS (only the bug tracker).
- Windows 10 support policy for per-window audio beyond the `>= WIN11` check.
- NSNet2 licence and a browser build.
- Pion RTP to Opus handoff code was not read (3.3 first row is HYPOTHESIS).
- Licence of shiguredo/rnnoise-wasm, sapphi-red/gtcrn-wasm and speex-preprocess-wasm (transitive deps of the MIT package).
- An OSV or GHSA advisory for any listed component (none returned; this does not prove none exist).

## Questions only the owner can answer

1. Languages: is Brazilian Portuguese plus English the full set, or must other languages work? (Moonshine and Kyutai drop out on pt; Parakeet v3 covers 25.)
2. Is transcription expected live (captions within a few seconds) or after the fact? Whisper-family is cut by VAD into utterances; live captions need a different engine class.
3. Is CC-BY-4.0 attribution acceptable for Parakeet weights, and a gated Hugging Face download (WhisperX diarization) acceptable for self-hosters?
4. Transcript consent: all participants see a recording notice in the reference. Is that required here, and may the server see decoded audio at all, or must transcription stay in the browser for privacy?
5. How many concurrent speakers and concurrent rooms should transcription survive on the VPS (needs the VPS plan, PR7)? May it be switched off per room under load?
6. For Linux system audio, is "the user starts Chrome with a flag" acceptable as the documented helper, or only a script?
7. Should the server refuse Windows 10 and Linux users the "no echo" guarantee, or must the app guarantee echo-free system audio on every OS (needs a call-routing helper)?
8. Is a Chromium-only feature set acceptable for system audio and WebGPU (Firefox and Safari get mic and tab only)?
