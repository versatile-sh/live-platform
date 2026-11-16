import type { ErrorCode, GoneReason, ServerFrame } from "../signal/protocol";
import { EMPTY_ROSTER, applyRoster, type Roster } from "./roster";

/** Why my connection ended for good. Every kind has its own plain message and none loops. */
export type EndReason =
  | { kind: "left" }
  | { kind: "superseded" }
  | { kind: "removed" }
  | { kind: "banned" }
  | { kind: "refused"; code: ErrorCode }
  | { kind: "dropped-by-server"; reason: GoneReason }
  | { kind: "server-closed" }
  | { kind: "expired" }
  | { kind: "disconnected" }
  | { kind: "unreachable" }
  | { kind: "flood" }
  | { kind: "bad-frame" };

/** What cut the connection while it was still worth retrying. */
export type DropCause = "network" | "dead" | "silent" | "slow" | "no-hello";

/** A short-lived line shown and announced when the room changes. */
export type Notice =
  | { id: number; kind: "arrived"; name: string }
  | { id: number; kind: "left"; name: string; reason: GoneReason }
  | { id: number; kind: "refused"; code: ErrorCode };

/** What I know of the room while I am in it. */
export type Presence = { me: number; roster: Roster; notices: Notice[]; nextNotice: number };

/** My connection as a state machine: each phase carries exactly the data it can have. */
export type Connection =
  | { phase: "idle" }
  | { phase: "joining"; resuming: boolean }
  | ({ phase: "joined" } & Presence)
  | ({ phase: "reconnecting"; cause: DropCause; since: number; attempts: number } & Presence)
  | { phase: "ended"; reason: EndReason };

export type ConnectionEvent =
  | { type: "start"; resuming: boolean }
  | { type: "joined"; pid: number }
  | { type: "roster"; frame: Extract<ServerFrame, { t: "roster" }> }
  | { type: "dropped"; cause: DropCause; at: number }
  | { type: "attempt" }
  | { type: "gave-up" }
  | { type: "end"; reason: EndReason }
  | { type: "notice-expired"; id: number }
  | { type: "owner-refused"; code: ErrorCode };

/** The state before anything has happened. */
export const IDLE: Connection = { phase: "idle" };

const MAX_NOTICES = 4;

type NoticeBody = Notice extends infer N ? (N extends { id: number } ? Omit<N, "id"> : never) : never;

function addNotices(presence: Presence, items: NoticeBody[]): Presence {
  if (items.length === 0) return presence;
  const notices = items.map((item, i) => ({ ...item, id: presence.nextNotice + i }) as Notice);
  return { ...presence, notices: [...presence.notices, ...notices].slice(-MAX_NOTICES), nextNotice: presence.nextNotice + items.length };
}

function takePresence({ me, roster, notices, nextNotice }: Presence): Presence {
  return { me, roster, notices, nextNotice };
}

function onRoster(state: Extract<Connection, { phase: "joined" }>, frame: Extract<ServerFrame, { t: "roster" }>): Connection {
  const update = applyRoster(state.roster, frame);
  if (!update.applied) return state;
  const mine = frame.gone.find((d) => d.pid === state.me);
  if (mine) return { phase: "ended", reason: mine.reason === "removed-by-owner" ? { kind: "removed" } : mine.reason === "banned-by-owner" ? { kind: "banned" } : { kind: "dropped-by-server", reason: mine.reason } };
  const next = addNotices({ ...takePresence(state), roster: update.roster }, [
    ...update.arrived.filter((p) => p.pid !== state.me).map((p) => ({ kind: "arrived" as const, name: p.name })),
    ...update.left.map((l) => ({ kind: "left" as const, name: l.name, reason: l.reason })),
  ]);
  return { phase: "joined", ...next };
}

/** The pure transition function of my connection. An event that makes no sense in the current phase leaves it unchanged. */
export function reduceConnection(state: Connection, event: ConnectionEvent): Connection {
  switch (event.type) {
    case "start":
      return state.phase === "idle" || state.phase === "ended" ? { phase: "joining", resuming: event.resuming } : state;
    case "joined":
      if (state.phase === "joining") return { phase: "joined", me: event.pid, roster: EMPTY_ROSTER, notices: [], nextNotice: 1 };
      if (state.phase === "reconnecting") return { phase: "joined", ...takePresence({ ...state, me: event.pid }) };
      return state;
    case "roster":
      return state.phase === "joined" ? onRoster(state, event.frame) : state;
    case "dropped":
      if (state.phase === "joined") return { phase: "reconnecting", cause: event.cause, since: event.at, attempts: 0, ...takePresence(state) };
      if (state.phase === "reconnecting") return { ...state, cause: event.cause };
      if (state.phase === "joining") return { phase: "ended", reason: { kind: "unreachable" } };
      return state;
    case "attempt":
      return state.phase === "reconnecting" ? { ...state, attempts: state.attempts + 1 } : state;
    case "gave-up":
      return state.phase === "reconnecting" ? { phase: "ended", reason: { kind: "disconnected" } } : state;
    case "end":
      return state.phase === "idle" || state.phase === "ended" ? state : { phase: "ended", reason: event.reason };
    case "notice-expired":
      return state.phase === "joined" || state.phase === "reconnecting" ? { ...state, notices: state.notices.filter((n) => n.id !== event.id) } : state;
    case "owner-refused":
      return state.phase === "joined" ? { phase: "joined", ...addNotices(takePresence(state), [{ kind: "refused", code: event.code }]) } : state;
  }
}
