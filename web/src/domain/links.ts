/** A piece of a message: words, or an address that can be opened. */
export type Piece = { text: string; href?: string };

const ADDRESS = /https?:\/\/[^\s<>"']+/g;
const TRAILING = /[.,;:!?)\]}]+$/;

/** Splits a message into words and web addresses; only http and https addresses become links, without the punctuation that ends a sentence. */
export function linkify(text: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const match of text.matchAll(ADDRESS)) {
    const raw = match[0];
    const address = raw.replace(TRAILING, "");
    let href: string | undefined;
    try {
      const url = new URL(address);
      if (url.protocol === "http:" || url.protocol === "https:") href = url.href;
    } catch {
      href = undefined;
    }
    if (!href) continue;
    if (match.index > at) pieces.push({ text: text.slice(at, match.index) });
    pieces.push({ text: address, href });
    at = match.index + address.length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

/** Faces and signs offered beside the message box; each is a single character the room accepts. */
export const EMOJI = ["😀", "😂", "🤣", "😊", "😍", "😎", "🤔", "😅", "😭", "😡", "🥳", "😴", "🤯", "😱", "🙄", "😉", "👍", "👎", "👏", "🙏", "💪", "👀", "🔥", "✨", "🎉", "💯", "✅", "❌", "❓", "💡", "🚀", "☕", "🍕", "🎧", "💻", "🐛", "⏳", "📌", "💚", "💔"] as const;
