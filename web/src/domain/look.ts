/** Faces to start from; a participant may type any other. */
export const FACE_PRESETS = ["(•‿•)", "(◕‿◕)", "(ʘ‿ʘ)", "(¬‿¬)", "ಠ_ಠ", "(╯°□°)╯", "¯\\_(ツ)_/¯", "(づ｡◕‿‿◕｡)づ", "^_^", "o_O", ">_<", "(-_-)zzZ", ":)", ";)", ":D", "uwu"] as const;

export const FACE_MAX = 12;
export const COLOURS = 8;
export const TURNS = 5;

/** A look unpacked: which colour and which tilt. */
export type Look = { colour: number; turn: number };

/** Reads a look as the server packs it: three bits of colour above the low four, then the tilt. Anything out of range is the plain look. */
export function unpackLook(packed: number | undefined): Look {
  const value = packed ?? 0;
  const look = { colour: (value >> 4) & 0x7, turn: value >> 7 };
  return Number.isInteger(value) && value >= 0 && look.turn < TURNS ? look : { colour: 0, turn: 2 };
}

/** Packs a look into the one number the server carries. */
export function packLook(look: Look): number {
  return ((look.colour & 0x7) << 4) | (Math.min(Math.max(look.turn, 0), TURNS - 1) << 7);
}

/** A colour drawn at random, upright, for someone who has not chosen one. */
export function randomLook(random: () => number = Math.random): number {
  return packLook({ colour: Math.floor(random() * COLOURS), turn: 2 });
}

/** What a participant typed as their face, trimmed to what the room accepts. */
export function cleanFace(raw: string): string {
  return [...raw.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, FACE_MAX).join("");
}
