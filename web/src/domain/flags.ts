/** The bits of a participant's `flags`, as the server numbers them. */
export const FLAG = {
  microphone: 1,
  camera: 2,
  screen: 4,
  screenAudio: 8,
  hand: 16,
  owner: 32,
  unstable: 64,
  board: 128,
  muted: 256,
  noDraw: 512,
} as const;

export type FlagName = keyof typeof FLAG;

const ORDER: readonly FlagName[] = ["owner", "hand", "screen", "screenAudio", "camera", "microphone", "unstable"];

/** Whether `flags` has the bit of `name` set. */
export function hasFlag(flags: number, name: FlagName): boolean {
  return (flags & FLAG[name]) !== 0;
}

/** The names of the bits set in `flags`, in the order a tile lists them. */
export function flagNames(flags: number): FlagName[] {
  return ORDER.filter((name) => hasFlag(flags, name));
}
