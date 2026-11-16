/** The faces a participant can wear when no camera shows them. */
export const FACES = ["😀", "😎", "🤓", "🥳", "😴", "🤠", "😺", "🤖", "👻", "🐼", "🦊", "🐸", "🐵", "🦄", "🐙", "👽"] as const;

/** How many colours and tilts a look can have; the classes that draw them live in the Avatar component. */
export const COLOURS = 8;
export const TURNS = 5;

/** A look unpacked: which face, which colour, which tilt. */
export type Look = { face: number; colour: number; turn: number };

/** Reads a look as the server packs it: face in the low four bits, then three of colour, then the tilt. Anything out of range is the plain look. */
export function unpackLook(packed: number | undefined): Look {
  const value = packed ?? 0;
  const look = { face: value & 0xf, colour: (value >> 4) & 0x7, turn: value >> 7 };
  return Number.isInteger(value) && value >= 0 && look.turn < TURNS ? look : { face: 0, colour: 0, turn: 2 };
}

/** Packs a look into the one number the server carries. */
export function packLook(look: Look): number {
  return (look.face & 0xf) | ((look.colour & 0x7) << 4) | (Math.min(Math.max(look.turn, 0), TURNS - 1) << 7);
}

/** A look drawn at random, upright, for someone who has not chosen one. */
export function randomLook(random: () => number = Math.random): number {
  return packLook({ face: Math.floor(random() * FACES.length), colour: Math.floor(random() * COLOURS), turn: 2 });
}
