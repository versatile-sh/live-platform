# Scout: media topology for group screen share, voice and camera

Scout angle: mesh vs SFU vs MCU vs hybrid; SFU libraries; simulcast/SVC; congestion control; keyframes; codecs; WHIP/WHEP.
Access date for every URL and API call below: 2026-11-16. No final architecture is proposed here.

Proof levels used: **read** (I read spec text, source or docs), **specified** (a standard states it), **run** (I executed it). Nothing in this file is **run**: this scout executed no media code. Anything marked HYPOTHESIS has no primary evidence.
Evidence tags: `[gh API]` = GitHub REST API (first-party metadata, high confidence, no bias). Repo paths are `repo@tag path`; line numbers are given only where I read the line.

## 1. Short answer

1. A full mesh makes each participant upload (N-1) copies of every stream it sends. Specified as topology (RFC 7667 section 3.4); the bandwidth numbers below are my arithmetic on a 5 Mbps 1080p30 screen preset. Mesh breaks on uplink first for screen share. Encoder CPU per peer connection is HYPOTHESIS (vendor blogs only).
2. An SFU receives one copy per sender and forwards packets without decoding (RFC 7667 section 3.7; AV1 RTP spec v1.0.0 section 6 for layer forwarding using only the Dependency Descriptor). Server cost becomes egress bandwidth and packets per second, not codec CPU.
3. An MCU decodes and mixes (RFC 7667 section 3.6.1). Nothing in this scout recommends it for screen share; I found no open-source MCU candidate worth measuring. See "Looked for and not found".
4. On one VPS the first limit is probably the network port, not the cores. LiveKit's own benchmark: 1 publisher to 3000 subscribers is 531 MBps (about 4.2 Gbps) out at 92% CPU on 16 cores (vendor doc). I do not know the VPS port speed (PR7).
5. Self-hostable open-source SFUs with a compatible licence: LiveKit (Go, Apache-2.0), Galene (Go, MIT), mediasoup (C++/Node, ISC), Jitsi Videobridge (Java/Kotlin, Apache-2.0). Janus is GPL-3.0 (C). ion-sfu has had no push since 2023-07-21. Cloudflare Realtime is a paid hosted service and fails F5.
6. Embeddable in one Go binary: Pion (MIT) as a library, with an SFU written by us; or LiveKit via the exported `service.InitializeServer` (read in `cmd/server/main.go`), which brings its own signalling protocol and room model. Galene's packages are importable but the repo is an application, not a stable library API (HYPOTHESIS on stability).
7. Pion alone gives ICE, DTLS-SRTP, RTP, NACK, RTCP reports, TWCC feedback and a GCC implementation (read). It does not give layer selection, keyframe-aligned simulcast switching, VP9/AV1 SVC forwarding (no Dependency Descriptor in `pion/rtp@v1.10.6`), or active-speaker logic.
8. Open advisory finding that matters for F4: Pion DTLS published 6 advisories on 2026-10-16, three fixed in v3.1.13 (impersonation, CPU, memory). Pion `webrtc@v4.2.26` resolves `dtls v3.1.15` (fixed). LiveKit `v1.13.11` replaces `pion/dtls` with `livekit/dtls v3.1.5-warp.3` (a fork based on a version below 3.1.13). Whether the fork carries the fixes: not verified.
9. Hybrid (mesh small, SFU large) means carrying two media paths and a switchover. I found no source that measures it as cheaper than SFU-only. Only the SFU path is needed for large rooms, so the hybrid adds code without removing the need for the SFU.
10. Pion v5 is at `v5.0.0-rc.3` (2026-11-10); the stable line is `v4.2.26` (2026-10-28).

## 2. Mesh: cost per participant

Topology definition: RFC 7667 section 3.4 "Point to Multipoint Using Mesh" (read, specified). Every endpoint sends its RTP to every other endpoint over separate transport flows.

