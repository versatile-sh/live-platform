---
status: accepted
---
# The server alone decides who is in a room, and removes the vanished within a published bound

The product exists because rooms kept ghosts. One actor per room owns every participant's state; three detectors (socket silence, application heartbeat, ICE failure) only report to it, and nothing a browser says can keep a participant present. The owner accepted a short labelled wait rather than instant removal, so that a network switch does not cost someone their place, and asked for the wait to be visible at once.

- A participant is shown as **unstable** on the first missed signal and as **reconnecting** during the grace.
- The grace is 4 s. A participant who has been outside the active state for longer than a fixed cap is removed whatever happened in between.
- The page of the affected participant says its connection dropped and, when retries end, offers to rejoin. It never shows an endless "connecting".

## Consequences

- The cap exists because the first design failed: with UDP blocked and the socket alive, a participant resumed, failed media and resumed again forever (`docs/research/spikes/S1`, case `dropudp`). Any change to the timers must re-run that matrix.
- Timers: 4 s grace, 8 s cap outside active, silence threshold 12 s. Measured on Go stand-in clients, 20 repetitions per case (`docs/research/spikes/S1b`): the worst case was 16.32 s (UDP only dropped), a killed process left in 4.2 s, and a 15-minute run under 2% packet loss removed nobody. The removal bound is **17 s** for those clients.
- A resume started at the edge of the grace on a 300 ms round trip can arrive too late and be refused; the participant then rejoins.
- Not measured: real browsers killed and frozen, a real NAT or TURN, round trips above 300 ms. The bound is not published to users before the browser run.
