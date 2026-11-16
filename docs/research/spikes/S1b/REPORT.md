# S1b: liveness matrix with a 4 s grace (2026-11-16)

Re-run of S1 with the owner's 4 s grace (ADR 0003). Go stand-in clients on Pion, Docker containers as network namespaces, one host clock, loopback-class latency (the added-delay run is marked). No browser.

## What changed against S1

- Go sources: **none**. `-grace` and `-cap` were already flags (`src/server/main.go`); only the values changed.
- `src/go.mod`: `golang.org/x/net` v0.50.0 -> v0.62.0 (`go get`), which also raised x/crypto to v0.58.0 and x/sys to v0.49.0. Built with Go 1.27.3, CGO off.
- Harness: container and network names renamed (`s1b-*`, network `s1bnet`, image `spike-net-s1b:1`); container ids written to `container_ids.txt` and removed by id only; cases `resume2`, `resume35` (3.5 s, the grace edge) and `resume5` (after the grace) replace `resume3`/`resume9`; `analyze.py` also reports time to ACTIVE again, ICE-connected time and clients that got the rejoin prompt; optional `DELAY` env adds netem delay on the 20 target containers; `healthy.sh` takes `SECS`, `SARGS` and collects its own logs.

## Timers

Grace 4 s. Cap 8 s outside ACTIVE (counted from the first entry into reconnecting). Unchanged from S1: no-frame 12 s, no-heartbeat 12 s, server Ping 4 s, app heartbeat 4 s, ICE disconnected 4 s + failed 4 s, connect limit 15 s, actor tick 0.25 s, client resume window 10.5 s.

## Commands

```
cd src && go get golang.org/x/net@v0.62.0 && CGO_ENABLED=0 go build -o ../bin/s1server ./server && CGO_ENABLED=0 go build -o ../bin/s1client ./client
cp harness/ev.py bin/ && docker build -t spike-net-s1b:1 harness && docker network create --subnet 172.30.0.0/24 s1bnet
SARGS="-grace 4s -cap 8s" timeout 1500 bash harness/matrix.sh $PWD/bin $PWD/logs/m8 clean kill9 sigstop hbstop dropall dropudp resume2 resume35 resume5
SARGS="-grace 4s -cap 6s" DELAY=300ms timeout 900 bash harness/matrix.sh $PWD/bin $PWD/logs/m6lat dropudp resume2 resume35 resume5
SECS=900 SARGS="-grace 4s -cap 8s" timeout 1200 bash harness/healthy.sh $PWD/bin $PWD/logs/healthy-15m-netem2pct
python3 -I harness/analyze.py <case dir>      # per case;  python3 -I harness/healthy_analyze.py <dir>
```

Each case: 20 targets plus 2 observers in one room, 20 repetitions per case (one per target), event fired on all 20 at once.

## Result: grace 4 s, cap 8 s (`logs/matrix-grace4-cap8`)

Time from the event to removal as seen by the observers (both observers agreed). Resume cases: time to ACTIVE again.

| Case | n | min | max | Verdict |
|---|---|---|---|---|
| clean leave | 20 | 0.001 s | 0.012 s | pass |
| `kill -9` | 20 | 4.006 s | 4.170 s | pass |
| `SIGSTOP` | 20 | 12.103 s | 13.044 s | pass |
| app heartbeat stopped, Pongs alive | 20 | 13.168 s | 14.831 s | pass |
| all traffic dropped | 20 | 12.081 s | 13.077 s | pass |
| UDP only dropped (removed by the cap) | 20 | 15.315 s | 16.317 s | pass |
| resume at 2 s | 20 of 20 ACTIVE | 2.004 s | 2.018 s | pass (none removed) |
| resume at 3.5 s (grace edge, extra) | 20 of 20 ACTIVE | 3.507 s | 3.514 s | pass |
| resume at 5 s (after grace) | 20 removed, 20 refused | 4.064 s | 4.166 s | pass (resume got close 4404, client shown the rejoin prompt) |

