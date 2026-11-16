import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { hasFlag } from "../domain/flags";
import { useT } from "../i18n/I18nProvider";
import { createLocalMedia, type Device, type LocalMedia, type LocalMediaSnapshot, type MediaKind } from "../media/local-media";
import { useNavigate } from "../routing/Navigation";
import { useServices } from "../services";
import type { Notice } from "../session/connection";
import type { Session, SessionSnapshot } from "../session/session";
import { Icon, type IconName } from "../ui/icons";
import { Segmented } from "../ui/Segmented";
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
const ON = "bg-bubble text-on-bubble hover:opacity-85";
const MUTED = "bg-line-strong text-muted hover:bg-fg/25 hover:text-fg";
const OPEN = "bg-fg text-canvas hover:opacity-85";

function Caret() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

function DeviceList({ label, devices, chosen, onChoose }: { label: string; devices: readonly Device[]; chosen: string | undefined; onChoose(id: string): void }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      {devices.length === 0 ? (
        <p className="text-sm text-muted">{t("menu.noDevices")}</p>
      ) : (
        <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
          {devices.map((device, index) => {
            const checked = chosen ? chosen === device.id : index === 0;
            return (
              <label key={device.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-2.5 text-sm transition-colors duration-200 hover:bg-fg/8 has-checked:bg-fg/10 has-focus-visible:outline-2 has-focus-visible:outline-fg/55">
                <input type="radio" name={label} className="sr-only" checked={checked} onChange={() => onChoose(device.id)} />
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${checked ? "bg-bubble" : "border border-muted-light"}`} />
                <span className="min-w-0 flex-1 truncate">{device.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function Options({ kind, media, local, onClose }: { kind: "microphone" | "camera"; media: LocalMedia; local: LocalMediaSnapshot; onClose(): void }) {
  const t = useT();
  return (
    <>
      <button type="button" aria-label={t("menu.close")} className="fixed inset-0 z-20 cursor-default" onClick={onClose} />
      <div role="dialog" aria-label={t(kind === "microphone" ? "dock.micMenu" : "dock.cameraMenu")} className="swap-in bubble absolute bottom-[calc(100%+0.75rem)] left-1/2 z-30 flex w-80 -translate-x-1/2 flex-col gap-4 border border-line-strong bg-card p-4 text-left">
        {kind === "microphone" ? (
          <>
            <DeviceList label={t("menu.microphone")} devices={local.microphones} chosen={local.microphoneId} onChoose={(id) => void media.choose("microphone", id)} />
            <div>
              <p className="mb-1.5 text-sm font-semibold">{t("menu.voiceFilter")}</p>
              <Segmented<"off" | "standard">
                label={t("menu.voiceFilter")}
                value={local.voiceFilter}
                onChange={(filter) => void media.setVoiceFilter(filter)}
                options={[
                  { value: "off", text: t("menu.filterOff") },
                  { value: "standard", text: t("menu.filterStandard") },
                ]}
              />
              <p className="mt-2 text-[0.8125rem] leading-snug text-muted">{t("menu.filterHint")}</p>
            </div>
          </>
        ) : (
          <DeviceList label={t("menu.camera")} devices={local.cameras} chosen={local.cameraId} onChoose={(id) => void media.choose("camera", id)} />
        )}
      </div>
    </>
  );
}

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
  const { mediaDevices, lookMemory } = useServices();
  const [media] = useState(() => createLocalMedia(mediaDevices, (flags) => session.setMedia(flags)));
  const local = useSyncExternalStore(media.subscribe, media.getSnapshot);
  const [side, setSide] = useState<Side | undefined>("chat");
  const [shown, setShown] = useState<Side>("chat");
  const [menu, setMenu] = useState<"microphone" | "camera" | undefined>();
  const [seen, setSeen] = useState(0);
  if (side && side !== shown) setShown(side);
  useEffect(() => () => media.dispose(), [media]);

  const { connection, chat } = snapshot;
  const inRoom = connection.phase === "joined" || connection.phase === "reconnecting";
  const people = inRoom ? connection.roster.people : [];
  const myPid = inRoom ? connection.me : undefined;
  const me = people.find((person) => person.pid === myPid);
  const iAmOwner = me !== undefined && hasFlag(me.flags, "owner") && connection.phase === "joined";
  if (side === "chat" && seen !== chat.length) setSeen(chat.length);
  if (side === "settings" && !iAmOwner) setSide("people");
  if (shown === "settings" && !iAmOwner) setShown("people");
  const unread = side === "chat" ? 0 : chat.length - seen;

  function leave() {
    media.dispose();
    session.leave();
    navigate("/");
  }

  function control(kind: MediaKind, on: IconName, off: IconName, labels: [string, string]) {
    const active = local[kind] !== undefined;
    return (
      <button type="button" aria-pressed={active} aria-label={active ? labels[1] : labels[0]} title={active ? labels[1] : labels[0]} disabled={local.busy !== undefined} className={`${ROUND} ${active ? ON : kind === "screen" ? IDLE : MUTED}`} onClick={() => void media.toggle(kind)}>
        <Icon name={active ? on : off} />
      </button>
    );
  }

  function withOptions(kind: "microphone" | "camera", button: ReactNode, label: string) {
    return (
      <div className="relative flex items-center rounded-full bg-card pr-1">
        {button}
        <button
          type="button"
          aria-expanded={menu === kind}
          aria-label={label}
          title={label}
          className="grid h-12 w-8 place-items-center rounded-full text-muted transition-colors duration-200 hover:text-fg"
          onClick={() => {
            void media.refreshDevices();
            setMenu(menu === kind ? undefined : kind);
          }}
        >
          <Caret />
        </button>
        {menu === kind ? <Options kind={kind} media={media} local={local} onClose={() => setMenu(undefined)} /> : null}
      </div>
    );
  }

  function toggle(panel: Side, icon: IconName, label: string, badge?: number) {
    return (
      <button type="button" aria-pressed={side === panel} aria-label={label} title={label} className={`${ROUND} ${side === panel ? OPEN : "text-fg hover:bg-fg/10"}`} onClick={() => setSide(side === panel ? undefined : panel)}>
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
            {local.problem ? <li className="arrive bubble border border-fg/40 bg-card px-3.5 py-2 text-sm">{t(`media.${local.problem.why}.${local.problem.kind}`)}</li> : null}
          </ul>
        </section>

        <aside
          aria-label={t(`side.${shown}`)}
          inert={!side}
          className={`flex shrink-0 justify-end overflow-hidden transition-[width,opacity,margin] duration-500 ease-(--ease-glide) max-md:absolute max-md:inset-x-3 max-md:top-14 max-md:bottom-24 max-md:z-10 ${side ? "w-[22.5rem] opacity-100 max-md:w-auto" : "-ml-3 w-0 opacity-0 max-md:hidden"}`}
        >
          <div className="flex w-[22.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-card max-md:w-full">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-4">
              <h2 key={shown} className="swap-in font-display text-lg font-bold tracking-[-0.03em]">
                {t(`side.${shown}`)}
              </h2>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">{t("room.peopleCount", { count: people.length })}</span>
                <button type="button" aria-label={t("side.close")} className="grid size-9 place-items-center rounded-full text-muted transition-colors duration-200 hover:bg-fg/10 hover:text-fg" onClick={() => setSide(undefined)}>
                  <Icon name="close" className="size-4" />
                </button>
              </span>
            </div>
            <div key={shown} className={`flex min-h-0 flex-1 flex-col ${shown === "chat" ? "swap-from-right" : "swap-from-left"}`}>
              {shown === "chat" ? (
                <ChatPanel lines={chat} me={myPid} canSend={connection.phase === "joined"} onSay={session.say} />
              ) : shown === "people" ? (
                <PeoplePanel
                  people={people}
                  me={myPid}
                  canModerate={iAmOwner}
                  onRemove={(pid) => session.owner({ op: "remove", pid })}
                  onTransfer={(pid) => session.owner({ op: "transfer", pid })}
                  onLook={(look) => {
                    lookMemory.write(look);
                    session.setLook(look);
                  }}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <OwnerPanel slug={slug} session={session} snapshot={snapshot} />
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer className="grid h-20 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
        <p className="truncate text-sm text-muted max-md:hidden">{t("room.mediaNote")}</p>
        <div role="toolbar" aria-label={t("dock.label")} className="col-start-2 flex items-center gap-2.5">
          {withOptions("microphone", control("microphone", "mic", "micOff", [t("dock.micOn"), t("dock.micOff")]), t("dock.micMenu"))}
          {withOptions("camera", control("camera", "camera", "cameraOff", [t("dock.cameraOn"), t("dock.cameraOff")]), t("dock.cameraMenu"))}
          {control("screen", "screen", "screen", [t("dock.screenOn"), t("dock.screenOff")])}
          <button type="button" aria-pressed={local.hand} aria-label={t(local.hand ? "dock.handDown" : "dock.handUp")} title={t(local.hand ? "dock.handDown" : "dock.handUp")} className={`${ROUND} ${local.hand ? "bg-bubble text-on-bubble hover:opacity-85" : IDLE}`} onClick={media.toggleHand}>
            <Icon name="hand" />
          </button>
          <button type="button" className="ml-1 inline-flex h-12 items-center gap-2 rounded-full bg-fg px-5 font-semibold text-canvas transition-opacity duration-200 hover:opacity-85" onClick={leave}>
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
