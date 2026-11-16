import { parseLook } from "../domain/look";

type AvatarProps = { look: string | undefined; face: string | undefined; name: string; photo?: string | undefined; className?: string };

function fit(length: number): string {
  return length <= 3 ? "text-[0.42em]" : length <= 6 ? "text-[0.26em]" : length <= 9 ? "text-[0.19em]" : "text-[0.15em]";
}

/** A participant when no camera shows them: their photo, or the characters they chose as a face (their initial if none) on a disc of their colour, turned their way. The disc is as large as the font size of the class given. */
export function Avatar({ look, face, name, photo, className = "text-[2.25rem]" }: AvatarProps) {
  const { bg, fg, turn } = parseLook(look);
  const shown = face || ([...name][0]?.toLocaleUpperCase() ?? "?");
  return (
    <span aria-hidden="true" style={{ backgroundColor: `#${bg}`, color: `#${fg}` }} className={`grid size-[1em] shrink-0 place-items-center overflow-hidden rounded-full leading-none ${className}`}>
      {photo ? (
        <img src={photo} alt="" className="size-full object-cover" />
      ) : (
        <span style={{ rotate: `${turn}deg` }} className={`font-mono font-bold whitespace-nowrap transition-[rotate] duration-300 ${fit([...shown].length)}`} translate="no">
          {shown}
        </span>
      )}
    </span>
  );
}