No duplicated pid in any roster version, no pid back after removal, roster version always increasing. Server transitions: kill9, resume5 `removed:timeout`; sigstop, dropall `ice-failed` then `timeout`; hbstop `no-hb` then `timeout`; dropudp `unhealthy-cap` x20.

Resume cost here: ICE connected 0.014 s after the resume started (same host). That is not representative of a real network.

## What I tried for the cap

1. Cap 8 s (first try): every case passes (table above).
2. Cap 6 s with 300 ms added delay on every target's egress (RTT about 300 ms; `logs/matrix-grace4-cap6-rtt300ms`):

| Case | n | min | max | Verdict |
|---|---|---|---|---|
| UDP only dropped | 20 removed | 14.183 s | 14.956 s | pass |
| resume at 2 s | 20 of 20 ACTIVE | 3.805 s | 3.840 s | pass |
| resume at 3.5 s | 19 ACTIVE, 1 removed | 5.306 s | 5.329 s | 1 failure, by the grace not the cap |
| resume at 5 s | 20 removed | 4.307 s | 4.551 s | pass |

At 300 ms RTT a resume takes about 1.5 s from its start (socket + join + ICE), so a resume started at 2 s is ACTIVE 3.8 s after the drop (0.3 s is the FIN reaching the server). One of 20 resumes started at 3.5 s reached the server after 4 s and was refused (`removed:timeout`); that is the 4 s grace with latency, not the cap, and the owner should expect it. The cap never fired on a legitimate resume. Resume completion at the grace edge came about 5.0 s after the server entered reconnecting, so a 6 s cap leaves about 1 s of margin, not enough to absorb a slower network. **Recommended cap: 8 s** (3 s over that measured worst legitimate resume of about 5.0 s). Not measured: 7 s, and any RTT above 300 ms.

## Healthy run: 15 min, 8 clients, 2% netem loss each way, grace 4 s, cap 8 s

`logs/healthy-15m-netem2pct`: **zero removals, zero reconnecting states** on the server (8 transitions in total, all `connecting>active`) and in the 72 roster messages seen by clients. No duplicate roster versions, all 8 final rosters equal, `inbox_full` 0. netem dropped 527 of 26,346 packets on the server interface and 978 of 47,470 on a client (2%). No false removal. Only 15 minutes, not the 1 h of S1.

## Bound to publish

Max observed 16.317 s (UDP only dropped), rounded up: **17 s**.

Worst case from the timers (tick 0.25 s):
- UDP only dropped: first leaving ACTIVE at ICE failure, at most about 8.2 s (observed max 8.18 s; 4 s disconnected + 4 s failed) + cap 8 s + tick 0.25 s = about 16.5 s.
- heartbeat stopped: no-heartbeat 12 s + tick 0.25 s + grace 4 s + tick 0.25 s = 16.5 s (observed max 14.83 s, because the freeze did not hit right after a heartbeat).
- SIGSTOP / all traffic dropped: ICE 8 s (observed up to 8.9 s) + grace 4 s + tick = about 13.2 s.
- kill -9: 4 s + tick = 4.25 s.

17 s covers both 16.5 s worst cases with 0.5 s to spare. The previous 20.34 s bound drops to 17 s.

## Failures and gaps

- First launch of the matrix produced empty results: `ev.py` was not in the bin directory (harness fault). Discarded and re-run in full; only the re-run is saved.
- One resume at 3.5 s refused under 300 ms RTT (above).
- Not tested: any real browser (frozen tab, killed tab, throttled timers, `visibilitychange`), real NAT or TURN, RTT above 300 ms, loss during a resume, jitter, a 1 h healthy run, caps between 6 and 8 s, rooms larger than 20+2 clients, repeated runs on a loaded host. The ADR condition "after browsers are killed and frozen for real" is still open.
