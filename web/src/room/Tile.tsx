import type { Person } from "../signal/protocol";
import { useT } from "../i18n/I18nProvider";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/icons";
import { describePerson } from "./person";
import { SCALE, StageFrame, type StageMode } from "./StageFrame";

type TileProps = { person: Person; isMe: boolean; video?: MediaStream | undefined; photo?: string | undefined; mode?: StageMode; speaking?: boolean; onFront?(): void; onMenu?(at: { x: number; y: number }): void };

function attach(stream: MediaStream | undefined) {
  return (element: HTMLVideoElement | null) => {
    if (element && element.srcObject !== (stream ?? null)) element.srcObject = stream ?? null;
  };
}

/** One participant on the stage: their camera when there is one to show, otherwise their initial; always their name and, in words, any trouble. */
export function Tile({ person, isMe, video, photo, mode = "grid", speaking = false, onFront = () => undefined, onMenu }: TileProps) {
  const t = useT();
  const view = describePerson(person);
    const muted = !view.flags.includes("microphone");
  const hand = view.flags.includes("hand");

  return (
    <StageFrame
      mode={mode}
      name={person.name}
      onFront={onFront}
      data-tone={view.tone}
      aria-label={t("room.tile", { name: person.name, state: t(view.stateKey) })}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu?.({ x: event.clientX, y: event.clientY });
      }}
      className={`arrive ${isMe ? "bubble-sent" : "bubble"} border bg-card ${view.trouble ? "border-muted-light border-dashed" : view.tone === "dashed" ? "border-dashed border-line-strong" : speaking || hand ? "border-bubble" : "border-line"} outline-2 -outline-offset-1 transition-[outline-color] duration-150 ${speaking ? "outline-bubble" : "outline-transparent"}`}
      data-speaking={speaking || undefined}
    >
      {video ? (
        <video ref={attach(video)} autoPlay muted playsInline className={`absolute inset-0 -z-10 size-full ${mode === "front" ? "object-contain" : "object-cover"} ${isMe ? "-scale-x-100" : ""}`} />
      ) : (
        <Avatar look={person.look} face={person.face} name={person.name} photo={photo} className={`text-[clamp(1.5rem,28cqmin,12rem)] ${view.trouble ? "opacity-50" : ""}`} />
      )}

      <div className="absolute top-(--edge) right-(--edge) flex items-center gap-1.5">
        {hand ? (
          <span className={`grid ${SCALE.control} place-items-center rounded-full bg-bubble text-on-bubble`} title={t("flag.hand")}>
            <Icon name="hand" className={SCALE.icon} />
            <span className="sr-only">{t("flag.hand")}</span>
          </span>
        ) : null}
        {muted ? (
          <span className={`grid ${SCALE.control} place-items-center rounded-full bg-canvas/70 text-muted`}>
            <Icon name="micOff" className={SCALE.icon} />
            <span className="sr-only">{t("tile.muted")}</span>
          </span>
        ) : null}
      </div>

      <div className="absolute inset-x-(--edge) bottom-(--edge) flex items-center gap-1.5">
        <span className={`min-w-0 truncate bubble-word bg-canvas/70 px-[1.2em] py-[0.35em] ${SCALE.text} font-semibold ${view.trouble ? "opacity-70" : ""}`} translate="no">
          {person.name}
        </span>
        {isMe ? <span className={`bubble-word shrink-0 bg-bubble px-[0.7em] py-[0.15em] font-mono ${SCALE.small} text-on-bubble`}>{t("room.you")}</span> : null}
        {view.isOwner ? <span className={`bubble-word shrink-0 border border-accent/40 bg-canvas/70 px-[0.7em] py-[0.15em] font-mono ${SCALE.small} text-accent`}>{t("room.owner")}</span> : null}
        {view.trouble || view.tone === "dashed" ? (
          <span className={`bubble-word flex shrink-0 items-center gap-1.5 px-[0.7em] py-[0.15em] font-mono ${SCALE.small} ${view.trouble ? "border border-fg/40 bg-canvas/80 text-fg" : "bg-canvas/70 text-muted"}`}>
            {view.tone === "dashed" ? <span aria-hidden="true" className="pulse inline-block size-1.5 rounded-full bg-accent" /> : null}
            {t(view.stateKey)}
          </span>
        ) : null}
      </div>
    </StageFrame>
  );
}
