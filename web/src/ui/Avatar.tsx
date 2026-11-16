import { unpackLook } from "../domain/look";

const COLOUR = ["bg-face-0", "bg-face-1", "bg-face-2", "bg-face-3", "bg-face-4", "bg-face-5", "bg-face-6", "bg-face-7"] as const;
const TURN = ["-rotate-[24deg]", "-rotate-12", "rotate-0", "rotate-12", "rotate-[24deg]"] as const;

/** The colour class of each look colour, for the picker to draw its swatches from the same list. */
export const LOOK_COLOURS = COLOUR;

type AvatarProps = { look: number | undefined; face: string | undefined; name: string; photo?: string | undefined; className?: string };

function fit(length: number): string {
  return length <= 3 ? "text-[0.42em]" : length <= 6 ? "text-[0.26em]" : length <= 9 ? "text-[0.19em]" : "text-[0.15em]";
}

/** A participant when no camera shows them: their photo, or the characters they chose as a face (their initial if none) on a coloured disc, tilted their way. The disc is as large as the font size of the class given. */
export function Avatar({ look, face, name, photo, className = "text-[2.25rem]" }: AvatarProps) {
  const { colour, turn } = unpackLook(look);
  const shown = face || ([...name][0]?.toLocaleUpperCase() ?? "?");
  return (
    <span aria-hidden="true" className={`grid size-[1em] shrink-0 place-items-center overflow-hidden rounded-full leading-none text-ink ${COLOUR[colour] ?? COLOUR[0]} ${className}`}>
      {photo ? (
        <img src={photo} alt="" className="size-full object-cover" />
      ) : (
        <span className={`font-mono font-bold whitespace-nowrap transition-transform duration-300 ${fit([...shown].length)} ${TURN[turn] ?? TURN[2]}`} translate="no">
          {shown}
        </span>
      )}
    </span>
  );
}
