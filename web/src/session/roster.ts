import type { Departure, GoneReason, Person } from "../signal/protocol";

/** The whole roster at the version the server stamped on it. */
export type Roster = { version: number; people: Person[]; quiet?: boolean };

/** Someone who left the view, with the name they had and why. */
export type Leaver = { pid: number; name: string; reason: GoneReason };

/** The result of offering a roster frame: ignored when stale, otherwise the new roster and what changed. */
export type RosterUpdate = { applied: false } | { applied: true; roster: Roster; arrived: Person[]; left: Leaver[] };

/** The roster before the first frame arrives. */
export const EMPTY_ROSTER: Roster = { version: 0, people: [] };

/** Applies a roster only when its version is greater than the last applied, so late or repeated frames change nothing. */
export function applyRoster(current: Roster, frame: { v: number; people: Person[]; gone: Departure[]; quiet?: boolean }): RosterUpdate {
  if (frame.v <= current.version) return { applied: false };
  const people = [...frame.people].sort((a, b) => a.slot - b.slot);
  const known = new Set(current.people.map((p) => p.pid));
  const present = new Set(people.map((p) => p.pid));
  const baseline = current.version === 0;
  const arrived = baseline ? [] : people.filter((p) => !known.has(p.pid));
  const reasons = new Map(frame.gone.map((d) => [d.pid, d.reason]));
  const left = baseline
    ? []
    : current.people.filter((p) => !present.has(p.pid)).map((p) => ({ pid: p.pid, name: p.name, reason: reasons.get(p.pid) ?? ("left" as const) }));
  return { applied: true, roster: { version: frame.v, people, ...(frame.quiet ? { quiet: true } : {}) }, arrived, left };
}
