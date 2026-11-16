/** The only signalling subprotocol this client speaks. */
export const SUBPROTOCOL = "lv.1";

/** Frames that arrive faster than this rate make the server close the socket. */
export const MAX_FRAMES_PER_SECOND = 20;

export type PersonState = "connecting" | "active" | "reconnecting";

export type GoneReason = "left" | "removed-by-owner" | "banned-by-owner" | "timeout" | "media-timeout" | "unhealthy-cap" | "unknown";

export type ErrorCode = "INVALID_ARGUMENT" | "NOT_FOUND" | "CONFLICT" | "PERMISSION_DENIED" | "RATE_LIMITED" | "BANNED" | "INVARIANT_VIOLATION" | "INTERNAL";

export type Person = { pid: number; slot: number; name: string; state: PersonState; flags: number; look?: string; face?: string };

export type Departure = { pid: number; reason: GoneReason };

export type ServerFrame =
  | { t: "joined"; pid: number; gen: number; secret: string }
  | { t: "roster"; v: number; people: Person[]; gone: Departure[]; quiet?: boolean; locked?: boolean }
  | { t: "error"; code: ErrorCode; message: string }
  | { t: "chat"; pid: number; to?: number; name: string; text: string; at: number; img?: string }
  | { t: "photo"; pid: number; data: string }
  | ({ t: "rtc" } & RtcSignal)
  | { t: "board"; pid: number; data: unknown }
  | { t: "hb" };

/** One step of setting up media: a session description or a network candidate, for the connection I publish on or the one I am sent the room on. */
export type RtcSignal = { role: "pub" | "sub"; kind: "offer" | "answer" | "ice"; sdp?: string; candidate?: string; sources?: Record<string, string> };

export type Hello =
  | { t: "join"; slug: string; name: string; verifier?: string; listed?: boolean; look?: string; face?: string }
  | { t: "resume"; slug: string; pid: number; secret: string };

export type OwnerOp =
  | { op: "remove"; pid: number }
  | { op: "ban"; pid: number }
  | { op: "mute-all" }
  | { op: "unmute-all" }
  | { op: "mute"; pid: number }
  | { op: "allow"; pid: number }
  | { op: "lock-board" }
  | { op: "unlock-board" }
  | { op: "draw-deny"; pid: number }
  | { op: "draw-allow"; pid: number }
  | { op: "transfer"; pid: number }
  | { op: "listed"; listed: boolean }
  | { op: "password"; verifier?: string };

export type ClientFrame = Hello | { t: "hb" } | { t: "media"; flags: number } | { t: "chat"; text: string; to?: number; data?: string } | { t: "board"; board: string; to?: number } | { t: "look"; look: string; face: string } | { t: "photo"; data: string } | ({ t: "rtc" } & RtcSignal) | { t: "leave" } | ({ t: "owner" } & OwnerOp);

const PERSON_STATES: readonly string[] = ["connecting", "active", "reconnecting"];
const GONE_REASONS: readonly string[] = ["left", "removed-by-owner", "banned-by-owner", "timeout", "media-timeout", "unhealthy-cap"];
const ERROR_CODES: readonly string[] = ["INVALID_ARGUMENT", "NOT_FOUND", "CONFLICT", "PERMISSION_DENIED", "RATE_LIMITED", "BANNED", "INVARIANT_VIOLATION"];

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePerson(raw: unknown): Person | undefined {
  if (!isFields(raw)) return undefined;
  const { pid, slot, name, state, flags, look, face } = raw;
  if (typeof pid !== "number" || typeof slot !== "number" || typeof name !== "string" || typeof flags !== "number") return undefined;
  if (typeof state !== "string" || !PERSON_STATES.includes(state)) return undefined;
  return { pid, slot, name, state: state as PersonState, flags, ...(typeof look === "string" && look !== "" ? { look } : {}), ...(typeof face === "string" && face !== "" ? { face } : {}) };
}

