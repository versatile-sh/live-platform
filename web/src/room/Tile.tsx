import type { Person } from "../signal/protocol";
import { useT } from "../i18n/I18nProvider";
import { Bubble } from "../ui/Bubble";
import { button } from "../ui/styles";
import { describePerson, type TileTone } from "./person";

type TileProps = {
  person: Person;
  isMe: boolean;
  canModerate: boolean;
  onRemove: (pid: number) => void;
  onTransfer: (pid: number) => void;
};

const TONE: Record<TileTone, string> = {
  solid: "border-line-strong",
  dashed: "border-dashed border-line-strong",
  dim: "border-amber",
};

const DIM: Record<TileTone, string> = { solid: "", dashed: "", dim: "opacity-60" };

/** One participant: a fixed box with an initial, their name and their state in words, so nothing relies on colour. */
export function Tile({ person, isMe, canModerate, onRemove, onTransfer }: TileProps) {
  const t = useT();
  const view = describePerson(person);
  const initial = [...person.name][0]?.toLocaleUpperCase() ?? "?";

  return (
    <li data-tone={view.tone} className={`arrive bubble flex min-h-44 flex-col justify-between border bg-card p-3 ${TONE[view.tone]} ${isMe ? "ring-1 ring-accent" : ""}`}>
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">
        {isMe ? <Bubble tone="accent">{t("room.you")}</Bubble> : null}
        {view.isOwner ? <Bubble>{t("room.owner")}</Bubble> : null}
        {view.flags.map((flag) => (
          <Bubble key={flag}>{t(`flag.${flag}`)}</Bubble>
        ))}
      </div>
      <p aria-hidden="true" className={`text-center font-display text-4xl font-bold tracking-[-0.044em] text-muted ${DIM[view.tone]}`}>
        {initial}
      </p>
      <div>
        <p className={`truncate font-semibold ${DIM[view.tone]}`} translate="no">
          {person.name}
        </p>
        <p className="flex items-center gap-2 font-mono text-xs text-muted">
          {view.tone === "dashed" ? <span aria-hidden="true" className="pulse inline-block size-1.5 rounded-full bg-accent" /> : null}
          {view.trouble ? <Bubble tone="amber">{t(view.stateKey)}</Bubble> : <span>{t(view.stateKey)}</span>}
        </p>
        {canModerate && !isMe ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={button({ variant: "quiet", size: "sm" })} onClick={() => onTransfer(person.pid)} aria-label={t("owner.transfer", { name: person.name })}>
              {t("owner.transferShort")}
            </button>
            <button type="button" className={button({ variant: "quiet", size: "sm" })} onClick={() => onRemove(person.pid)} aria-label={t("owner.remove", { name: person.name })}>
              {t("owner.removeShort")}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