Inputs (all read):
- Screen 1080p30 preset: 5,000,000 bps; 1080p15: 2,500,000; 720p15: 1,500,000; "original" resolution: 7,000,000 bps. Source: `livekit/client-sdk-js@0823288 src/room/track/options.ts:530-535` (`ScreenSharePresets`). Confidence high that these are LiveKit's defaults; they are one vendor's choice, not a standard.
- Camera top layer example: 1,500,000 bps at 30 fps. Source: LiveKit docs, https://docs.livekit.io/transport/media/advanced/ (vendor docs, medium-high).
- 4K: no preset exists in that file. A 4K screen bitrate is HYPOTHESIS; pixel count is 4x 1080p, bitrate does not scale linearly with pixels and depends on codec and content.

Derived uplink for one participant sharing a 5 Mbps screen to N-1 viewers (my arithmetic, proof level: specified topology + arithmetic, not measured):

| N | Screen only, upload | Screen + camera 1.5 Mbps, upload |
|---|---|---|
| 3 | 10 Mbps | 13 Mbps |
| 5 | 20 Mbps | 26 Mbps |
| 10 | 45 Mbps | 58.5 Mbps |
| 20 | 95 Mbps | 123.5 Mbps |
| 50 | 245 Mbps | 318.5 Mbps |

Why mesh breaks:

| Claim | Evidence | Proof level / confidence |
|---|---|---|
| Upload per sender grows as N-1 | RFC 7667 section 3.4 (each endpoint sends to every other) | specified, high |
| Download per viewer grows with number of active senders | same topology | specified, high |
| Each peer connection runs its own encoder, so encode CPU also grows as N-1 | forasoft.com and antmedia.io topology blogs (vendors of SFU products, bias: sell SFU). No browser source code read | HYPOTHESIS, low |
| Sources disagree on the practical ceiling (4 to 6 participants for video) and on whether CPU or bandwidth hits first | same blogs, no benchmark with method | HYPOTHESIS, low |
| A mesh has no server, so no server-side authority over who is present | follows from the topology; relates to F2, not measured here | specified (topology), medium |
| Mesh cannot do per-viewer quality adaptation by dropping a layer; each pair negotiates its own bitrate | follows from separate encoders per connection | HYPOTHESIS, low |

I found no controlled measurement of mesh CPU in a browser (see "Looked for and not found").

## 3. Topology definitions (specified)

| Topology | Definition | Server work | Source |
|---|---|---|---|
| Mesh | Endpoint sends to every other endpoint | none | RFC 7667 section 3.4 |
| Media-mixing mixer (MCU, audio mixing) | Decodes N streams, mixes, re-encodes one stream | decode + encode per participant | RFC 7667 section 3.6.1 |
| Media-switching mixer | Picks which source to send | low | RFC 7667 section 3.6.2 |
| Selective Forwarding Middlebox (SFU) | Per-endpoint RTP session; middlebox selects which sources go to which endpoint; each leg has its own SSRC space; handles RTCP codec control (FIR) and aggregates congestion feedback | forward and rewrite headers, no decode | RFC 7667 section 3.7 |
| Video-switching MCU | MCU variant switching one video | medium | RFC 7667 section 3.8 |
| Hybrid | Not defined as one topology; RFC 7667 section 3.12 "Combining Topologies" only states combinations are possible | both paths | RFC 7667 section 3.12 |

RFC 7667 is Informational (Nov 2015), https://www.rfc-editor.org/rfc/rfc7667, accessed 2026-11-16, confidence high, no vendor bias.

## 4. SFU and library candidates

Versions and dates are the latest GitHub release or tag as returned by `[gh API]` on 2026-11-16. Advisory column lists published GitHub Security Advisories for the repo itself (`security-advisories` endpoint); OSV was also queried (see note below the table).

