import {
  Suspense,
  lazy,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { hasFlag } from "../domain/flags";
import { shareLink } from "../domain/share-link";
import { createBoardSync } from "../board/board-sync";
import { useChooseLocale, useLocale, useT } from "../i18n/I18nProvider";
import { createRoomMedia, type Source } from "../media/room-media";
import {
  createLocalMedia,
  type Device,
  type LocalMedia,
  type LocalMediaSnapshot,
  type MediaKind,
} from "../media/local-media";
import { useNavigate } from "../routing/Navigation";
import { useServices } from "../services";
import type { Notice } from "../session/connection";
import type { Session, SessionSnapshot } from "../session/session";
import { Avatar } from "../ui/Avatar";
import { withMotion } from "../ui/motion";
import { CommandPalette } from "../ui/CommandPalette";
import { Icon, type IconName } from "../ui/icons";
import { Sheet } from "../ui/Sheet";
import { Segmented } from "../ui/Segmented";
import { Wordmark } from "../ui/Wordmark";
import { ChatPanel } from "./ChatPanel";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionStatus } from "./ConnectionStatus";
import { EndedPanel } from "./EndedPanel";
import { LookPicker } from "./LookPicker";
import { OwnerPanel } from "./OwnerPanel";
import { PeoplePanel } from "./PeoplePanel";
import { Tile } from "./Tile";

const Whiteboard = lazy(() => import("../board/Whiteboard"));

type RoomViewProps = {
  slug: string;
  session: Session;
  snapshot: SessionSnapshot;
  onEnterAgain: () => void;
};
type Side = "chat" | "people" | "settings";

const ROUND =
  "relative grid size-12 shrink-0 place-items-center rounded-full transition-colors duration-200 disabled:opacity-40";
const IDLE = "bg-line-strong text-fg hover:bg-fg/25";
const ON = "bg-bubble text-on-bubble hover:opacity-85";
const MUTED = "bg-line-strong text-muted hover:bg-fg/25 hover:text-fg";
const OPEN = "bg-fg text-canvas hover:opacity-85";

function Caret() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

function DeviceList({
  label,
  devices,
  chosen,
  onChoose,
}: {
  label: string;
  devices: readonly Device[];
  chosen: string | undefined;
  onChoose(id: string): void;
}) {
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
              <label
                key={device.id}
                className="flex min-h-10 cursor-pointer items-center gap-3 bubble px-2.5 text-sm transition-colors duration-200 hover:bg-fg/8 has-checked:bg-fg/10 has-focus-visible:outline-2 has-focus-visible:outline-fg/55"
              >
                <input
                  type="radio"
                  name={label}
                  className="sr-only"
                  checked={checked}
                  onChange={() => onChoose(device.id)}
                />
                <span
                  aria-hidden="true"
                  className={`size-2.5 shrink-0 rounded-full ${checked ? "bg-bubble" : "border border-muted-light"}`}
                />
                <span className="min-w-0 flex-1 truncate">{device.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function Options({
  kind,
  media,
  local,
  onClose,
}: {
  kind: "microphone" | "camera";
  media: LocalMedia;
  local: LocalMediaSnapshot;
  onClose(): void;
}) {
  const t = useT();
  return (
    <>
      <button
        type="button"
        aria-label={t("menu.close")}
        className="fixed inset-0 z-20 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={t(
          kind === "microphone" ? "dock.micMenu" : "dock.cameraMenu",
        )}
        className="swap-in bubble absolute bottom-[calc(100%+0.75rem)] left-1/2 z-30 flex w-80 -translate-x-1/2 flex-col gap-4 border border-line-strong bg-card p-4 text-left"
      >
        {kind === "microphone" ? (
          <>
            <DeviceList
              label={t("menu.microphone")}
              devices={local.microphones}
              chosen={local.microphoneId}
              onChoose={(id) => void media.choose("microphone", id)}
            />
            <div>
              <p className="mb-1.5 text-sm font-semibold">
                {t("menu.voiceFilter")}
              </p>
              <Segmented<"off" | "standard">
                label={t("menu.voiceFilter")}
                value={local.voiceFilter}
                onChange={(filter) => void media.setVoiceFilter(filter)}
                options={[
                  { value: "off", text: t("menu.filterOff") },
                  { value: "standard", text: t("menu.filterStandard") },
                ]}
              />
              <p className="mt-2 text-[0.8125rem] leading-snug text-muted">
                {t("menu.filterHint")}
              </p>
            </div>
          </>
        ) : (
          <DeviceList
            label={t("menu.camera")}
            devices={local.cameras}
            chosen={local.cameraId}
            onChoose={(id) => void media.choose("camera", id)}
          />
        )}
      </div>
    </>
  );
}

