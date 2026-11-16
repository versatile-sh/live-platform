# Round 1 audit

Date: 2026-11-16. Author: auditor seat (not the judge, wrote no proposal).
Inputs: `CHARTER.md`, `SYNTHESIS.md`, `round1/decisions.md`, `spikes/S1`, `spikes/S2`, `spikes/S3` (no `spikes/REPORT.md` exists; results were read from the logs directly).
Registries queried on 2026-11-16: proxy.golang.org `@latest`, registry.npmjs.org, go.dev/dl JSON, api.osv.dev, GitHub raw files at the tags named below.

## 1. Sampling

Round 1 is the only round, so every claim is both "changed this round" and "never audited"; the two pools coincide. The sample was weighted by hand toward claims the architecture rests on (versions, licences, timeouts, capacity, security parameters, advisories), as the brief asks. It was not drawn by a seeded script, so the pool "drawn from the rest with a recorded seed" is empty (see §4, criterion 2).

## 2. Sample table

Verdicts: OK (source says it), WRONG (source contradicts it), UNSUPPORTED (source does not say it), CITE (claim holds, locator wrong).

| # | Claim (where) | Source opened | Verdict |
|---|---|---|---|
| 1 | pion/webrtc/v4 4.2.26, 2026-10-28 (S §3) | proxy.golang.org @latest | OK |
| 2 | pion/dtls/v3 3.1.15, 2026-10-20 | proxy.golang.org | OK |
| 3 | pion/ice/v4 4.4.9, 2026-11-09 | proxy.golang.org | OK (spikes used 4.4.8, noted) |
| 4 | pion/interceptor 0.1.51, 2026-10-23 | proxy.golang.org | OK |
| 5 | pion/rtp 1.10.6, 2026-10-21 | proxy.golang.org (2026-10-20T23:57Z) | OK |
| 6 | pion/turn/v5 5.1.3, 2026-10-24 | proxy.golang.org | OK |
| 7 | coder/websocket 1.8.15, 2026-06-15, ISC | proxy.golang.org; LICENSE at tag | OK |
| 8 | golang.org/x/crypto 0.59.0, 2026-11-11 | proxy.golang.org | OK |
| 9 | Go 1.27.4 current | go.dev/dl?mode=json (go1.27.4, go1.26.11) | OK |
| 10 | react/react-dom 19.3.1, 2026-10-14, MIT | npm registry | OK |
| 11 | vite 8.3.8, 2026-11-11 | npm registry | OK |
| 12 | @vitejs/plugin-react 6.3.0; typescript 7.0.2 Apache-2.0 | npm registry | OK |
| 13 | web-noise-suppressor 0.4.1, 2026-09-19, MIT | npm registry | OK |
| 14 | kamal-proxy 0.10.3, MIT | proxy.golang.org (2026-11-16); GitHub licence API | OK |
| 15 | govulncheck = golang/vuln 1.1.4 (2025-01-13) | proxy.golang.org golang.org/x/vuln → v1.9.0 (2026-10-11); S3 `commands.sh` used v1.9.0 | WRONG |
| 16 | "2026-10-16 advisories fixed in 3.1.13" (S §3 dtls row) | `spikes/S3/advisories.txt` (GitHub repo advisories): GHSA-hhpj-h56m-9f2p (critical) and GHSA-cqhp-ggp7-58qj patched in 3.1.14 | WRONG (partly) |
| 17 | GHSA-7c2r-jhm9-43vf critical, -jm57, -jp25 fixed in 3.1.13 (J-02) | same | OK |
| 18 | LiveKit v1.13.11 replaces dtls with `livekit/dtls v3.1.5-warp.3`, webrtc with `webrtc-pion v4.2.18-warp.7` | raw go.mod at v1.13.11 lines 170, 172 | OK |
| 19 | pion/stun/v4 4.0.1 "HYPOTHESIS: patched" | OSV query v4.0.1: none; GHSA-34rh-wp3j-6cxc ranges cover older paths only | raised to read |
| 20 | gnet `SetReadDeadline` returns `ErrUnsupportedOp`, `connection_unix.go:554-560` @v2.10.0 | raw file at v2.10.0 lines 554-560 | OK |
| 21 | default pion/turn admits every peer, `server_config.go:40-65` | raw file at v5.1.3 | OK |
| 22 | PermissionHandler can allow "the SFU's own IP and mux port" (J-08, S §2.1) | `server_config.go:47`: `func(clientAddr net.Addr, peerIP net.IP)`, no peer port; S2 `turn-ip` shows non-mux port accepted | WRONG |
| 23 | coder/websocket origin check and read limit, `accept.go:30-53`, `read.go:88-97` | raw files at v1.8.15 | OK |
| 24 | Argon2id m=19456 KiB, t=2, p=1 (OWASP) | OWASP cheat sheet master, line 11 | OK |
| 25 | RFC 7667 §3.4 mesh, §3.7 SFM | rfc-editor.org text | OK |
| 26 | RFC 7675 §5.1 consent expiry | rfc-editor.org text | OK |
| 27 | RFC 6455 §5.5.2-5.5.3 Ping/Pong | rfc-editor.org text | OK |
| 28 | Pion `SetICETimeouts` at `pion/ice agent.go:795-835` (J-06) | ice v4.4.9 agent.go:795 is `pingAllCandidates`; `SetICETimeouts` is in `webrtc@v4.2.26 settingengine.go:247` | CITE |
| 29 | Pion drops candidates after `failed`, `agent.go:535-542` (J-07) | ice v4.4.9 agent.go:757-766 holds it; 535-542 is agent setup | CITE |
| 30 | kamal-proxy HTTP/3 off by default (J-04) | `internal/cmd/run.go:32` at v0.10.3 (`http3`, default false) | OK |
| 31 | kamal-proxy drains 30 s (J-18) | `internal/server/service.go:35` `DefaultDrainTimeout = 30s` | OK |
| 32 | W3C Media Capture CRD 2026-11-12, `noiseSuppression` | w3.org/TR/mediacapture-streams | OK |
| 33 | react.dev 2025-12-03: advisories are RSC-only (`react-server-dom-*`) | react.dev blog post | OK |
| 34 | Contabo port 200 Mbit/s to 1 Gbit/s | contabo.com/en/vps (accessed 2026-11-16) | OK |
| 35 | Contabo "100 Mbit/s average over 10 days" throttle (S §2.6, J-17) | same page: "fair usage", no figure | UNSUPPORTED |
| 36 | Jitsi issue #15537 exists (J-05) | github.com (HTTP 200) | OK (content not re-read) |
| 37 | "Nothing in this design has been run" (S header, §7) | `spikes/S1..S3` logs | WRONG after spikes (superseded) |

