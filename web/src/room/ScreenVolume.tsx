import { useT } from "../i18n/I18nProvider";
import { Icon } from "../ui/icons";
import { CONTROL, SCALE } from "./StageFrame";

/** How loud a shared screen's sound plays here: a level from 0 to 1, and whether it is silenced (keeping the level for later). */
export type Loudness = { level: number; muted: boolean };

export const FULL: Loudness = { level: 1, muted: false };

/** The volume one actually hears. */
export const heard = (loudness: Loudness): number => (loudness.muted ? 0 : loudness.level);

type ScreenVolumeProps = {
  /** Whose screen, for the labels. */
  name: string;
  loudness: Loudness;
  onChange(loudness: Loudness): void;
};

/** The volume of one shared screen's sound, on its frame: a speaker that silences it and a slider for the level. */
export function ScreenVolume({ name, loudness, onChange }: ScreenVolumeProps) {
  const t = useT();
  const percent = Math.round(heard(loudness) * 100);
  const toggle = t(loudness.muted || loudness.level === 0 ? "volume.unmute" : "volume.mute", { name });
  return (
    <div
      className="absolute right-(--edge) bottom-(--edge) z-10 flex items-center gap-2 rounded-full bg-canvas/75 py-1 pr-3 pl-1 opacity-0 transition-opacity duration-200 group-focus-within/frame:opacity-100 group-hover/frame:opacity-100"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button type="button" aria-label={toggle} title={toggle} aria-pressed={percent === 0} className={CONTROL} onClick={() => onChange(loudness.level === 0 ? FULL : { ...loudness, muted: !loudness.muted })}>
        <Icon name={percent === 0 ? "volumeOff" : "volume"} className={SCALE.icon} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label={t("volume.level", { name })}
        aria-valuetext={`${percent}%`}
        className="h-1 w-[clamp(4rem,30cqw,8rem)] cursor-pointer accent-accent"
        onChange={(event) => onChange({ level: Number(event.target.value) / 100, muted: false })}
      />
      <span aria-hidden="true" className={`w-8 text-right font-mono tabular-nums ${SCALE.small}`}>
        {percent}%
      </span>
    </div>
  );
}