function parseDeparture(raw: unknown): Departure | undefined {
  if (!isFields(raw) || typeof raw.pid !== "number" || typeof raw.reason !== "string") return undefined;
  return { pid: raw.pid, reason: GONE_REASONS.includes(raw.reason) ? (raw.reason as GoneReason) : "unknown" };
}

function parseList<T>(raw: unknown, parse: (item: unknown) => T | undefined): T[] | undefined {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return undefined;
  const items = raw.map(parse);
  return items.every((item) => item !== undefined) ? (items as T[]) : undefined;
}

/** Reads one text frame from the server; anything that is not a well-formed lv.1 frame yields undefined. */
export function parseServerFrame(text: string): ServerFrame | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isFields(raw)) return undefined;
  switch (raw.t) {
    case "hb":
      return { t: "hb" };
    case "joined":
      if (typeof raw.pid !== "number" || typeof raw.gen !== "number" || typeof raw.secret !== "string") return undefined;
      return { t: "joined", pid: raw.pid, gen: raw.gen, secret: raw.secret };
    case "roster": {
      const people = parseList(raw.people, parsePerson);
      const gone = parseList(raw.gone, parseDeparture);
      if (typeof raw.v !== "number" || !people || !gone) return undefined;
      return { t: "roster", v: raw.v, people, gone, ...(raw.quiet === true ? { quiet: true } : {}), ...(raw.locked === true ? { locked: true } : {}) };
    }
    case "board":
      return typeof raw.pid === "number" ? { t: "board", pid: raw.pid, data: raw.data } : undefined;
    case "rtc":
      if ((raw.role !== "pub" && raw.role !== "sub") || (raw.kind !== "offer" && raw.kind !== "answer" && raw.kind !== "ice")) return undefined;
      return { t: "rtc", role: raw.role, kind: raw.kind, ...(typeof raw.sdp === "string" ? { sdp: raw.sdp } : {}), ...(typeof raw.candidate === "string" ? { candidate: raw.candidate } : {}) };
    case "photo":
      if (typeof raw.pid !== "number" || typeof raw.data !== "string" || !/^[A-Za-z0-9+/=]*$/.test(raw.data)) return undefined;
      return { t: "photo", pid: raw.pid, data: raw.data };
    case "chat":
      if (typeof raw.pid !== "number" || typeof raw.name !== "string" || typeof raw.text !== "string" || typeof raw.at !== "number") return undefined;
      return { t: "chat", pid: raw.pid, name: raw.name, text: raw.text, at: raw.at, ...(typeof raw.to === "number" && raw.to > 0 ? { to: raw.to } : {}), ...(typeof raw.img === "string" && raw.img !== "" ? { img: raw.img } : {}) };
    case "error": {
      if (typeof raw.code !== "string" || typeof raw.message !== "string") return undefined;
      const code = ERROR_CODES.includes(raw.code) ? (raw.code as ErrorCode) : "INTERNAL";
      return { t: "error", code, message: raw.message };
    }
    default:
      return undefined;
  }
}

/** Serialises a client frame as the JSON text the server expects. */
export function encodeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

/** What a close code means for the connection's next step. */
export type CloseMeaning =
  | { kind: "left" }
  | { kind: "superseded" }
  | { kind: "removed" }
  | { kind: "banned" }
  | { kind: "refused" }
  | { kind: "flood" }
  | { kind: "no-hello" }
  | { kind: "silent" }
  | { kind: "slow" }
  | { kind: "abnormal" };

/** Names a WebSocket close code the way lv.1 uses it. */
export function closeMeaning(code: number): CloseMeaning {
  switch (code) {
    case 1000:
      return { kind: "left" };
    case 4001:
      return { kind: "superseded" };
    case 4400:
      return { kind: "refused" };
    case 4401:
      return { kind: "no-hello" };
    case 4403:
      return { kind: "removed" };
    case 4404:
      return { kind: "banned" };
    case 4408:
      return { kind: "silent" };
    case 4409:
      return { kind: "slow" };
    case 4429:
      return { kind: "flood" };
    default:
      return { kind: "abnormal" };
  }
}
