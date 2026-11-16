import { COLOURS, FACES, TURNS, packLook, unpackLook } from "../domain/look";
import { useT } from "../i18n/I18nProvider";
import { Avatar, LOOK_COLOURS } from "../ui/Avatar";

const STEP = "grid size-9 place-items-center rounded-full border border-line-strong text-fg transition-colors duration-200 hover:border-fg/50 disabled:opacity-35";

function Turn({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-4 ${back ? "-scale-x-100" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8a5 5 0 1 0 1.700-3.700M3 2.500v3h3" />
    </svg>
  );
}

/** Lets a participant choose how they appear: a face, its colour and its tilt. Each choice takes effect at once. */
export function LookPicker({ look, onChange }: { look: number | undefined; onChange(look: number): void }) {
  const t = useT();
  const current = unpackLook(look);
  const change = (next: Partial<typeof current>) => onChange(packLook({ ...current, ...next }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar look={look} className="size-16 text-4xl" />
        <div className="flex gap-1.5">
          <button type="button" className={STEP} aria-label={t("look.turnLeft")} disabled={current.turn === 0} onClick={() => change({ turn: current.turn - 1 })}>
            <Turn back />
          </button>
          <button type="button" className={STEP} aria-label={t("look.turnRight")} disabled={current.turn === TURNS - 1} onClick={() => change({ turn: current.turn + 1 })}>
            <Turn />
          </button>
        </div>
        <div role="radiogroup" aria-label={t("look.colour")} className="ml-auto grid grid-cols-4 gap-1.5">
          {Array.from({ length: COLOURS }, (_, colour) => (
            <button
              key={colour}
              type="button"
              role="radio"
              aria-checked={current.colour === colour}
              aria-label={t("look.colourN", { n: colour + 1 })}
              className={`size-6 rounded-full transition-[scale,outline-color] duration-200 outline-2 outline-offset-2 outline-transparent hover:scale-110 aria-checked:outline-fg ${LOOK_COLOURS[colour]}`}
              onClick={() => change({ colour })}
            />
          ))}
        </div>
      </div>
      <div role="radiogroup" aria-label={t("look.face")} className="grid grid-cols-8 gap-1">
        {FACES.map((face, index) => (
          <button
            key={face}
            type="button"
            role="radio"
            aria-checked={current.face === index}
            aria-label={t("look.faceN", { n: index + 1 })}
            className="grid aspect-square place-items-center rounded-xl text-xl transition-[scale,background-color] duration-200 hover:scale-110 hover:bg-fg/10 aria-checked:bg-fg/15"
            onClick={() => change({ face: index })}
          >
            <span aria-hidden="true">{face}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
