import { useEffect, useState, useSyncExternalStore } from "react";

import { hasFlag } from "../domain/flags";
import { useT } from "../i18n/I18nProvider";
import { createLocalMedia, type MediaKind } from "../media/local-media";
import { useNavigate } from "../routing/Navigation";
import { useServices } from "../services";
import type { Notice } from "../session/connection";
import type { Session, SessionSnapshot } from "../session/session";
import { Icon, type IconName } from "../ui/icons";
import { Wordmark } from "../ui/Wordmark";
import { ChatPanel } from "./ChatPanel";
import { ConnectionStatus } from "./ConnectionStatus";
import { EndedPanel } from "./EndedPanel";
import { OwnerPanel } from "./OwnerPanel";
import { PeoplePanel } from "./PeoplePanel";
import { Tile } from "./Tile";

type RoomViewProps = { slug: string; session: Session; snapshot: SessionSnapshot; onEnterAgain: () => void };
type Side = "chat" | "people" | "settings";

const ROUND = "relative grid size-12 shrink-0 place-items-center rounded-full transition-colors duration-200 disabled:opacity-40";
const IDLE = "bg-line-strong text-fg hover:bg-fg/25";
const ON = "bg-fg text-canvas hover:opacity-85";
const OFF = "bg-amber/15 text-amber hover:bg-amber/25";

function grid(count: number): string {
  if (count <= 1) return "grid-cols-1 max-w-4xl";
  if (count <= 2) return "grid-cols-1 sm:grid-cols-2 max-w-6xl";
  if (count <= 4) return "grid-cols-2 max-w-5xl";
  if (count <= 6) return "grid-cols-2 lg:grid-cols-3";
  if (count <= 9) return "grid-cols-3";
  return "grid-cols-3 lg:grid-cols-4";
}

function NoticeLine({ notice }: { notice: Notice }) {
  const t = useT();
  const text =
    notice.kind === "arrived"
      ? t("notice.arrived", { name: notice.name })
      : notice.kind === "left"
        ? t(`notice.left.${notice.reason}`, { name: notice.name })
        : t(`notice.refused.${notice.code}`);
  return <li className="arrive bubble border border-line-strong bg-card px-3.5 py-2 text-sm">{text}</li>;
}

