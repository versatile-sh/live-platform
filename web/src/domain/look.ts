/** Faces to start from; a participant may type any other. */
export const FACE_PRESETS = ["(•‿•)", "(◕‿◕)", "(ʘ‿ʘ)", "(¬‿¬)", "ಠ_ಠ", "(╯°□°)╯", "¯\\_(ツ)_/¯", "(づ｡◕‿‿◕｡)づ", "^_^", "o_O", ">_<", "(-_-)zzZ", ":)", ";)", ":D", "uwu"] as const;

export const FACE_MAX = 12;

/** Colours offered for the disc and for the face on it; any other can be picked from the full palette. */
export const DISC_COLOURS = ["c6f432", "7ee8a8", "6fd6e8", "8fb4ff", "c4a5ff", "ff9ec7", "ffb37a", "f5f5f2", "0e1116"] as const;
export const FACE_COLOURS = ["0e1116", "f5f5f2", "c6f432", "ff5a5f", "3d5afe", "7a3cff", "00875a", "b35c00"] as const;

/** How a participant appears: the colour of the disc, the colour of the face on it, and how far it is turned, in degrees. */
export type Look = { bg: string; fg: string; turn: number };

const SHAPE = /^([0-9a-f]{6})-([0-9a-f]{6})-(\d{1,3})$/;
const PLAIN: Look = { bg: "c6f432", fg: "0e1116", turn: 0 };

/** Reads a look as the server carries it, "rrggbb-rrggbb-deg"; anything else is the plain look. */
export function parseLook(text: string | undefined): Look {
  const match = SHAPE.exec(text ?? "");
  if (!match) return PLAIN;
  const turn = Number(match[3]);
  return turn < 360 ? { bg: match[1]!, fg: match[2]!, turn } : PLAIN;
}

/** Writes a look the way the server carries it. */
export function formatLook(look: Look): string {
  return `${look.bg}-${look.fg}-${((Math.round(look.turn) % 360) + 360) % 360}`;
}

/** A disc colour drawn at random, upright, for someone who has not chosen one. */
export function randomLook(random: () => number = Math.random): string {
  const bg = DISC_COLOURS[Math.floor(random() * (DISC_COLOURS.length - 1))] ?? PLAIN.bg;
  return formatLook({ bg, fg: PLAIN.fg, turn: 0 });
}

/** What a participant typed as their face, trimmed to what the room accepts. */
export function cleanFace(raw: string): string {
  return [...raw.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, FACE_MAX).join("");
}