| Candidate | Licence (SPDX) | Language | Latest version, date | Last push | Open advisory (repo's own) | Single Go binary | Redistribute in open source and host |
|---|---|---|---|---|---|---|---|
| Pion `webrtc/v4` | MIT | Go | v4.2.26, 2026-10-28; v5.0.0-rc.3, 2026-11-10 | 2026-11-16 | one published, fixed v3.0.15 (CVE-2021-28681) | yes, it is a library | yes |
| Pion `interceptor` | MIT | Go | v0.1.51, 2026-10-23 (tag date from release list) | 2026-11-11 | one published, fixed v0.1.39 (CVE-2025-49140) | yes | yes |
| Pion `dtls` | MIT | Go | v3.1.15 (tag), commit date 2026-10-20 | 2026-10 | 6 published 2026-10-16; fixed in v3.1.13 for the v3 ones; 2 apply to v2/v1 only | yes | yes |
| Pion `rtp` | MIT | Go | v1.10.6, 2026-10-21 | 2026-10-26 | none listed | yes | yes |
| Pion `bwe` | no licence detected by the API; repo has `LICENSES/MIT.txt` (REUSE layout) | Go | no tag | 2026-11-09 | none listed | yes | yes if MIT as the REUSE file indicates; verify per file |
| LiveKit server `livekit/livekit` | Apache-2.0 | Go | v1.13.11, 2026-10-25 | 2026-11-16 | none published | possible via `service.InitializeServer` | yes (Apache-2.0 permits redistribution and hosting) |
| LiveKit `client-sdk-js` | Apache-2.0 | TypeScript | v2.24.1, 2026-11-14 | 2026-11-16 | not queried | n/a (browser) | yes |
| Galene `jech/galene` | MIT | Go | galene-1.2.2, 2026-11-09 | 2026-11-09 | none published | an application; packages `group`, `rtpconn` etc. exist | yes |
| mediasoup | ISC | C++ worker + Node (also a Rust crate) | 3.32.2, 2026-11-04 | 2026-11-16 | 8 published; 3 on 2026-10-28/29 fixed in 3.32.1 (remote DoS aborting the worker); latest 3.32.2 | no (separate C++ process driven from Node or Rust) | yes |
| Janus `meetecho/janus-gateway` | GPL-3.0 + OpenSSL exception (COPYING) | C | v1.4.3, 2026-10-12 (commit date) | 2026-11-15 | 2 high on 2026-10-12 fixed in 1.4.3 | no | GPL-3.0: running it as a separate process is possible; linking it into our code makes our code GPL-3.0. Needs a legal read before use |
| Jitsi Videobridge | Apache-2.0 | Java/Kotlin | stable/jitsi-meet_11248, 2026-09-14 | 2026-11-16 | one critical 2021 (fixed) | no (JVM; usually with Jicofo and Prosody XMPP) | yes |
| `pion/ion-sfu` (redirects to `ionorg/ion-sfu`) | MIT | Go | v1.x tags | 2023-07-21 | not queried | library | yes, but not maintained for 3+ years |
| Cloudflare Realtime SFU | proprietary service | n/a | n/a | n/a | n/a | no, hosted HTTPS API | not self-hostable: fails F5 |

Notes on the table:
- OSV (`api.osv.dev/v1/query`) returned "none" for livekit v1.13.11, pion webrtc v4.2.26, dtls v3.1.15, dtls v3.1.9, interceptor v0.1.51 and galene 1.2.2. OSV also returned "none" for `pion/dtls v3.1.9`, while the GitHub advisories above list three issues fixed in v3.1.13 for v3 `< 3.1.13`. So OSV lags or does not map these; GitHub Advisory data is used here. Confidence: high for the GHSA entries, medium for the OSV "none".
- The Pion DTLS advisories GHSA-cqhp-ggp7-58qj and GHSA-hhpj-h56m-9f2p (client-auth bypass) state in the advisory text that they do not affect `webrtc` users. GHSA-7c2r-jhm9-43vf (signature scheme confusion, critical) and GHSA-jm57-r6vj-mwg9 (unbounded handshake cache, memory), GHSA-jp25-wc3w-p9xp (large RSA key, CPU) are fixed in 3.1.13; their text does not say they are excluded for WebRTC. Applicability to DTLS-SRTP use is therefore not excluded.
- LiveKit `v1.13.11` `go.mod` (read, `livekit/livekit@v1.13.11 go.mod`): `require pion/dtls/v3 v3.1.9`, `pion/webrtc/v4 v4.2.18`, `pion/ice/v4 v4.4.0`, `pion/interceptor v0.1.49`, with `replace` to `livekit/dtls/v3 v3.1.5-warp.3`, `livekit/webrtc-pion v4.2.18-warp.7`, `livekit/ice v4.4.0-warp.3`. The fork's tags run `v3.1.5-warp.1..3`; its last push is 2026-11-09. I did not diff it against upstream fixes. HYPOTHESIS: LiveKit v1.13.11 is exposed to the 3.1.13 fixes until a diff shows otherwise.
- Janus advisory list (read via `[gh API]`): GHSA-8qwr-6p52-4vj9 (Record&Play overflow) and GHSA-8vh6-wpj5-fm3c (SIP plugin use-after-free), both high, fixed 1.4.3.
- mediasoup `3.32.1` fixed remote DoS crashes of the worker by crafted RTP or SCTP packets. A media-plane crash from remote input is a relevant class for a public, login-free service.

## 5. Measured capacity (per core and bandwidth)

All figures are vendor or community numbers. I ran nothing. None is normalised by me except where marked "derived".

| Source | Setup | Result | Derived per core | Confidence, bias |
|---|---|---|---|---|
| LiveKit benchmark, https://docs.livekit.io/transport/self-hosting/benchmark/ | `c2-standard-16` (16 cores, Google Cloud), `lk load-test`, 720p looping clips, keyframe about every 3 s, simulcast on. Each room must fit one node | Large audio: 10 pubs, 3000 subs, 23 MBps out, 959,156 pkt/s out, 80% CPU. Large meeting: 150 pubs x 150 subs, 93 MBps out, 762,749 pkt/s out, 85% CPU. Livestream: 1 pub, 3000 subs, 531 MBps out, 560,962 pkt/s out, 92% CPU | audio about 60k pkt/s per core at 80%; meeting about 47.7k pkt/s and about 46.5 Mbps out per core at 85%; livestream about 35k pkt/s and about 265 Mbps out per core at 92% (my arithmetic, assuming even spread across cores) | medium; vendor; load generator separate machine not stated |
| LiveKit community report, https://community.livekit.io/t/load-test-at-1-000-participants-19-of-subscriber-connections-fail-with-could-not-establish-signal-connection-cpu-ram-not-saturated/1778 | 8 cores, load tester on the same host | 189 of 975 subscriber connections failed at 1000 participants with CPU about 60% | n/a | low; a connection limit appeared before CPU saturation |
| LiveKit blog, https://livekit.com/blog/going-beyond-a-single-core (2021-07-21) | Mac i7-8850H microbenchmark | `dt.WriteRTP` about 50 us per down track; serial fan-out 14.4 ms for 500 down tracks vs 9.9 ms load-balanced; production went from 400-500 to 1,600 down tracks | n/a | medium; old (2021) |
| mediasoup docs, https://mediasoup.org/documentation/v3/scalability/ | worker = one C++ subprocess on one core | "typically handle over ~500 consumers in total" depending on CPU; more than 200-300 viewers on one router may exceed it | about 500 consumers per core | medium; vendor; estimate, no method |
| mediasoup forum threads (search results, `mediasoup.discourse.group`) | user reports | 400 to 1,050 consumers per worker before saturation | n/a | low; anecdotal |
| Galene, https://galene.org/ | author's statement | lectures about 300 participants per core; meetings about 20 on one core, 40 on four; 100-student lecture about a quarter core | about 300 viewers per core (one-to-many) | medium; author's own claim, no method |
| Jitsi Videobridge evaluation, https://jitsi.org/jitsi-videobridge-performance-evaluation (date not on page) | quad-core Xeon E5-1620 v2 3.7 GHz, JVM 3 GB | 1056 streams at 550.4 Mbps mean, 20.3% mean CPU; 90 streams 47.6 Mbps 3.1% | n/a | medium; vendor; old hardware, no explicit codec or layer detail |
| OpenVidu, https://openvidu.io/3.8/docs/self-hosting/production-ready/performance/ | m6in.xlarge (4 vCPU); rooms of 8, 640x480 30 fps | claims mediasoup-based engine fits "almost double" the participants of LiveKit/Pion; no numeric table on the page | n/a | low; the author sells the mediasoup build |

What these tell the VPS owner (derived, proof level: read + arithmetic):
- Many-to-many scales with N x N downlinks. In the LiveKit 150x150 run, outbound was 93 MBps (about 744 Mbps) on 16 cores. A screen share to a large room is closer to the livestream row (one sender, many viewers): about 4.2 Gbps out for 3000 viewers at about 1.4 Mbps each.
- A 5 Mbps screen stream sent to 100 viewers needs about 500 Mbps egress; to 1000 viewers about 5 Gbps (arithmetic). Simulcast does not lower this for one viewer who wants the top layer.
- I could not find a single-source number for "Pion SFU per core" that is independent of a vendor.

## 6. Simulcast, SVC and codecs for screen content

| Topic | Fact | Evidence | Proof | Confidence |
|---|---|---|---|---|
| Scalability mode names | `L1T2, L1T3, L2T3, L3T3, L3T3_KEY, S2T3, S3T3` etc. are defined in the table in section 5 of the W3C WebRTC-SVC working draft (14 Sep 2026). The draft has no sentence that obliges a browser to support them | https://www.w3.org/TR/webrtc-svc/ | specified (draft) | high |
| Simulcast signalling | `a=simulcast` and RID are specified in RFC 8853 (section 5.1 Simulcast Attribute) and RFC 8851 (RID) | https://www.rfc-editor.org/rfc/rfc8853 | specified | high |
| LiveKit default SVC | With VP9 or AV1, SVC auto-activates with `L3T3_KEY`; Dynacast with SVC pauses whole streams only, not individual layers | https://docs.livekit.io/transport/media/advanced/ | read | medium (vendor) |
| LiveKit screen-share layers | `screenShareSimulcastLayers` option exists ("up to two additional simulcast layers"); presets in section 2 | `livekit/client-sdk-js@0823288 src/room/track/options.ts:84,122,526-535` | read | high |
| AV1 forwarding without decoding | An SFM "does not parse the AV1 bitstream"; it uses the Dependency Descriptor RTP header extension (Appendix A, section A.9 for SDP signalling) | AV1 RTP spec v1.0.0 Final Deliverable 15 Dec 2024, https://aomediacodec.github.io/av1-rtp-spec/v1.0.0.html (the fetch tool summary; I did not read the section text myself) | specified | medium |
| AV1 screen tools | `allow_screen_content_tools` and `allow_intrabc` (intra block copy) and a palette mode exist in the AV1 syntax | https://aomediacodec.github.io/av1-spec/ (spec page header "Last modified 2023-05-25", marked as a working document; section numbers not captured) | read | medium |
| Content hint | `contentHint` `"detail"` and `"text"` imply `maintain-resolution`; with AV1, `"text"` also turns on text-mode tools (section 4.3) | https://www.w3.org/TR/mst-content-hint/ (WD 19 Sep 2025) | specified (draft) | high |
| VP9 layer info in Pion | `pion/rtp@v1.10.6 codecs/vp9_packet.go` parses VP9 payload descriptor including `NS` (spatial layer count) at line 237 and 446 | `[gh API]` source | read | high |
| Dependency Descriptor in Pion | No Dependency Descriptor code in `pion/rtp@v1.10.6`; extension files present: abscapturetime, abssendtime, audiolevel, playoutdelay, transportcc, vla (tree listing) | `[gh API]` git tree | read | high |
| Dependency Descriptor in LiveKit | Implemented in `livekit/livekit@v1.13.11 pkg/sfu/rtpextension/dependencydescriptor/` and `pkg/sfu/buffer/dependencydescriptorparser.go`; codec mungers for VP8 and DD temporal layers in `pkg/sfu/codecmunger/` | `[gh API]` git tree | read | high |
| Which codec Chrome and Firefox actually send for screen share with SVC | Not verified in this scout | none | HYPOTHESIS | n/a |
| AV1 encode cost in browsers | Not verified in this scout (CPU and hardware support differ by device) | none | HYPOTHESIS | n/a |

Screen content note: LiveKit's `ScreenSharePresets` use 15 fps for 720p and 1080p (low-motion text) and 30 fps for the higher preset, so a vendor assumes the frame rate is the cheaper axis to drop. This is a preset choice, not a measurement.

## 7. Congestion control, loss and keyframes

| Topic | Fact | Evidence | Proof | Confidence |
|---|---|---|---|---|
| Pion default interceptors | `RegisterDefaultInterceptors` configures NACK generator and responder, RTCP reports, stats, and the TWCC sender | `pion/webrtc@v4.2.26 interceptor.go:23-73` | read | high |
| Pion congestion control packages | `pkg/gcc`, `pkg/cc`, `pkg/twcc`, `pkg/rfc8888`, `pkg/ccfb`, `pkg/nack`, `pkg/intervalpli`, `pkg/jitterbuffer`, `pkg/flexfec`, `pkg/pacing` exist | `pion/interceptor@v0.1.51` tree | read | high |
| GCC in Pion is slated to be replaced | Open pull request "Replace GCC and deprecate gcc and cc packages" (pion/interceptor #401, opened 2026-02-04, still open; draft until `pion/bwe` has a tag, and `pion/bwe` has no tag) | `[gh API]` | read | high |
| Open GCC bugs | #438 "GCC: Keep increase path monotonic"; #406 "GCC (NoOpPacer and other pacers) drop NACK RTX because of SSRC"; #416 "TWCC feedback packets exceeds MTU" | `[gh API]` issues, state open when listed | read | high that they were open on 2026-11-16 |
| GCC spec status | `draft-ietf-rmcat-gcc-02` (2017-01-09) and `draft-holmer-rmcat-transport-wide-cc-extensions-01` (2016-04-21): both are Internet-Drafts with no later revision. RFC 8888 is the standardised RTCP feedback for congestion control | datatracker API; https://www.rfc-editor.org/rfc/rfc8888 | specified | high |
| LiveKit congestion control | `congestion_control.enabled` default true; `use_send_side_bwe` default false (remote BWE from receiver reports is the default); pacer options `no-queue` (default), `pass-through`, `leaky-bucket` (accepted but "not currently wired to the bandwidth estimate", falls back with a warning); `allow_pause` may pause tracks | `livekit/livekit@v1.13.11 config-sample.yaml:120-141`; code in `pkg/sfu/bwe/{remotebwe,sendsidebwe}` | read | high |
| PLI | Picture Loss Indication is RFC 4585 section 6.3.1; FIR is RFC 5104 section 3.5.1 (semantics) and 4.3.1 (format). In an SFU the middlebox "decid[es] if it can act on the request locally or needs to translate" it to the source leg | RFC 4585, RFC 5104, RFC 7667 section 3.7 | specified | high |
| PLI throttling | LiveKit default throttles PLI/FIR per producer: low 500 ms, mid 1 s, high 1 s; the config text states longer intervals lengthen black screens when a viewer joins, shorter intervals raise bitrate | `config-sample.yaml:154-160` | read | high |
| Interval PLI | Pion `intervalpli` generates PLI at an interval, described as useful when no decoder is available | `pion/interceptor@v0.1.51 README.md:40` | read | high |
| SFU buffers | LiveKit keeps `packet_buffer_size_video` 500 packets, audio 200, for retransmission | `config-sample.yaml:150-153` | read | high |

Consequence to carry forward without deciding: with plain simulcast and no SVC, every new subscriber or layer switch needs a keyframe from the sender (PLI/FIR), which adds a burst to the sender's uplink; SVC/DD lets the SFU switch layers without one (LiveKit docs state "instant layer switching without waiting for keyframes"). The magnitude of the keyframe burst for a 1080p screen is HYPOTHESIS here.

## 8. WHIP / WHEP

| Fact | Evidence | Proof | Confidence |
|---|---|---|---|
| WHIP is RFC 9725 (March 2025, Standards Track): HTTP-based ingest of WebRTC content | https://www.rfc-editor.org/rfc/rfc9725 | specified | high |
| WHEP is `draft-ietf-wish-whep-05`, 2026-10 (the fetched page says 11 Oct 2026; datatracker says 2026-10-15), not an RFC; the draft text has no section on simulcast layer selection | https://datatracker.ietf.org/doc/html/draft-ietf-wish-whep | specified (draft) | high |
| Pion ships a WHIP/WHEP example (`examples/whip-whep`) and a `data-channels-whip-whep-like` example; README says OBS and GStreamer can publish via WHIP | `pion/webrtc@v4.2.26 examples/whip-whep/README.md` | read | high |
| Relevance to this project | WHIP/WHEP are one-to-many ingest/playback. They carry one offer/answer per HTTP request and have no room, roster or presence concept. They do not provide the "who is in the room" authority of F2 | RFC 9725 abstract, WHEP abstract | specified | medium (my reading) |

## 9. Cost: minimal SFU on Pion vs embedding LiveKit

Facts (all read from source trees, byte counts are non-test `.go` sizes from the git tree API):

| Item | Size | Evidence |
|---|---|---|
| Pion `sfu-ws` example `main.go` | 10,513 bytes | `pion/example-webrtc-applications/sfu-ws` (repo MIT, last push 2026-11-13) |
| Pion `broadcast` example (one uploader to many viewers) | README says it "could serve as the building block" for conferencing | `pion/webrtc@v4.2.26 examples/broadcast/README.md` |
| Galene whole application, non-test Go | about 309 KB, including web server, TURN server, groups, rtpconn, packet cache, estimator | `jech/galene@galene-1.2.2` tree |
| LiveKit `pkg/sfu` non-test Go | about 1.17 MB; whole repo about 3.98 MB | `livekit/livekit@v1.13.11` tree |
| LiveKit transitive pins | 154 required modules in `go.mod` (174 lines) | `livekit/livekit@v1.13.11 go.mod` |

What Pion provides vs what we would write (read; effort in person-weeks is HYPOTHESIS, no source measures it):

| Capability | Pion gives | We write for a Pion SFU | LiveKit gives |
|---|---|---|---|
| ICE, DTLS-SRTP, SDP, data channels, single UDP port (`examples/ice-single-port`) | yes | wiring, port policy | yes (port range or single UDP port) |
| NACK, RTCP reports, TWCC feedback | yes (default interceptors) | enable and tune | yes |
| Send-side bandwidth estimation per subscriber | GCC package, under replacement (PR #401) | choose, test, or write our own | own BWE (`pkg/sfu/bwe`) |
| Track fan-out, per-subscriber RTP rewriting (SSRC, sequence, timestamp) | primitives | write | yes (`forwarder.go`, rtpmunger) |
| Simulcast layer selection, keyframe-aligned switching | RID is exposed; no policy | write (VP8 picture-id/tl0 munging; per-codec) | yes (`codecmunger/vp8.go`, `ddtemporal.go`) |
| VP9 and AV1 SVC forwarding | VP9 descriptor parsing only; no Dependency Descriptor | write the DD parser and layer logic | yes (`rtpextension/dependencydescriptor`) |
| Active speaker, audio levels, dynacast (pause unseen layers) | `audiolevelextension` parser only | write | yes |
| Signalling, room state, reconnect/resume, participant eviction | no | write (this is the F1/F2 surface) | yes, with LiveKit's protocol and JWT access tokens; the server is the authority on participants |
| Embeds in a Go binary | yes | n/a | `service.InitializeServer(conf, node)` is exported (`pkg/service/wire.go:49`), `NewLocalNode` in `pkg/routing`; Redis is optional (set `redis:` only to run distributed) |
| TURN | `pion/turn` library | write wiring | built-in TURN configurable in `config-sample.yaml` (lines 95-119) |
| Client | raw WebRTC API in browser | write | `livekit-client` (Apache-2.0, v2.24.1) |
| Lock-in | none | none | LiveKit signalling protocol and room model, plus a fork-based Pion (`livekit/webrtc-pion`) |

Embedding LiveKit costs: adopting its config and protocol, tracking its pinned forks (see DTLS note in section 4), and a binary that links about 4 MB of Go source. Writing on Pion costs: every row marked "write" above, plus the interop testing across Chrome, Firefox and Safari that LiveKit and Galene already carry. Proof level for both: read. Not run: build size, memory per room, idle CPU.

## 10. Looked for and not found

- A controlled measurement of browser CPU and uplink for a full mesh with screen share at 1080p to 4K. Only vendor blogs; no method.
- An independent (non-vendor) benchmark of Pion forwarding capacity per core, including GC cost. The OpenVidu 2x claim has no numeric table.
- A primary source for Chrome's or Firefox's current default codec and layer structure for `getDisplayMedia` under SVC. Not verified.
- A published LiveKit benchmark for screen-share content at 1080p and above, or for VP9/AV1 SVC. Their table uses 720p camera clips.
- Open-source MCU candidates with current maintenance: none surfaced for WebRTC. Jitsi, mediasoup, LiveKit, Galene and Janus (except audio mixing plugins) are forwarding designs.
- Any source measuring a hybrid "mesh below N, SFU above N" system's cost.
- A diff showing whether `livekit/dtls v3.1.5-warp.3` includes Pion's 3.1.13 fixes.
- A licence file for `pion/bwe` that the GitHub API recognises; only `LICENSES/MIT.txt` is present.
- Galene's scaling claim method (the author's page gives numbers without setup).
- Jitsi's evaluation date (not on the page).
- Cloudflare Realtime pricing and limits: the pages fetched link to them but do not state figures; the service is not self-hostable in any case.

## 11. Questions only the owner can answer

1. What is the VPS plan: vCPU count, RAM, and the network port speed and monthly transfer quota? Egress, not CPU, sets the "no limit" ceiling (PR7).
2. Is a transfer cap or a provider fair-use policy acceptable, and what egress per month would count as "weighing on us"?
3. What does "no limit" mean in practice: 50, 500 or 5000 viewers of one screen share? The table in section 5 shows a 5 Mbps screen to 1000 viewers is about 5 Gbps.
4. Maximum screen quality that must work: 1080p30, 1440p, or 4K? Is dropping to 15 fps for text content acceptable?
5. May the project depend on a fork-based dependency tree (LiveKit pins `livekit/webrtc-pion`, `livekit/dtls`, `livekit/ice`), or must it use upstream Pion only?
6. Is a dependency on LiveKit's signalling protocol and token model acceptable, or must the room model stay entirely in our own code?
7. Is GPL-3.0 acceptable for a separately run component (Janus)? The project is open source, but the licence of the whole must be chosen first.
8. Is it acceptable that older or Safari browsers get a lower-quality or non-SVC path, if that is the cost of AV1/VP9 SVC?
9. Is a hybrid (mesh for 2 to 4 people) wanted for any reason other than saving server egress, for example privacy or latency?
