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
