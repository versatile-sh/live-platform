import { checkSlug, normalizeSlug, type SlugCheck } from "./slug";

/** The address that brings someone into a room, with the password after `#` so that browsers never send it. */
export function shareLink(origin: string, slug: string, password: string | undefined): string {
  const base = `${origin}/${slug}`;
  return password ? `${base}#${encodeURIComponent(password)}` : base;
}

/** Reads the password a share link carries in its fragment; empty when there is none. */
export function passwordFromHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/** Reads what a person pasted or typed to join a room, a whole link or only the room name: the room's slug and the room code the link carries after `#`. */
export function roomFromLink(text: string): { slug: SlugCheck; password: string } {
  const trimmed = text.trim();
  const hashAt = trimmed.indexOf("#");
  const address = hashAt < 0 ? trimmed : trimmed.slice(0, hashAt);
  const segment = address.replace(/[?].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
  return { slug: checkSlug(normalizeSlug(segment)), password: hashAt < 0 ? "" : passwordFromHash(trimmed.slice(hashAt)) };
}