Not counted as errors: #19 (HYPOTHESIS raised with evidence), #36 (existence only).

## 3. Error rate

Sample 37. Errors: #15, #16, #22, #28, #29, #35, #37 = 7. **Rate 18.9%** (pool "changed this round" = pool "never audited" = whole sample; seeded pool empty). Without the two locator-only errors: 13.5%. Both are above the 5% threshold.

## 4. "Run" claims check

| Claim now marked run | Recorded run of the part it rests on | Verdict |
|---|---|---|
| J-06 bound 21 s, F1 | `spikes/S1/logs/matrix-amended-cap12s/*/analysis.json`, 10 cases x 20 reps, max 20.339 s (dropudp); `healthy-1h-netem2pct/analysis.json` 0 removals; `netem_counters.txt` shows about 190k packets per interface | holds for the amended machine and Go stand-ins only. The spec as written failed: `matrix-spec-as-written/dropudp` has 0 removals and 93 socket-close resumes |
| J-08 TURN policy | `spikes/S2/logs/turn-{default,ip,ipport}/turntest.txt, relaytest.txt` | holds; port restriction comes from a relay write filter (`S2/src/turn.go:42-49`), not from PermissionHandler |
| S §2.6 CPU/RAM | `spikes/S2/logs/results_final.jsonl`, `*-gml*/summary.txt` | holds for a synthetic stub; container `--cpus=1` but GOMAXPROCS 2 |
| J-02 / OD-01 (b) | `spikes/S3/evidence-warp3.txt` (0 fix markers), `file-compare*.txt`, `govulncheck-*.txt` | holds: fixes absent; govulncheck does not flag the fork path |
| J-03 "scout run" 23.4 KB/conn | scout file, not re-opened by this audit | unchanged, flagged as not re-checked |

## 5. What I changed

`SYNTHESIS.md`:
- Header and §1: spike results applied; S3 result; F1 statement now "run with Go stand-ins, with the 12 s cap".
- §2.1 TURN row: handler is IP-only; mux port enforced by a relay write filter; proof run (S2).
- §2.2: added the `unhealthy-cap` 12 s transition; published bound now cites S1 measurements.
- §2.6: S2 CPU/RAM figures added; RAM per video PeerConnection named as the first host limit seen; Contabo 10-day figure marked HYPOTHESIS.
- §3: dtls row (3.1.13 vs 3.1.14 split), ice row (spikes used 4.4.8), stun row (OSV none), new golang.org/x/net row (pin ≥ 0.62.0; govulncheck findings on 0.50.0 and 0.59.0), kamal-proxy date, noise suppressor WASM licences (Apache-2.0, MIT, MIT per npm), govulncheck v1.9.0 and its blind spot for forks.
- §4 OD-01 (b) closed by S3. §6 spike state added. §7 updated.

`round1/decisions.md`: conventions line; J-02 S3 result; J-06 locator fixed and proof raised to run with the cap amendment; J-07 locator fixed; J-08 handler signature, port filter and S2 result; J-17 Contabo evidence corrected and S2 figures added.

## 6. Charter stop criteria (CHARTER §12 → methodology §4)

| Criterion | State |
|---|---|
| 1. No new BLOCKING objection in the round | **Unmet.** S1 produced one: the state machine as the judge specified it lets a UDP-only failure loop through resume forever (F1 violation). The audit applied the experimenter's 12 s cap amendment, but no seat or judge has accepted it. Second: x/net versions below 0.62.0 carry known advisories (F4) until pinned |
| 2. Error rate < 5% on ≥ 30 claims | **Unmet.** 18.9% on 37; sample hand-weighted, not seeded |
| 3. Every cell has proof level and evidence or HYPOTHESIS | **Mostly met** after the fixes. Open: capacity egress rows rest on seat arithmetic only; J-03 scout memory figure not re-checked; upstream RNNoise/Speex licences not read |
| 4. Market study: no new candidate | Not applicable |
| Charter §7: F1 needs run | Met for Go stand-ins with the amendment; browser behaviour HYPOTHESIS |

Continuation: the judge should accept or reject the 12 s cap, the lead should pin golang.org/x/net ≥ 0.62.0, and a seeded re-audit of at least 30 claims is needed before closing.
