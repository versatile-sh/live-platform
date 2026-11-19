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
