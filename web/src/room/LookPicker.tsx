import { useId, useState, type ReactNode } from "react";

import {
  DISC_COLOURS,
  FACE_COLOURS,
  FACE_MAX,
  FACE_PRESETS,
  cleanFace,
  formatLook,
  parseLook,
} from "../domain/look";
import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import { Avatar } from "../ui/Avatar";
import { CHIP, SWATCH, button } from "../ui/styles";

type LookPickerProps = {
  look: string | undefined;
  face: string | undefined;
  name: string;
  photo: string | undefined;
  onSave(look: string, face: string): void;
  onCancel(): void;
  onPhoto(data: string): void;
};

const BOX = "bubble border border-line-strong bg-canvas p-3.5";
const PILL = button({ variant: "secondary", size: "sm" });
const STEP = 15;

function Turn({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`size-4 ${back ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8a5 5 0 1 0 1.700-3.700M3 2.500v3h3" />
    </svg>
  );
}

function Palette({
  label,
  colours,
  value,
  onPick,
}: {
  label: string;
  colours: readonly string[];
  value: string;
  onPick(colour: string): void;
}) {
  const t = useT();
  const custom = !colours.includes(value);
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap items-center gap-2"
      >
        {colours.map((colour) => (
          <button
            key={colour}
            type="button"
            role="radio"
            aria-checked={value === colour}
            aria-label={`#${colour}`}
            style={{ backgroundColor: `#${colour}` }}
            className={SWATCH}
            onClick={() => onPick(colour)}
          />
        ))}
        <label
          className={`${PILL} relative cursor-pointer overflow-hidden has-focus-visible:outline-2 has-focus-visible:outline-fg/55 ${custom ? "border-fg/60" : ""}`}
        >
          <span
            aria-hidden="true"
            style={{ backgroundColor: `#${value}` }}
            className="size-4 rounded-full border border-fg/25"
          />
          {t("look.custom")}
          <input
            type="color"
            value={`#${value}`}
            aria-label={`${label}: ${t("look.custom")}`}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) =>
              onPick(event.target.value.slice(1).toLowerCase())
            }
          />
        </label>
      </div>
    </div>
  );
}

function Box({ children }: { children: ReactNode }) {
  return <div className={BOX}>{children}</div>;
}

/** Lets a participant choose how they appear: the characters of their face (typed or picked), the colour of the disc and of the face, a full turn, or a photo that lasts only while they are in the room. The room is told only when they save; a photo goes at once. */
export function LookPicker({
  look: savedLook,
  face: savedFace,
  name,
  photo,
  onSave,
  onCancel,
  onPhoto,
}: LookPickerProps) {
  const t = useT();
  const id = useId();
  const { shrinkPhoto } = useServices();
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState({
    look: formatLook(parseLook(savedLook)),
    face: savedFace ?? "",
  });
  const look = draft.look;
  const face = draft.face;
  const current = parseLook(look);
  const typed = face;
  const changed =
    look !== formatLook(parseLook(savedLook)) || face !== (savedFace ?? "");
  const onChange = (nextLook: string, nextFace: string) =>
    setDraft({ look: nextLook, face: nextFace });
  const change = (next: Partial<typeof current>) =>
    onChange(formatLook({ ...current, ...next }), typed);

  async function pick(file: File | undefined) {
    if (!file) return;
    const data = await shrinkPhoto(file);
    setFailed(data === undefined);
    if (data) onPhoto(data);
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Box>
          <div className="flex items-center gap-4">
            <Avatar
              look={look}
              face={face}
              name={name}
              photo={photo}
              className="text-[5rem]"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`${PILL} w-11 px-0`}
                  aria-label={t("look.turnLeft")}
                  onClick={() => change({ turn: current.turn - STEP })}
                >
                  <Turn back />
                </button>
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={current.turn}
                  aria-label={t("look.turn")}
                  className="h-9 min-w-0 flex-1 accent-(--color-bubble)"
                  onChange={(event) =>
                    change({ turn: Number(event.target.value) })
                  }
                />
                <button
                  type="button"
                  className={`${PILL} w-11 px-0`}
                  aria-label={t("look.turnRight")}
                  onClick={() => change({ turn: current.turn + STEP })}
                >
                  <Turn />
                </button>
                <output className="w-11 text-right font-mono text-xs text-accent tabular-nums">
                  {current.turn}°
                </output>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`${PILL} cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-fg/55`}
                >
                  {t(photo ? "look.photoChange" : "look.photoSelect")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    aria-label={t("look.photoSelect")}
                    className="sr-only"
                    onChange={(event) => {
                      void pick(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {photo ? (
                  <button
                    type="button"
                    className={PILL}
                    onClick={() => onPhoto("")}
                  >
                    {t("look.photoRemove")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mt-3 min-h-5 text-[0.8125rem] leading-snug text-muted">
            {failed ? t("look.photoFailed") : t("look.photoHint")}
          </p>
        </Box>

        <Box>
          <div className="flex flex-col gap-4">
            <Palette
              label={t("look.disc")}
              colours={DISC_COLOURS}
              value={current.bg}
              onPick={(bg) => change({ bg })}
            />
            <Palette
              label={t("look.ink")}
              colours={FACE_COLOURS}
              value={current.fg}
              onPick={(fg) => change({ fg })}
            />
          </div>
        </Box>
      </div>

      <Box>
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
          className="bubble mt-1.5 h-11 w-full border border-muted-light bg-card px-3.5 font-mono text-fg transition-colors duration-200 placeholder:text-muted-light focus:border-fg/50 focus-visible:outline-none"
          onChange={(event) =>
            onChange(formatLook(current), cleanFace(event.target.value))
          }
        />
        <div
          role="group"
          aria-label={t("look.presets")}
          className="mt-3 flex flex-wrap gap-1.5"
        >
          {FACE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={typed === preset}
              className={`${CHIP} font-mono text-fg`}
              onClick={() => onChange(formatLook(current), preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </Box>

      <div className="flex items-center justify-end gap-2 md:col-span-2">
        <p aria-live="polite" className="mr-1 text-[0.8125rem] text-muted">
          {changed ? t("look.unsaved") : ""}
        </p>
        <button
          type="button"
          className={button({ variant: "secondary" })}
          onClick={onCancel}
        >
          {t("look.cancel")}
        </button>
        <button
          type="button"
          className={button({ variant: "accent" })}
          onClick={() => (changed ? onSave(look, face) : onCancel())}
        >
          {t("look.save")}
        </button>
      </div>
    </div>
  );
}
