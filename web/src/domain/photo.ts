/** The kinds of picture a photo may be, told from its first bytes and never from the type a file claims. */
export type PhotoKind = "jpeg" | "gif";

export const GIF_MAX_BYTES = 90 * 1024;
export const PHOTO_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** Reads what a file really is from its first bytes. */
export function sniffPhoto(head: Uint8Array): PhotoKind | undefined {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.length >= 6) {
    const magic = String.fromCharCode(...head.subarray(0, 6));
    if (magic === "GIF87a" || magic === "GIF89a") return "gif";
  }
  return undefined;
}

/** The address an image element can show for a photo that arrived as base64, or nothing when it is neither a JPEG nor a GIF. */
export function photoAddress(base64: string): string | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return undefined;
  if (base64.startsWith("/9j/")) return `data:image/jpeg;base64,${base64}`;
  if (base64.startsWith("R0lGODdh") || base64.startsWith("R0lGODlh")) return `data:image/gif;base64,${base64}`;
  return undefined;
}

/** Bytes as base64. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
