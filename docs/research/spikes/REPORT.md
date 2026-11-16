# Spike report (round 1, 2026-11-16)

Written by the lead from the experimenter's return, because the experimenter could not write this file. Sources and logs: `S1/`, `S2/`, `S3/`. Local Linux, Go 1.27, Docker; no cloud, no browser. Clients are Go stand-ins built on Pion, not browsers. Docker containers stood in for network namespaces (`unshare -n` was denied).

## S1: ghost removal (charter floor F1)

20 participants in one room per case; time from the event to the roster removal seen by the others.

| Case | Removal | Verdict against 21 s |
|---|---|---|
| clean leave | 0.01 s | pass |
| `kill -9` | 8.1-8.2 s | pass |
| `SIGSTOP` (frozen process) | 17.2 s | pass |
| app heartbeat stopped, Pongs alive | 18.9 s | pass |
| all traffic dropped | 17.1 s | pass |
| UDP only dropped, as specified | never in 45 s | **fail** |
| UDP only dropped, with the 12 s cap | 19.4-20.3 s | pass |

Cause of the failure: the client resumes over the socket that still works, the server resets its 15 s media timer, ICE fails again, and the cycle repeats. Amendment: a cap of 12 s outside ACTIVE, whatever happens in between. With it every case is at most 20.34 s. No pid was duplicated in any roster version. A 1 h run of 8 clients under 2% packet loss had zero removals.

Result: decision J-06 reaches "run" only with the amendment.

## S2: forwarding cost and TURN policy

Container limited to 1 CPU, synthetic RTP, 60 s.

| Room | CPU of one core | Memory |
|---|---|---|
| 30 with video, 9 tiles each | 35-40% | about 19 MB live heap per PeerConnection (mostly Pion NACK buffers), RSS 869 MB |
| 100 audio only | 44% | RSS 101 MB |

`GOMEMLIMIT=512MiB` on the video room raised CPU to 85.7%. The actor inbox never filled, but only control events pass through it, so that says little.

TURN: `PermissionHandler` receives only the peer IP, so another port on the SFU's own IP stayed reachable, against J-08 as first worded. A write filter on the relay socket blocks it. Loopback, v4-mapped loopback and RFC 1918 targets were refused; relayed media reached the mux. Host networking was shown on one host only.

## S3: LiveKit DTLS fork

`livekit/dtls v3.1.5-warp.3` carries none of the three fixes checked; `crypto.go` and `handshake_cache.go` are identical to pion v3.1.5. `govulncheck` reported six findings in `net/http` and `golang.org/x/net` and nothing about DTLS, because the Go vulnerability database has no entry for those advisories. Option (b) of OD-01 is closed for LiveKit v1.13.11.

## Not run

Real browsers (tab throttling, bfcache, Safari), the product SFU (only a stub), the VPS itself.