/** What I chose to see of one person: their tile at all, their camera on it, and their screen. */
type Seeing = { tile: boolean; camera: boolean; screen: boolean };

const SEE_ALL: Seeing = { tile: true, camera: true, screen: true };
const CHIP =
  "bubble-word h-8 border border-line-strong px-3 text-xs font-semibold text-muted transition-colors duration-200 hover:border-fg/50 aria-pressed:border-transparent aria-pressed:bg-bubble aria-pressed:text-on-bubble";

function attach(stream: MediaStream | undefined) {
  return (element: HTMLMediaElement | null) => {
    if (element && element.srcObject !== (stream ?? null))
      element.srcObject = stream ?? null;
  };
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
  return (
    <li className="arrive bubble border border-line-strong bg-card px-3.5 py-2 text-sm">
      {text}
    </li>
  );
}

/** The room as a call: the stage of people, the bar of what I can do, and a side panel for the conversation, the people and, for the owner, the room. */
export function RoomView({
  slug,
  session,
  snapshot,
  onEnterAgain,
}: RoomViewProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { mediaDevices, lookMemory, faceMemory, rtc } = useServices();
  const [media] = useState(() =>
    createLocalMedia(mediaDevices, (flags) => session.setMedia(flags)),
  );
  const local = useSyncExternalStore(media.subscribe, media.getSnapshot);
  const [roomMedia] = useState(() =>
    createRoomMedia(rtc, (signal) => void session.sendRtc(signal)),
  );
  const remote = useSyncExternalStore(
    roomMedia.subscribe,
    roomMedia.getSnapshot,
  );
  const [board] = useState(() => createBoardSync((message, to) => session.sendBoard(message, to)));
  const [boardOpen, setBoardOpen] = useState(false);
  useEffect(() => {
    const stop = session.onRtc((event) => {
      if (event.kind === "signal") return roomMedia.signal(event.signal);
      roomMedia.restart();
      board.hello();
    });
    const stopBoard = session.onBoard((from, data) => {
      const { connection } = session.getSnapshot();
      if (connection.phase !== "joined" && connection.phase !== "reconnecting") return;
      board.remote(from, data, connection.me, connection.roster.people.map((person) => person.pid).filter((pid) => pid !== connection.me));
    });
    return () => {
      stop();
      stopBoard();
      board.stop();
      roomMedia.dispose();
    };
  }, [session, roomMedia, board]);
  useEffect(() => {
    const tracks: Partial<Record<Source, MediaStreamTrack>> = {};
    const add = (source: Source, track: MediaStreamTrack | undefined) => {
      if (track) tracks[source] = track;
    };
    add("microphone", local.microphone?.getAudioTracks()[0]);
    add("camera", local.camera?.getVideoTracks()[0]);
    add("screen", local.screen?.getVideoTracks()[0]);
    add("screenAudio", local.screen?.getAudioTracks()[0]);
    roomMedia.publish(tracks);
  }, [roomMedia, local.microphone, local.camera, local.screen]);
  const [side, setSide] = useState<Side | undefined>("chat");
  const [shown, setShown] = useState<Side>("chat");
  const [menu, setMenu] = useState<
    "microphone" | "camera" | "more" | undefined
  >();
  const [sheet, setSheet] = useState<
    "shortcuts" | "look" | "visibility" | undefined
  >();
  const [seeing, setSeeing] = useState<Readonly<Record<number, Seeing>>>({});
  const [personMenu, setPersonMenu] = useState<
    { pid: number; x: number; y: number } | undefined
  >();
  const [privately, setPrivately] = useState(false);
  const [palette, setPalette] = useState(false);
  const choose = useChooseLocale();
  const { clipboard, origin } = useServices();
  const [peer, setPeer] = useState<number | undefined>();
  const sees = (pid: number): Seeing => seeing[pid] ?? SEE_ALL;
  const see = (pid: number, change: Partial<Seeing>) =>
    setSeeing({ ...seeing, [pid]: { ...sees(pid), ...change } });
  const [stats, setStats] = useState(false);
  const [seen, setSeen] = useState(0);
  if (side && side !== shown) setShown(side);
  useEffect(() => () => media.dispose(), [media]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest("[data-board]")) return;
      const key = event.key.toLowerCase();
      const act =
        !event.altKey && !event.shiftKey && key === "k"
          ? () => setPalette((open) => !open)
          : !event.altKey && !event.shiftKey && key === "d"
            ? () => void media.toggle("microphone")
            : !event.altKey && !event.shiftKey && key === "e"
              ? () => void media.toggle("camera")
              : !event.altKey && event.shiftKey && key === "e"
                ? () => void media.toggle("screen")
                : event.altKey && key === "h"
                  ? media.toggleHand
                  : event.altKey && key === "c"
                    ? () =>
                        setSide((current) =>
                          current === "chat" ? undefined : "chat",
                        )
                    : event.altKey && key === "p"
                      ? () =>
                          setSide((current) =>
                            current === "people" ? undefined : "people",
                          )
                      : undefined;
      if (!act) return;
      event.preventDefault();
      act();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media]);

  const { connection, chat } = snapshot;
  const inRoom =
    connection.phase === "joined" || connection.phase === "reconnecting";
  const people = inRoom ? connection.roster.people : [];
  const myPid = inRoom ? connection.me : undefined;
  const me = people.find((person) => person.pid === myPid);
  const iAmOwner =
    me !== undefined &&
    hasFlag(me.flags, "owner") &&
    connection.phase === "joined";
  if (side === "chat" && seen !== chat.length) setSeen(chat.length);
  if (side === "settings" && !iAmOwner) setSide("people");
  if (shown === "settings" && !iAmOwner) setShown("people");
  const unread = side === "chat" ? 0 : chat.length - seen;
  const shownPeople = people.filter((person) => sees(person.pid).tile);
  const screens = people.filter(
    (person) =>
      person.pid !== myPid &&
      remote[person.pid]?.screen &&
      sees(person.pid).screen,
  );

  function leave() {
    withMotion("back", () => {
      media.dispose();
      session.leave();
      navigate("/");
    });
  }

  function control(
    kind: MediaKind,
    on: IconName,
    off: IconName,
    labels: [string, string],
  ) {
    const active = local[kind] !== undefined;
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={active ? labels[1] : labels[0]}
        title={active ? labels[1] : labels[0]}
        disabled={local.busy !== undefined}
        className={`${ROUND} ${active ? ON : kind === "screen" ? IDLE : MUTED}`}
        onClick={() => void media.toggle(kind)}
      >
        <Icon name={active ? on : off} />
      </button>
    );
  }

  function withOptions(
    kind: "microphone" | "camera",
    button: ReactNode,
    label: string,
  ) {
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
        {menu === kind ? (
          <Options
            kind={kind}
            media={media}
            local={local}
            onClose={() => setMenu(undefined)}
          />
        ) : null}
      </div>
    );
  }

  function toggle(
    panel: Side,
    icon: IconName,
    label: string,
    badge?: number,
    quiet = false,
  ) {
    return (
      <button
        type="button"
        aria-pressed={side === panel}
        aria-label={label}
        title={label}
        className={`${ROUND} size-11 ${side === panel ? OPEN : "text-fg hover:bg-fg/10"}`}
        onClick={() => setSide(side === panel ? undefined : panel)}
      >
        <Icon name={icon} />
        {badge ? (
          <span
            className={`absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full px-1 font-mono text-[0.6875rem] leading-5 font-bold ${quiet ? "border border-line-strong bg-canvas text-accent" : "bg-bubble text-on-bubble"}`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>
    );
  }

  if (connection.phase === "ended") {
    return (
      <div className="m-auto w-full max-w-xl px-6 py-10">
        <h1
          className="mb-6 font-display text-3xl font-bold tracking-[-0.04em]"
          translate="no"
        >
          {slug}
        </h1>
        <EndedPanel
          reason={connection.reason}
          canRejoin={session.canRejoin()}
          onRejoin={session.rejoin}
          onEnterAgain={() => withMotion("back", onEnterAgain)}
          onHome={() => withMotion("back", () => navigate("/"))}
        />
      </div>
    );
  }

  return (
    <div className="page-forward flex h-dvh min-h-0 flex-col bg-canvas">
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
        <Wordmark className="text-sm" />
        <div className="flex max-w-[60vw] items-center gap-3">
          <h1
            className="min-w-0 truncate font-display text-lg font-bold tracking-[-0.03em]"
            translate="no"
          >
            {slug}
          </h1>
          <ConnectionStatus connection={connection} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-3">
        <section
          aria-label={t("room.peopleHeading", { slug })}
          className="relative flex min-w-0 flex-1 items-center justify-center"
        >
          {boardOpen ? (
            <div data-board role="region" aria-label={t("board.label")} className="swap-in absolute inset-0 z-10 flex flex-col overflow-hidden rounded-2xl border border-line-strong bg-card">
              <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-4">
                <h2 className="font-display text-base font-bold tracking-[-0.03em]">{t("board.label")}</h2>
                <button type="button" aria-label={t("board.close")} className="grid size-9 place-items-center rounded-full text-muted transition-colors duration-200 hover:bg-fg/10 hover:text-fg" onClick={() => setBoardOpen(false)}>
                  <Icon name="minimize" className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <Suspense fallback={<p role="status" className="grid h-full place-items-center text-muted">{t("board.loading")}</p>}>
                  <Whiteboard sync={board} langCode={locale === "pt-BR" ? "pt-BR" : "en"} />
                </Suspense>
              </div>
            </div>
          ) : null}
          {people.length === 0 ? (
            <p className="text-muted">{t("room.gettingReady")}</p>
          ) : shownPeople.length === 0 &&
            screens.length === 0 &&
            !local.screen ? (
            <p className="text-muted">{t("visibility.none")}</p>
          ) : (
            <ul
              className={`mx-auto grid max-h-full w-full content-center gap-3 ${grid(shownPeople.length + (local.screen ? 1 : 0) + screens.length)}`}
            >
              {local.screen ? (
                <li className="relative isolate flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-bubble bg-sunken">
                  <video
                    ref={(element) => {
                      if (element && element.srcObject !== local.screen)
                        element.srcObject = local.screen ?? null;
                    }}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 -z-10 size-full object-contain"
                  />
                  <span className="absolute bottom-2.5 left-2.5 bubble-word bg-canvas/70 px-2.5 py-1 text-sm font-semibold">
                    {t("room.yourScreen")}
                  </span>
                </li>
              ) : null}
              {screens.map((person) => (
                <li
                  key={`screen-${person.pid}`}
                  className="relative isolate flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-bubble bg-sunken"
                >
                  <video
                    ref={attach(remote[person.pid]?.screen)}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 -z-10 size-full object-contain"
                  />
                  <span
                    className="absolute bottom-2.5 left-2.5 bubble-word bg-canvas/70 px-2.5 py-1 text-sm font-semibold"
                    translate="no"
                  >
                    {t("room.screenOf", { name: person.name })}
                  </span>
                </li>
              ))}
              {shownPeople.map((person) => (
                <Tile
                  key={person.pid}
                  person={person}
                  isMe={person.pid === myPid}
                  video={
                    !sees(person.pid).camera
                      ? undefined
                      : person.pid === myPid
                        ? local.camera
                        : remote[person.pid]?.camera
                  }
                  photo={snapshot.photos[person.pid]}
                  onMenu={(at) => setPersonMenu({ pid: person.pid, ...at })}
                />
              ))}
            </ul>
          )}
          {Object.entries(remote).flatMap(([pid, sources]) =>
            Number(pid) === myPid
              ? []
              : (["microphone", "screenAudio"] as const).flatMap((source) =>
                  sources[source]
                    ? [
                        <audio
                          key={`${pid}-${source}`}
                          ref={attach(sources[source])}
                          autoPlay
                        />,
                      ]
                    : [],
                ),
          )}
          <ul
            role="status"
            className="pointer-events-none absolute top-2 left-2 flex max-w-sm flex-col items-start gap-2"
          >
            {inRoom
              ? connection.notices.map((notice) => (
                  <NoticeLine key={notice.id} notice={notice} />
                ))
              : null}
            {local.problem ? (
              <li className="arrive bubble border border-fg/40 bg-card px-3.5 py-2 text-sm">
                {t(`media.${local.problem.why}.${local.problem.kind}`)}
              </li>
            ) : null}
          </ul>
        </section>

        <aside
          aria-label={t(`side.${shown}`)}
          inert={!side}
          className={`flex shrink-0 justify-end overflow-hidden transition-[width,opacity,margin] duration-500 ease-(--ease-glide) max-md:absolute max-md:inset-x-3 max-md:top-14 max-md:bottom-24 max-md:z-10 md:relative md:z-10 md:-mt-11 ${side ? "w-[22.5rem] opacity-100 max-md:w-auto" : "-ml-3 w-0 opacity-0 max-md:hidden"}`}
        >
          <div className="flex w-[22.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-card max-md:w-full">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-4">
              <h2
                key={shown}
                className="swap-in font-display text-lg font-bold tracking-[-0.03em]"
              >
                {t(`side.${shown}`)}
              </h2>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t("side.close")}
                  className="grid size-9 place-items-center rounded-full text-muted transition-colors duration-200 hover:bg-fg/10 hover:text-fg"
                  onClick={() => setSide(undefined)}
                >
                  <Icon name="minimize" className="size-4" />
                </button>
              </span>
            </div>
            <div
              key={shown}
              className={`flex min-h-0 flex-1 flex-col ${shown === "chat" ? "swap-from-right" : "swap-from-left"}`}
            >
              {shown === "chat" ? (
                <ChatPanel
                  lines={chat}
                  me={myPid}
                  people={people}
                  photos={snapshot.photos}
                  canSend={connection.phase === "joined"}
                  peer={peer}
                  onPeer={setPeer}
                  privately={privately}
                  onPrivately={setPrivately}
                  onSay={session.say}
                />
              ) : shown === "people" ? (
                <PeoplePanel
                  people={people}
                  me={myPid}
                  canModerate={iAmOwner}
                  onRemove={(pid) => session.owner({ op: "remove", pid })}
                  onTransfer={(pid) => session.owner({ op: "transfer", pid })}
                  photos={snapshot.photos}
                  onEditLook={() => setSheet("look")}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <OwnerPanel
                    slug={slug}
                    session={session}
                    snapshot={snapshot}
                  />
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {palette ? (
        <CommandPalette
          onClose={() => setPalette(false)}
          commands={[
            {
              id: "mic",
              group: t("palette.group.call"),
              label: t(local.microphone ? "dock.micOff" : "dock.micOn"),
              keys: "Ctrl+D",
              run: () => void media.toggle("microphone"),
            },
            {
              id: "camera",
              group: t("palette.group.call"),
              label: t(local.camera ? "dock.cameraOff" : "dock.cameraOn"),
              keys: "Ctrl+E",
              run: () => void media.toggle("camera"),
            },
            {
              id: "screen",
              group: t("palette.group.call"),
              label: t(local.screen ? "dock.screenOff" : "dock.screenOn"),
              keys: "Ctrl+Shift+E",
              run: () => void media.toggle("screen"),
            },
            {
              id: "hand",
              group: t("palette.group.call"),
              label: t(local.hand ? "dock.handDown" : "dock.handUp"),
              keys: "Ctrl+Alt+H",
              run: media.toggleHand,
            },
            {
              id: "leave",
              group: t("palette.group.call"),
              label: t("room.leave"),
              run: leave,
            },
            {
              id: "chat",
              group: t("palette.group.panels"),
              label: t("side.chat"),
              keys: "Ctrl+Alt+C",
              run: () => (setPrivately(false), setSide("chat")),
            },
            {
              id: "people",
              group: t("palette.group.panels"),
              label: t("side.people"),
              keys: "Ctrl+Alt+P",
              run: () => setSide("people"),
            },
            ...(iAmOwner
              ? [
                  {
                    id: "settings",
                    group: t("palette.group.panels"),
                    label: t("side.settings"),
                    run: () => setSide("settings"),
                  },
                ]
              : []),
            { id: "board", group: t("palette.group.room"), label: t("more.board"), run: () => setBoardOpen((open) => !open) },
            {
              id: "look",
              group: t("palette.group.room"),
              label: t("more.look"),
              run: () => setSheet("look"),
            },
            {
              id: "visibility",
              group: t("palette.group.room"),
              label: t("more.visibility"),
              run: () => setSheet("visibility"),
            },
            {
              id: "connection",
              group: t("palette.group.room"),
              label: t("more.connection"),
              run: () => setStats(true),
            },
            {
              id: "shortcuts",
              group: t("palette.group.room"),
              label: t("more.shortcuts"),
              run: () => setSheet("shortcuts"),
            },
            {
              id: "link",
              group: t("palette.group.room"),
              label: t("palette.copyLink"),
              run: () =>
                void clipboard.write(
                  shareLink(
                    origin,
                    slug,
                    snapshot.private ? snapshot.password : undefined,
                  ),
                ),
            },
            ...people
              .filter((person) => person.pid !== myPid)
              .map((person) => ({
                id: `dm-${person.pid}`,
                group: t("palette.group.people"),
                label: t("palette.dm", { name: person.name }),
                run: () => {
                  setPeer(person.pid);
                  setPrivately(true);
                  setSide("chat");
                },
              })),
            {
              id: "en",
              group: t("palette.group.language"),
              label: "English",
              run: () => choose("en"),
            },
            {
              id: "pt",
              group: t("palette.group.language"),
              label: "Português",
              run: () => choose("pt-BR"),
            },
          ]}
        />
      ) : null}

      {personMenu && people.some((person) => person.pid === personMenu.pid) ? (
        <>
          <button
            type="button"
            aria-label={t("menu.close")}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setPersonMenu(undefined)}
            onContextMenu={(event) => (
              event.preventDefault(),
              setPersonMenu(undefined)
            )}
          />
          <ul
            role="menu"
            aria-label={t("person.menu", {
              name:
                people.find((person) => person.pid === personMenu.pid)?.name ??
                "",
            })}
            style={{
              left: Math.min(personMenu.x, window.innerWidth - 272),
              top: Math.min(personMenu.y, window.innerHeight - 260),
            }}
            className="swap-in bubble fixed z-40 flex w-64 flex-col border border-line-strong bg-card p-2"
          >
            {(
              [
                ...(personMenu.pid === myPid
                  ? [[t("more.look"), () => setSheet("look")] as const]
                  : [
                      [
                        t("person.dm"),
                        () => {
                          setPeer(personMenu.pid);
                          setPrivately(true);
                          setSide("chat");
                        },
                      ] as const,
                    ]),
                ...(["tile", "camera", "screen"] as const).map(
                  (part) =>
                    [
                      t(
                        sees(personMenu.pid)[part]
                          ? `person.hide.${part}`
                          : `person.show.${part}`,
                      ),
                      () =>
                        see(personMenu.pid, {
                          [part]: !sees(personMenu.pid)[part],
                        }),
                    ] as const,
                ),
                ...(iAmOwner && personMenu.pid !== myPid
                  ? [
                      [
                        t("owner.transferShort"),
                        () =>
                          void session.owner({
                            op: "transfer",
                            pid: personMenu.pid,
                          }),
                      ] as const,
                      [
                        t("owner.removeShort"),
                        () =>
                          void session.owner({
                            op: "remove",
                            pid: personMenu.pid,
                          }),
                      ] as const,
                    ]
                  : []),
              ] as const
            ).map(([label, run]) => (
              <li key={label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-10 w-full items-center bubble px-3 text-left text-sm transition-colors duration-200 hover:bg-fg/8"
                  onClick={() => {
                    setPersonMenu(undefined);
                    run();
                  }}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {stats ? (
        <ConnectionCard snapshot={snapshot} onClose={() => setStats(false)} />
      ) : null}

      {sheet === "shortcuts" ? (
        <Sheet
          title={t("more.shortcuts")}
          closeLabel={t("more.close")}
          onClose={() => setSheet(undefined)}
        >
          <dl className="flex flex-col gap-2 text-sm">
            {[
              [t("shortcut.palette"), "Ctrl+K"],
              [t("shortcut.mic"), "Ctrl+D"],
              [t("shortcut.camera"), "Ctrl+E"],
              [t("shortcut.screen"), "Ctrl+Shift+E"],
              [t("shortcut.hand"), "Ctrl+Alt+H"],
              [t("shortcut.chat"), "Ctrl+Alt+C"],
              [t("shortcut.people"), "Ctrl+Alt+P"],
            ].map(([term, value]) => (
              <div
                key={term}
                className="bubble flex items-baseline justify-between gap-4 border border-line-strong bg-canvas px-3.5 py-2.5"
              >
                <dt>{term}</dt>
                <dd className="text-right font-mono text-[0.8125rem] text-accent">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Sheet>
      ) : sheet === "look" && me ? (
        <Sheet
          title={t("look.heading")}
          closeLabel={t("more.close")}
          onClose={() => setSheet(undefined)}
          wide
        >
          <LookPicker
            look={me.look}
            face={me.face}
            name={me.name}
            photo={snapshot.photos[me.pid]}
            onSave={(look, face) => {
              lookMemory.write(look);
              faceMemory.write(face);
              session.setLook(look, face);
              setSheet(undefined);
            }}
            onCancel={() => setSheet(undefined)}
            onPhoto={session.setPhoto}
          />
        </Sheet>
      ) : sheet === "visibility" ? (
        <Sheet
          title={t("more.visibility")}
          closeLabel={t("more.close")}
          onClose={() => setSheet(undefined)}
        >
          <p className="mb-3 text-sm text-muted">{t("visibility.hint")}</p>
          <ul className="flex flex-col gap-2">
            {people.map((person) => (
              <li
                key={person.pid}
                className="bubble flex items-center gap-3 border border-line-strong bg-canvas px-3.5 py-2.5"
              >
                <Avatar
                  look={person.look}
                  face={person.face}
                  name={person.name}
                  photo={snapshot.photos[person.pid]}
                  className="text-[2rem]"
                />
                <span
                  className="min-w-0 flex-1 truncate text-sm font-semibold"
                  translate="no"
                >
                  {person.name}
                </span>
                <span
                  role="group"
                  aria-label={t("visibility.of", { name: person.name })}
                  className="flex shrink-0 gap-1.5"
                >
                  {(["tile", "camera", "screen"] as const).map((part) => (
                    <button
                      key={part}
                      type="button"
                      aria-pressed={sees(person.pid)[part]}
                      className={CHIP}
                      onClick={() =>
                        see(person.pid, { [part]: !sees(person.pid)[part] })
                      }
                    >
                      {t(`visibility.${part}`)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}

      <footer className="grid h-20 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
        <div
          role="toolbar"
          aria-label={t("dock.label")}
          className="col-start-2 flex items-center gap-2.5"
        >
          {withOptions(
            "microphone",
            control("microphone", "mic", "micOff", [
              t("dock.micOn"),
              t("dock.micOff"),
            ]),
            t("dock.micMenu"),
          )}
          {withOptions(
            "camera",
            control("camera", "camera", "cameraOff", [
              t("dock.cameraOn"),
              t("dock.cameraOff"),
            ]),
            t("dock.cameraMenu"),
          )}
          {control("screen", "screen", "screen", [
            t("dock.screenOn"),
            t("dock.screenOff"),
          ])}
          <button
            type="button"
            aria-pressed={local.hand}
            aria-label={t(local.hand ? "dock.handDown" : "dock.handUp")}
            title={t(local.hand ? "dock.handDown" : "dock.handUp")}
            className={`${ROUND} ${local.hand ? "bg-bubble text-on-bubble hover:opacity-85" : IDLE}`}
            onClick={media.toggleHand}
          >
            <Icon name="hand" />
          </button>
          <div className="relative">
            <button
              type="button"
              aria-expanded={menu === "more"}
              aria-label={t("more.label")}
              title={t("more.label")}
              className={`${ROUND} ${menu === "more" ? OPEN : IDLE}`}
              onClick={() => setMenu(menu === "more" ? undefined : "more")}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-5"
                fill="currentColor"
              >
                <circle cx="6" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="18" cy="12" r="1.6" />
              </svg>
            </button>
            {menu === "more" ? (
              <>
                <button
                  type="button"
                  aria-label={t("menu.close")}
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setMenu(undefined)}
                />
                <ul
                  role="menu"
                  aria-label={t("more.label")}
                  className="swap-in bubble absolute bottom-[calc(100%+0.75rem)] left-1/2 z-30 flex w-72 -translate-x-1/2 flex-col border border-line-strong bg-card p-2 text-left"
                >
                  {(
                    [
                      ...(iAmOwner
                        ? [
                            [
                              "more.access",
                              "settings",
                              undefined,
                              () => setSide("settings"),
                            ] as const,
                          ]
                        : []),
                      [
                        "more.palette",
                        "search",
                        "Ctrl+K",
                        () => setPalette(true),
                      ] as const,
                      [
                        "more.look",
                        "look",
                        undefined,
                        () => setSheet("look"),
                      ] as const,
                      [
                        "more.board",
                        "board",
                        undefined,
                        () => setBoardOpen((open) => !open),
                      ] as const,
                      [
                        "more.visibility",
                        "eye",
                        undefined,
                        () => setSheet("visibility"),
                      ] as const,
                      [
                        "more.connection",
                        "people",
                        undefined,
                        () => setStats((shown) => !shown),
                      ] as const,
                      [
                        "more.shortcuts",
                        "chat",
                        "Ctrl+/",
                        () => setSheet("shortcuts"),
                      ] as const,
                    ] as const
                  ).map(([label, icon, keys, run]) => (
                    <li key={label} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className="flex h-11 w-full items-center gap-3 bubble px-3 text-sm transition-colors duration-200 hover:bg-fg/8"
                        onClick={() => {
                          setMenu(undefined);
                          run();
                        }}
                      >
                        <Icon
                          name={
                            icon === "settings"
                              ? "settings"
                              : icon === "people"
                                ? "signal"
                                : icon === "eye"
                                  ? "eye"
                                  : icon === "look"
                                    ? "face"
                                    : icon === "search"
                                      ? "search"
                                      : icon === "board"
                                        ? "board"
                                      : "keyboard"
                          }
                          className="size-4 text-accent"
                        />
                        <span className="flex-1 text-left">{t(label)}</span>
                        {keys ? (
                          <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">
                            {keys}
                          </kbd>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <button
            type="button"
            className="ml-1 inline-flex h-12 items-center gap-2 rounded-full bg-fg px-5 font-semibold text-canvas transition-opacity duration-200 hover:opacity-85"
            onClick={leave}
          >
            <Icon name="leave" />
            {t("room.leave")}
          </button>
        </div>
        <div className="flex items-center justify-end">
          <div
            role="group"
            aria-label={t("dock.panels")}
            className="bubble flex items-center gap-1 border border-line-strong bg-card p-1"
          >
            {iAmOwner
              ? toggle("settings", "settings", t("side.settings"))
              : null}
            {toggle("people", "people", t("side.people"), people.length, true)}
            {toggle("chat", "chat", t("side.chat"), unread)}
          </div>
        </div>
      </footer>
    </div>
  );
}
