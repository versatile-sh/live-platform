# Charter: live.versatile.sh architecture

Released by the owner on 2026-11-16 ("pode ser feliz com tudão aí"). Changed only by the owner.
Method: `agents-control-research/docs/methodology.md`, lean form (scout, one round, spikes, audit).

## 1. Decision

Which architecture `live.versatile.sh` is built on: media topology, signalling transport, liveness model, relay, security model, audio pipeline, transcription placement and frontend stack. It does not decide the visual design or the feature order.

## 2. Judged by

| Kind of user | Cares about |
|---|---|
| Participant | joins from a link with no install, no ghost tiles, no "waiting for connection" forever, good voice |
| Room owner | public or password room, lobby listing, removing people |
| Operator (Versatile, one VPS) | CPU, RAM and bandwidth per room; one deploy; no paid dependency |
| Self-hoster (the project is open source) | one binary or one compose file, no third-party account |
| Security reviewer | every trust boundary validated, no known-vulnerable dependency |

## 3. Unit and axes

Unit: one architectural decision (D-01...). Axes: options considered, recommendation, proof level (read, specified, run), evidence, cost to the operator, what reopens it.

## 4. Scope

| In focus | Mapped for later | Out |
|---|---|---|
| mesh vs SFU vs hybrid; Go server (gnet vs net/http and WebSocket libraries; Pion); liveness and ghost removal; reconnection; TURN/ICE on one VPS; room passwords, lobby with country; React stack and its vulnerabilities; system audio capture per OS; noise suppression; transcription on the server vs the browser | recording, whiteboard, camera effects, extension model | native apps, accounts and login, payments |

## 5. Floors

- F1. A participant whose browser closes, crashes, loses network or loses the socket leaves the room for everyone within a bounded, stated time. No ghost tile, no eternal "connecting".
- F2. The server is the single authority on who is in a room.
- F3. No login. No install for the end user; where an OS makes system audio impossible without one, a documented helper is allowed.
- F4. Open source: no secret in the repo, no dependency with a known unpatched vulnerability, nothing whose licence forbids open distribution or hosting.
- F5. Self-hosting works with no paid third-party service.
- F6. Backend in Go. Frontend in React.

## 6. Premises

| Id | Premise | Class | Declared by | Evidence | Overturned by |
|---|---|---|---|---|---|
| PR1 | Room size has no fixed limit "if it does not weigh on us" | demand | owner, 2026-11-16 | owner answer | measured cost per participant that one VPS cannot carry |
| PR2 | It runs on the same VPS as versatile.sh, at `live.versatile.sh/{roomslug}`, taken out of the Cloudflare Tunnel so ports can be opened | business | owner, 2026-11-16 | owner answer | a port or UDP need the VPS provider blocks |
| PR3 | gnet is a good fit for the backend | frame | owner (as an idea, "pensei em usar") | HYPOTHESIS | gnet lacking TLS, HTTP or WebSocket support, or Pion needing its own sockets |
| PR4 | Peer-to-peer or plain WebSocket can carry the media | frame | owner (as an idea) | HYPOTHESIS | upload and CPU cost of a mesh above a few people |
| PR5 | Transcription can run on our server "if it is not too heavy"; the owner is consulted before hosting it | business | owner, 2026-11-16 | owner answer | measured real-time factor on CPU |
| PR6 | Feature parity with `meucontrole-ai/screen-call` is the target; its engineering is not a reference | frame | owner, 2026-11-16 | owner answer | — |
| PR7 | VPS size is unknown to the study (Contabo `vmi3756348`) | current state | lead | `hosting/README.md` | the owner stating the plan |

## 7. Proof

Topology, liveness and transport recommendations need at least "specified"; the liveness floor F1 needs "run". Experiments: local only, in a temporary directory outside every repo, no cloud, no real credentials; may download Go modules, npm packages and public model files; stop only PIDs the experiment started. The machine has Go 1.27, Node 26, Docker.

## 8. Sources

Specs (W3C WebRTC, RFC 8445, 7675, 8656, 9725), source code and docs of the candidates at a recorded version, vendor docs, issue trackers. Feature reference: a clone of `meucontrole-ai/screen-call` (features only).

## 9. Frozen material

The engineering of `screen-call` (its `server/` and P2P design) is not a proposal to anchor on. Seats read its README feature list only.

## 10. Seats

| Seat | Lens | Model |
|---|---|---|
| robustness | correctness under failure, security | opus |
| operator-skeptic | cost on one VPS, simplicity, self-hosting | opus |
| judge | decides, wrote no proposal | opus |
| experimenter | runs the spikes | sonnet |
| auditor | not the judge; samples evidence | opus |

## 11. Budget and checkpoints

One scout (5 agents), one round (2 seats, judge, experimenter, auditor). Checkpoint with the owner at the end, as a grilling session that writes the ADRs.

## 12. Stop criteria

`methodology.md` §4, on one round; unmet criteria are written in the synthesis as open.

## 13. Deliverables

`scout/*.md`, `round1/*.md`, `spikes/`, `SYNTHESIS.md` with owner decisions, then `docs/adr/`.

## 14. Owner answers

| Date | Question | Answer, as given |
|---|---|---|
| 2026-11-16 | Room size | "se não for pesar pra gente, sem limites" |
| 2026-11-16 | Network and relay | "tudo liberado, vai ser na mesma vps da versatile.sh, ai vai ser o live.versatile.sh{roomslug} ai a gente só tira esse do tunel e boa" |
| 2026-11-16 | Research depth | lean: scout + 1 round + spikes |
| 2026-11-16 | v1 scope | all features of the meucontrole screen app, solid core, "muita engenharia por trás e garantia de segurança e robustez"; good voice filter; transcription on our server if not heavy, consult before hosting; no forced install, a tutorial where Linux needs a helper |
| 2026-11-16 | Look | minimal and elegant on the versatile.sh premise, with the adaptable.chat typography and chat-bubble aesthetic, not the serif identity |
