# A neutral policy seam decides what may happen

Status: accepted (2026-11-17)

## Context

Products built on this server need to restrict rooms (who may create one, who may enter, which sources may start, how much media one sends). The core must keep working with no limits and must never name a plan, price or customer.

## Decision

`ports/outbound.Policy` answers `Decide(Ask) Verdict` for `ActCreateRoom`, `ActAdmit` and `ActStartSource`, and `Ceiling(slug, identity)` for media caps. `presence.Governed` wraps `inbound.Presence`: a denied create or admit returns `PERMISSION_DENIED` with the policy's neutral reason; a denied source has its flag dropped before the room sees it. The composition root wires `outbound.AllowAll`, so behaviour is unchanged.

`Policy` is called on the signalling path and must answer from memory; a remote product keeps its own cache behind the adapter. `Ask.Identity` stays empty until an identity port carries an opaque subject.

## Consequences

- The create check reads `Status` before `Join`, so two first arrivals may both be asked as creators. Acceptable: the answer is the same for both.
- `Ceiling` is defined but not yet applied by the media plane; a later change caps the SFU's forwarding and sends a notice over lv.1.
- A refused source is silent on the wire today; the in-room notice is a later lv.1 message.
