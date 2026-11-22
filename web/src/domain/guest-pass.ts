import { checkName } from "./name";

/** What a trusted inviter, such as a chat bot, prepared for one visit: the name, the photo as base64 JPEG and how to create the room. */
export type GuestPass = { name: string; face: string; private: boolean; listed: boolean };

/** What an invitation link carries in its query: whether a new room is shown in the open rooms, and the id of a guest pass. */
export type Invite = { listed: boolean | undefined; pass: string | undefined };

const PASS_ID = /^[A-Za-z0-9_-]{16,64}$/;
const FACE = /^[A-Za-z0-9+/]*={0,2}$/;
const FACE_MAX = 13_000;

/** Reads `?listed=0|1&pass=<id>`; anything else is ignored. */
export function readInvite(search: string): Invite {
  const query = new URLSearchParams(search);
  const listed = query.get("listed");
  const pass = query.get("pass") ?? "";
  return { listed: listed === "1" ? true : listed === "0" ? false : undefined, pass: PASS_ID.test(pass) ? pass : undefined };
}

/** The query without the invitation's own keys, so a reload or a copied address does not carry them again. */
export function withoutInvite(search: string): string {
  const query = new URLSearchParams(search);
  query.delete("listed");
  query.delete("pass");
  const rest = query.toString();
  return rest ? `?${rest}` : "";
}

/** Checks what the server sent for a pass; absent when it is not one the page can use. */
export function parsePass(value: unknown): GuestPass | undefined {
  const v = value as Partial<Record<keyof GuestPass, unknown>> | null;
  if (typeof v !== "object" || v === null || typeof v.name !== "string" || typeof v.face !== "string") return undefined;
  const name = checkName(v.name);
  if (!name.ok || v.face.length > FACE_MAX || !FACE.test(v.face)) return undefined;
  return { name: name.name, face: v.face, private: v.private === true, listed: v.listed === true };
}

/** What the page keeps of a guest pass so the same person can enter its room again: the pass to present next, the name and photo, and the access it chose. */
export type KeptPass = { pass: string | undefined; name: string; face: string; private: boolean; listed: boolean };

const KEPT_ROOMS = 8;

function parseKept(value: unknown): KeptPass | undefined {
  const v = value as Partial<Record<keyof KeptPass, unknown>> | null;
  if (typeof v !== "object" || v === null || typeof v.face !== "string" || v.face.length > FACE_MAX || !FACE.test(v.face)) return undefined;
  const pass = typeof v.pass === "string" && PASS_ID.test(v.pass) ? v.pass : undefined;
  const name = typeof v.name === "string" ? checkName(v.name) : undefined;
  return { pass, name: name?.ok ? name.name : "", face: v.face, private: v.private === true, listed: v.listed === true };
}

function keptRooms(raw: string | null): [string, KeptPass][] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) => {
      if (!Array.isArray(item) || typeof item[0] !== "string") return [];
      const kept = parseKept(item[1]);
      return kept ? [[item[0], kept] as [string, KeptPass]] : [];
    });
  } catch {
    return [];
  }
}

/** Reads what is kept for `slug` from the stored list, or nothing when the list is absent, malformed or does not hold it. */
export function readKept(raw: string | null, slug: string): KeptPass | undefined {
  return keptRooms(raw).find(([room]) => room === slug)?.[1];
}

/** The stored list with `kept` as the newest entry for `slug`, holding at most the last eight rooms. */
export function withKept(raw: string | null, slug: string, kept: KeptPass): string {
  const rest = keptRooms(raw).filter(([room]) => room !== slug);
  return JSON.stringify([[slug, kept], ...rest].slice(0, KEPT_ROOMS));
}
