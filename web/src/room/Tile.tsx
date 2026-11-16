import type { Person } from "../signal/protocol";
import { useT } from "../i18n/I18nProvider";
import { Icon } from "../ui/icons";
import { describePerson } from "./person";

type TileProps = { person: Person; isMe: boolean; video?: MediaStream | undefined };

function attach(stream: MediaStream | undefined) {
  return (element: HTMLVideoElement | null) => {
    if (element && element.srcObject !== (stream ?? null)) element.srcObject = stream ?? null;
  };
}

/** One participant on the stage: their camera when there is one to show, otherwise their initial; always their name and, in words, any trouble. */
export function Tile({ person, isMe, video }: TileProps) {
  const t = useT();
  const view = describePerson(person);
  const initial = [...person.name][0]?.toLocaleUpperCase() ?? "?";
  const muted = !view.flags.includes("microphone");
  const hand = view.flags.includes("hand");

  return (
    <li
      data-tone={view.tone}
      aria-label={t("room.tile", { name: person.name, state: t(view.stateKey) })}
      className={`arrive relative isolate flex aspect-video min-h-0 items-center justify-center overflow-hidden rounded-2xl border bg-card ${view.trouble ? "border-amber" : view.tone === "dashed" ? "border-dashed border-line-strong" : hand ? "border-bubble" : "border-line"}`}
    >
      {video ? (
        <video ref={attach(video)} autoPlay muted playsInline className={`absolute inset-0 -z-10 size-full object-cover ${isMe ? "-scale-x-100" : ""}`} />
      ) : (
        <span aria-hidden="true" className={`grid size-[28%] max-h-28 min-h-12 max-w-28 min-w-12 place-items-center rounded-full bg-line-strong font-display text-[clamp(1.25rem,3vw,2.5rem)] font-bold text-fg ${view.trouble ? "opacity-50" : ""}`}>
          {initial}
        </span>
      )}

      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
        {hand ? (
          <span className="grid size-8 place-items-center rounded-full bg-bubble text-on-bubble" title={t("flag.hand")}>
            <Icon name="hand" className="size-4" />
            <span className="sr-only">{t("flag.hand")}</span>
          </span>
        ) : null}
        {muted ? (
          <span className="grid size-8 place-items-center rounded-full bg-canvas/70 text-muted">
            <Icon name="micOff" className="size-4" />
            <span className="sr-only">{t("tile.muted")}</span>
          </span>
        ) : null}
      </div>

      <div className="absolute inset-x-2.5 bottom-2.5 flex items-center gap-1.5">
        <span className={`min-w-0 truncate rounded-lg bg-canvas/70 px-2.5 py-1 text-sm font-semibold ${view.trouble ? "opacity-70" : ""}`} translate="no">
          {person.name}
        </span>
        {isMe ? <span className="bubble-word shrink-0 bg-bubble px-2 py-0.5 font-mono text-xs text-on-bubble">{t("room.you")}</span> : null}
        {view.isOwner ? <span className="bubble-word shrink-0 border border-line-strong bg-canvas/70 px-2 py-0.5 font-mono text-xs text-muted">{t("room.owner")}</span> : null}
        {view.trouble || view.tone === "dashed" ? (
          <span className={`bubble-word flex shrink-0 items-center gap-1.5 px-2 py-0.5 font-mono text-xs ${view.trouble ? "border border-amber bg-canvas/70 text-amber" : "bg-canvas/70 text-muted"}`}>
            {view.tone === "dashed" ? <span aria-hidden="true" className="pulse inline-block size-1.5 rounded-full bg-accent" /> : null}
            {t(view.stateKey)}
          </span>
        ) : null}
      </div>
    </li>
  );
}