/** The room as a call: the stage of people, the bar of what I can do, and a side panel for the conversation, the people and, for the owner, the room. */
export function RoomView({ slug, session, snapshot, onEnterAgain }: RoomViewProps) {
  const t = useT();
  const navigate = useNavigate();
  const { mediaDevices } = useServices();
  const [media] = useState(() => createLocalMedia(mediaDevices, (flags) => session.setMedia(flags)));
  const local = useSyncExternalStore(media.subscribe, media.getSnapshot);
  const [side, setSide] = useState<Side | undefined>("chat");
  const [seen, setSeen] = useState(0);
  useEffect(() => () => media.dispose(), [media]);

  const { connection, chat } = snapshot;
  const inRoom = connection.phase === "joined" || connection.phase === "reconnecting";
  const people = inRoom ? connection.roster.people : [];
  const myPid = inRoom ? connection.me : undefined;
  const me = people.find((person) => person.pid === myPid);
  const iAmOwner = me !== undefined && hasFlag(me.flags, "owner") && connection.phase === "joined";
  if (side === "chat" && seen !== chat.length) setSeen(chat.length);
  if (side === "settings" && !iAmOwner) setSide("people");
  const unread = side === "chat" ? 0 : chat.length - seen;

  function leave() {
    media.dispose();
    session.leave();
    navigate("/");
  }

  function control(kind: MediaKind, on: IconName, off: IconName, labels: [string, string]) {
    const active = local[kind] !== undefined;
    return (
      <button type="button" aria-pressed={active} aria-label={active ? labels[1] : labels[0]} title={active ? labels[1] : labels[0]} disabled={local.busy !== undefined} className={`${ROUND} ${kind === "screen" ? (active ? ON : IDLE) : active ? IDLE : OFF}`} onClick={() => void media.toggle(kind)}>
        <Icon name={active ? on : off} />
      </button>
    );
  }

  function toggle(panel: Side, icon: IconName, label: string, badge?: number) {
    return (
      <button type="button" aria-pressed={side === panel} aria-label={label} title={label} className={`${ROUND} ${side === panel ? ON : "text-fg hover:bg-fg/10"}`} onClick={() => setSide(side === panel ? undefined : panel)}>
        <Icon name={icon} />
        {badge ? <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-bubble px-1 font-mono text-[0.6875rem] leading-5 font-bold text-on-bubble">{badge > 99 ? "99+" : badge}</span> : null}
      </button>
    );
  }

  if (connection.phase === "ended") {
    return (
      <div className="m-auto w-full max-w-xl px-6 py-10">
        <h1 className="mb-6 font-display text-3xl font-bold tracking-[-0.04em]" translate="no">
          {slug}
        </h1>
        <EndedPanel reason={connection.reason} canRejoin={session.canRejoin()} onRejoin={session.rejoin} onEnterAgain={onEnterAgain} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-canvas">
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
        <Wordmark className="text-sm" />
        <h1 className="max-w-[40vw] truncate font-display text-lg font-bold tracking-[-0.03em]" translate="no">
          {slug}
        </h1>
        <div className="flex justify-end">
          <ConnectionStatus connection={connection} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-3">
        <section aria-label={t("room.peopleHeading", { slug })} className="relative flex min-w-0 flex-1 items-center justify-center">
          {people.length === 0 ? (
            <p className="text-muted">{t("room.gettingReady")}</p>
          ) : (
            <ul className={`mx-auto grid max-h-full w-full content-center gap-3 ${grid(people.length + (local.screen ? 1 : 0))}`}>
              {local.screen ? (
                <li className="relative isolate flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-bubble bg-sunken">
                  <video
                    ref={(element) => {
                      if (element && element.srcObject !== local.screen) element.srcObject = local.screen ?? null;
                    }}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 -z-10 size-full object-contain"
                  />
                  <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-canvas/70 px-2.5 py-1 text-sm font-semibold">{t("room.yourScreen")}</span>
                </li>
              ) : null}
              {people.map((person) => (
                <Tile key={person.pid} person={person} isMe={person.pid === myPid} video={person.pid === myPid ? local.camera : undefined} />
              ))}
            </ul>
          )}
          <ul role="status" className="pointer-events-none absolute top-2 left-2 flex max-w-sm flex-col items-start gap-2">
            {inRoom ? connection.notices.map((notice) => <NoticeLine key={notice.id} notice={notice} />) : null}
            {local.problem ? <li className="arrive bubble border border-amber bg-card px-3.5 py-2 text-sm text-amber">{t(`media.${local.problem.why}.${local.problem.kind}`)}</li> : null}
          </ul>
        </section>

        {side ? (
          <aside aria-label={t(`side.${side}`)} className="swap-in flex w-[min(22.5rem,100%)] shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-card max-md:absolute max-md:inset-x-3 max-md:top-14 max-md:bottom-24 max-md:z-10 max-md:w-auto">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-4">
              <h2 className="font-display text-lg font-bold tracking-[-0.03em]">{t(`side.${side}`)}</h2>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">{t("room.peopleCount", { count: people.length })}</span>
                <button type="button" aria-label={t("side.close")} className="grid size-9 place-items-center rounded-full text-muted transition-colors duration-200 hover:bg-fg/10 hover:text-fg" onClick={() => setSide(undefined)}>
                  <Icon name="close" className="size-4" />
                </button>
              </span>
            </div>
            {side === "chat" ? (
              <ChatPanel lines={chat} me={myPid} canSend={connection.phase === "joined"} onSay={session.say} />
            ) : side === "people" ? (
              <PeoplePanel people={people} me={myPid} canModerate={iAmOwner} onRemove={(pid) => session.owner({ op: "remove", pid })} onTransfer={(pid) => session.owner({ op: "transfer", pid })} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <OwnerPanel slug={slug} session={session} snapshot={snapshot} />
              </div>
            )}
          </aside>
        ) : null}
      </div>

      <footer className="grid h-20 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
        <p className="truncate text-sm text-muted max-md:hidden">{t("room.mediaNote")}</p>
        <div role="toolbar" aria-label={t("dock.label")} className="col-start-2 flex items-center gap-2.5">
          {control("microphone", "mic", "micOff", [t("dock.micOn"), t("dock.micOff")])}
          {control("camera", "camera", "cameraOff", [t("dock.cameraOn"), t("dock.cameraOff")])}
          {control("screen", "screen", "screen", [t("dock.screenOn"), t("dock.screenOff")])}
          <button type="button" aria-pressed={local.hand} aria-label={t(local.hand ? "dock.handDown" : "dock.handUp")} title={t(local.hand ? "dock.handDown" : "dock.handUp")} className={`${ROUND} ${local.hand ? "bg-bubble text-on-bubble hover:opacity-85" : IDLE}`} onClick={media.toggleHand}>
            <Icon name="hand" />
          </button>
          <button type="button" className="ml-1 inline-flex h-12 items-center gap-2 rounded-full bg-amber px-5 font-semibold text-ink transition-opacity duration-200 hover:opacity-85" onClick={leave}>
            <Icon name="leave" />
            {t("room.leave")}
          </button>
        </div>
        <div className="flex items-center justify-end gap-1">
          {iAmOwner ? toggle("settings", "settings", t("side.settings")) : null}
          {toggle("people", "people", t("side.people"))}
          {toggle("chat", "chat", t("side.chat"), unread)}
        </div>
      </footer>
    </div>
  );
}
