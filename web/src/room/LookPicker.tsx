import { useId, useState } from "react";

import { COLOURS, FACE_MAX, FACE_PRESETS, TURNS, cleanFace, packLook, unpackLook } from "../domain/look";
import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import { Avatar, LOOK_COLOURS } from "../ui/Avatar";

type LookPickerProps = {
  look: number | undefined;
  face: string | undefined;
  name: string;
  photo: string | undefined;
  onChange(look: number, face: string): void;
  onPhoto(data: string): void;
};

const STEP = "grid size-9 place-items-center rounded-full border border-line-strong text-fg transition-colors duration-200 hover:border-fg/50 disabled:opacity-35";
const SMALL = "h-8 rounded-full border border-line-strong px-3 text-xs font-semibold transition-colors duration-200 hover:border-fg/50";

function Turn({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-4 ${back ? "-scale-x-100" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8a5 5 0 1 0 1.700-3.700M3 2.500v3h3" />
    </svg>
  );
}

/** Lets a participant choose how they appear: the characters of their face (typed or picked), its colour and tilt, or a photo that lasts only while they are in the room. Each choice takes effect at once. */
export function LookPicker({ look, face, name, photo, onChange, onPhoto }: LookPickerProps) {
  const t = useT();
  const id = useId();
  const { shrinkPhoto } = useServices();
  const [failed, setFailed] = useState(false);
  const current = unpackLook(look);
  const typed = face ?? "";
  const change = (next: Partial<typeof current>) => onChange(packLook({ ...current, ...next }), typed);

  async function pick(file: File | undefined) {
    if (!file) return;
    const data = await shrinkPhoto(file);
    setFailed(data === undefined);
    if (data) onPhoto(data);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar look={look} face={face} name={name} photo={photo} className="text-[4rem]" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <button type="button" className={STEP} aria-label={t("look.turnLeft")} disabled={current.turn === 0} onClick={() => change({ turn: current.turn - 1 })}>
              <Turn back />
            </button>
            <button type="button" className={STEP} aria-label={t("look.turnRight")} disabled={current.turn === TURNS - 1} onClick={() => change({ turn: current.turn + 1 })}>
              <Turn />
            </button>
            <label className={`${SMALL} ml-auto inline-flex cursor-pointer items-center has-focus-visible:outline-2 has-focus-visible:outline-fg/55`}>
              {t("look.photo")}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {photo ? (
              <button type="button" className={SMALL} onClick={() => onPhoto("")}>
                {t("look.photoRemove")}
              </button>
            ) : null}
          </div>
          <div role="radiogroup" aria-label={t("look.colour")} className="flex gap-1.5">
            {Array.from({ length: COLOURS }, (_, colour) => (
              <button
                key={colour}
                type="button"
                role="radio"
                aria-checked={current.colour === colour}
                aria-label={t("look.colourN", { n: colour + 1 })}
                className={`size-6 rounded-full outline-2 outline-offset-2 outline-transparent transition-[scale,outline-color] duration-200 hover:scale-110 aria-checked:outline-fg ${LOOK_COLOURS[colour]}`}
                onClick={() => change({ colour })}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="min-h-5 text-[0.8125rem] leading-snug text-muted">{failed ? t("look.photoFailed") : t("look.photoHint")}</p>

      <div>
        <label htmlFor={id} className="text-sm font-semibold">
          {t("look.face")}
        </label>
        <input
          id={id}
          value={typed}
          maxLength={FACE_MAX * 2}
          placeholder="(•‿•)"
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 h-11 w-full rounded-xl border border-muted-light bg-canvas px-3.5 font-mono text-fg transition-colors duration-200 placeholder:text-muted-light focus:border-fg/50 focus-visible:outline-none"
          onChange={(event) => onChange(packLook(current), cleanFace(event.target.value))}
        />
      </div>
      <div role="group" aria-label={t("look.presets")} className="flex flex-wrap gap-1.5">
        {FACE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={typed === preset}
            className="h-8 rounded-full border border-line-strong px-2.5 font-mono text-xs whitespace-nowrap transition-colors duration-200 hover:border-fg/50 aria-pressed:border-transparent aria-pressed:bg-bubble aria-pressed:text-on-bubble"
            onClick={() => onChange(packLook(current), preset)}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
