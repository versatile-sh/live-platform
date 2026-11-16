import { FACES, unpackLook } from "../domain/look";

const COLOUR = ["bg-face-0", "bg-face-1", "bg-face-2", "bg-face-3", "bg-face-4", "bg-face-5", "bg-face-6", "bg-face-7"] as const;
const TURN = ["-rotate-[24deg]", "-rotate-12", "rotate-0", "rotate-12", "rotate-[24deg]"] as const;

/** The colour class of each look colour, for the picker to draw its swatches from the same list. */
export const LOOK_COLOURS = COLOUR;

/** A participant's face: an emoji on a coloured disc, tilted the way they chose. The size comes from the class given. */
export function Avatar({ look, className = "size-9 text-lg" }: { look: number | undefined; className?: string }) {
  const { face, colour, turn } = unpackLook(look);
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full leading-none ${COLOUR[colour] ?? COLOUR[0]} ${className}`}>
      <span className={`transition-transform duration-300 ${TURN[turn] ?? TURN[2]}`}>{FACES[face] ?? FACES[0]}</span>
    </span>
  );
}
