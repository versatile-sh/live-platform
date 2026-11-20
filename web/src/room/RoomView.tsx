import {
  Suspense,
  useRef,
  useLayoutEffect,
  lazy,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { shareLink } from "../domain/share-link";
import { createBoardSync } from "../board/board-sync";
import { chime } from "../media/chime";
import { useAutoFloat } from "../media/auto-float";
import { canFloatPage, useFloatingWindow } from "../media/floating-window";
import { createSpeaking } from "../media/speaking";
import { CAMERA_EFFECTS, cameraShape, screenShape } from "../media/settings";
import { Choice } from "../ui/Choice";
import { Switch } from "../ui/Switch";
import { FloatingRoom } from "./FloatingRoom";
import { MediaSettings } from "./MediaSettings";
import { FULL, heard, ScreenVolume, type Loudness } from "./ScreenVolume";
import { ScreenSoundGuide } from "./ScreenSoundGuide";
import { soundRoute } from "../media/desktop-sound";
import { StageFrame, type StageMode } from "./StageFrame";
import { fitStage } from "../domain/stage-fit";
import { useBox } from "../ui/useBox";
import { hasFlag } from "../domain/flags";
import { useChooseLocale, useLocale, useT } from "../i18n/I18nProvider";
import { createRoomMedia, type Source } from "../media/room-media";
import {
  createLocalMedia,
  type LocalMedia,
  type LocalMediaSnapshot,
  type MediaKind,
} from "../media/local-media";
import { useNavigate } from "../routing/Navigation";
import { useServices } from "../services";
import type { Notice } from "../session/connection";
import type { Session, SessionSnapshot } from "../session/session";
import { Avatar } from "../ui/Avatar";
import { withIris, withMotion } from "../ui/motion";
import { CommandPalette } from "../ui/CommandPalette";
import { Icon, type IconName } from "../ui/icons";
import { Sheet } from "../ui/Sheet";
import { Segmented } from "../ui/Segmented";
import { Wordmark } from "../ui/Wordmark";
import { ChatPanel } from "./ChatPanel";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionStatus } from "./ConnectionStatus";
import { DeviceList } from "./DeviceList";
import { EndedPanel } from "./EndedPanel";
import { InviteCard } from "./InviteCard";
import { Others } from "./Others";
import { LookPicker } from "./LookPicker";
import { OwnerPanel } from "./OwnerPanel";
import { MoreMenu, type MoreItem } from "./MoreMenu";
import { PeoplePanel } from "./PeoplePanel";
import { Tile } from "./Tile";
import { CHIP, DOCK, ICON_BUTTON, ICON_BUTTON_SMALL, button } from "../ui/styles";
import { useCopy } from "../ui/useCopy";

const Whiteboard = lazy(() => import("../board/Whiteboard"));
const BoardPreview = lazy(() => import("../board/BoardPreview"));

type RoomViewProps = {
  slug: string;
  session: Session;
  snapshot: SessionSnapshot;
  onEnterAgain: () => void;
};
type Side = "chat" | "people" | "settings";

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

function Options({
  kind,
  media,
  local,
  onClose,
}: {
  kind: "microphone" | "camera" | "screen";
  media: LocalMedia;
  local: LocalMediaSnapshot;
  onClose(): void;
}) {
  const t = useT();
  const { voiceCleaner, cameraEffects, settingsMemory } = useServices();
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
        aria-label={t(kind === "microphone" ? "dock.micMenu" : kind === "camera" ? "dock.cameraMenu" : "dock.screenMenu")}
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
              <Segmented<"off" | "standard" | "strong">
                label={t("menu.voiceFilter")}
                value={local.voiceFilter}
                onChange={(filter) => void media.setVoiceFilter(filter)}
                options={[
                  { value: "off", text: t("menu.filterOff") },
                  { value: "standard", text: t("menu.filterStandard") },
                  ...(voiceCleaner ? [{ value: "strong" as const, text: t("menu.filterStrong") }] : []),
                ]}
              />
            </div>
          </>
        ) : kind === "screen" ? (
          <Switch
            checked={local.settings.pcSound}
            hint={t("pcSound.optionHint")}
            onChange={(pcSound) => {
              settingsMemory.write({ ...local.settings, pcSound });
              void media.setSettings({ pcSound });
            }}
          >
            {t("pcSound.option")}
          </Switch>
        ) : (
          <>
            <DeviceList label={t("menu.camera")} devices={local.cameras} chosen={local.cameraId} onChoose={(id) => void media.choose("camera", id)} />
            {cameraEffects ? (
              <Choice
                label={t("menu.cameraEffect")}
                value={local.settings.cameraEffect}
                onChange={(cameraEffect) => {
                  settingsMemory.write({ ...local.settings, cameraEffect });
                  void media.setSettings({ cameraEffect });
                }}
                options={CAMERA_EFFECTS.map((effect) => ({ value: effect, text: t(`settings.effect.${effect}`) }))}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/** What I chose to see of one person: their tile at all, their camera on it, and their screen. */
type Seeing = { tile: boolean; camera: boolean; screen: boolean };

const SEE_ALL: Seeing = { tile: true, camera: true, screen: true };

const PHONE = "(max-width: 47.99rem)";

function onPhoneChange(change: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

function isPhone() {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;
}

function attach(stream: MediaStream | undefined) {
  return (element: HTMLMediaElement | null) => {
    if (element && element.srcObject !== (stream ?? null))
      element.srcObject = stream ?? null;
  };
}

/** Plays a stream like attach, at the given volume, on the given output when the browser can choose one. */
function play(stream: MediaStream | undefined, speaker: string | undefined, volume = 1) {
  const show = attach(stream);
  return (element: HTMLMediaElement | null) => {
    show(element);
    if (element && element.volume !== volume) element.volume = volume;
    if (element && speaker && typeof element.setSinkId === "function" && element.sinkId !== speaker) element.setSinkId(speaker).catch(() => undefined);
  };
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
  const { mediaDevices, lookMemory, faceMemory, rtc, voiceCleaner, settingsMemory, cameraEffects, theme } = useServices();
  const look = useSyncExternalStore(theme.subscribe, theme.getSnapshot);
  const [media] = useState(() =>
    createLocalMedia(mediaDevices, (flags) => session.setMedia(flags), voiceCleaner, settingsMemory.read(), cameraEffects),
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
  const drawn = useSyncExternalStore(board.subscribe, board.getSnapshot);
  const [boardGone, setBoardGone] = useState(false);
  const [pinned, setPinned] = useState<string | null | undefined>();
  const [floated, setFloated] = useState<string | null>(null);
  const [loudness, setLoudness] = useState<Readonly<Record<number, Loudness>>>({});
  const loudnessOf = (pid: number) => loudness[pid] ?? FULL;
  const floater = useFloatingWindow();
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
  const [speaking] = useState(createSpeaking);
  const talkers = useSyncExternalStore(speaking.subscribe, speaking.getSnapshot);
  useEffect(() => () => speaking.dispose(), [speaking]);
  const myNumber = snapshot.connection.phase === "joined" || snapshot.connection.phase === "reconnecting" ? snapshot.connection.me : undefined;
  useEffect(() => {
    const heard = new Map<number, MediaStream>();
    for (const [pid, sources] of Object.entries(remote)) if (sources.microphone && Number(pid) !== myNumber) heard.set(Number(pid), sources.microphone);
    if (local.microphone && myNumber !== undefined) heard.set(myNumber, local.microphone);
    speaking.watch(heard);
  }, [speaking, remote, local.microphone, myNumber]);
  const { cameraQuality, screenQuality, pushToTalk, talkKey, sounds } = local.settings;
  useEffect(() => {
    roomMedia.limit({ camera: cameraShape(cameraQuality).bitrate, screen: screenShape(screenQuality).bitrate });
  }, [roomMedia, cameraQuality, screenQuality]);
  useEffect(() => {
    if (!pushToTalk) return;
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest("[data-board]") !== null);
    const down = (event: KeyboardEvent) => {
      if (event.code !== talkKey || typing(event.target)) return;
      event.preventDefault();
      media.talk(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === talkKey) media.talk(false);
    };
    const drop = () => media.talk(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", drop);
      media.talk(false);
    };
  }, [media, pushToTalk, talkKey]);
  const headcount = snapshot.connection.phase === "joined" ? snapshot.connection.roster.people.length : undefined;
  const [counted, setCounted] = useState(headcount);
  useEffect(() => {
    if (headcount === counted) return;
    if (sounds && headcount !== undefined && counted !== undefined) chime(headcount > counted ? "arrive" : "leave");
    setCounted(headcount);
  }, [headcount, counted, sounds]);
  const changeSettings = (change: Partial<typeof local.settings>) => {
    settingsMemory.write({ ...local.settings, ...change });
    void media.setSettings(change);
  };
  const phone = useSyncExternalStore(onPhoneChange, isPhone);
  const [side, setSide] = useState<Side | undefined>(phone ? undefined : "chat");
  const [wasPhone, setWasPhone] = useState(phone);
  if (wasPhone !== phone) {
    setWasPhone(phone);
    if (phone) setSide(undefined);
  }
  const [shown, setShown] = useState<Side>("chat");
  const [menu, setMenu] = useState<"microphone" | "camera" | "screen" | undefined>();
  const [sheet, setSheet] = useState<
    "shortcuts" | "look" | "visibility" | "media" | undefined
  >();
  const [seeing, setSeeing] = useState<Readonly<Record<number, Seeing>>>({});
  const [personMenu, setPersonMenu] = useState<
    { pid: number; x: number; y: number } | undefined
  >();
  const [privately, setPrivately] = useState(false);
  const [readUpTo, setReadUpTo] = useState<Readonly<Record<number, number>>>({});
  const [palette, setPalette] = useState(false);
  const choose = useChooseLocale();
  const { origin } = useServices();
  const link = shareLink(origin, slug, snapshot.private ? snapshot.password : undefined);
  const { result: invited, copy } = useCopy();
  const invite = () => void copy(link);
  const [peer, setPeer] = useState<number | undefined>();
  const sees = (pid: number): Seeing => seeing[pid] ?? SEE_ALL;
  const see = (pid: number, change: Partial<Seeing>) =>
    setSeeing({ ...seeing, [pid]: { ...sees(pid), ...change } });
  const [stats, setStats] = useState(false);
  const [seen, setSeen] = useState(0);
  const [closed, setClosed] = useState(0);
  const [othersHidden, setOthersHidden] = useState(false);
  const [stage, measureStage] = useBox();
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
                      : event.altKey && key === "o"
                        ? () => setOthersHidden((hidden) => !hidden)
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
  const newest = chat.at(-1);
  const newestId = newest?.id ?? 0;
  if (side === "chat" && seen !== newestId) setSeen(newestId);
  if (side === "settings" && !iAmOwner) setSide("people");
  if (shown === "settings" && !iAmOwner) setShown("people");
  const unread = side === "chat" ? 0 : chat.filter((line) => line.id > seen).length;
  const fresh = side === "chat" ? [] : chat.filter((line) => line.to === undefined && line.pid !== myPid && line.id > Math.max(seen, closed)).slice(-3);
  const [kept, setKept] = useState(fresh);
  if (fresh.length > 0 && kept.at(-1)?.id !== fresh.at(-1)?.id) setKept(fresh);
  useEffect(() => {
    if (kept.length < 3) return;
    const timer = setTimeout(() => setKept(kept.slice(-2)), 300);
    return () => clearTimeout(timer);
  }, [kept]);
  const toast = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const balloon = toast.current;
    if (!balloon) return;
    const pinned = balloon.style.width !== "";
    const from = balloon.getBoundingClientRect().width;
    balloon.style.width = "";
    const to = balloon.getBoundingClientRect().width;
    balloon.style.width = `${pinned ? from : to}px`;
    if (!pinned || from === to) return;
    void balloon.offsetWidth;
    balloon.style.width = `${to}px`;
  }, [kept]);
  const leaving = fresh.length === 0 && kept.length > 0;
  const [holding, setHolding] = useState(false);
  const showing = fresh.length > 0;
  useEffect(() => {
    if (!showing || holding) return;
    const timer = setTimeout(() => setClosed(newestId), 10_000);
    return () => clearTimeout(timer);
  }, [showing, holding, newestId]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setKept([]), 200);
    return () => clearTimeout(timer);
  }, [leaving]);
  const [rung, setRung] = useState(newestId);
  useEffect(() => {
    if (newestId === rung) return;
    if (sounds && newest !== undefined && newest.pid !== myPid && !document.hasFocus()) chime("message");
    setRung(newestId);
  }, [newestId, rung, newest, myPid, sounds]);
  const reading = side === "chat" && privately ? peer : undefined;
  const lastFrom: Record<number, number> = {};
  const unreadFrom: Record<number, number> = {};
  for (const line of chat) {
    if (line.to === undefined || line.pid === myPid) continue;
    lastFrom[line.pid] = line.id;
    if (line.id > (readUpTo[line.pid] ?? 0) && line.pid !== reading) unreadFrom[line.pid] = (unreadFrom[line.pid] ?? 0) + 1;
  }
  if (reading !== undefined && (lastFrom[reading] ?? 0) > (readUpTo[reading] ?? 0)) setReadUpTo({ ...readUpTo, [reading]: lastFrom[reading]! });
  const alone = me !== undefined && people.length === 1;
  const whispers = people.filter((person) => (unreadFrom[person.pid] ?? 0) > 0);
  const shownPeople = people.filter((person) => sees(person.pid).tile);
  const screens = people.filter(
    (person) =>
      person.pid !== myPid &&
      hasFlag(person.flags, "screen") &&
      remote[person.pid]?.screen &&
      sees(person.pid).screen,
  );
  const roomQuiet = inRoom && connection.roster.quiet === true;
  const boardLocked = inRoom && connection.roster.locked === true;
  const iMayDraw = me === undefined || !hasFlag(me.flags, "noDraw");
  const iAmMuted = me !== undefined && hasFlag(me.flags, "muted");
  const [wasMuted, setWasMuted] = useState(iAmMuted);
  const [prompt, setPrompt] = useState<"may-speak" | "camera-hidden" | undefined>();
  const [soundless, setSoundless] = useState<MediaStream | undefined>();
  if (wasMuted !== iAmMuted) {
    setWasMuted(iAmMuted);
    setPrompt(iAmMuted ? undefined : "may-speak");
  }
  useEffect(() => media.silence(iAmMuted), [media, iAmMuted]);
  const cameraOn = local.camera !== undefined;
  const [hadCamera, setHadCamera] = useState(cameraOn);
  const mineHidden = myPid !== undefined && (!sees(myPid).tile || !sees(myPid).camera);
  if (hadCamera !== cameraOn) {
    setHadCamera(cameraOn);
    if (cameraOn && mineHidden) setPrompt("camera-hidden");
    else if (prompt === "camera-hidden") setPrompt(undefined);
  }
  const asking = iAmOwner ? people.filter((person) => hasFlag(person.flags, "muted") && hasFlag(person.flags, "hand")).length : 0;
  const [asked, setAsked] = useState(asking);
  useEffect(() => {
    if (asking > asked && sounds) chime("ask");
    if (asking !== asked) setAsked(asking);
  }, [asking, asked, sounds]);
  const presenter = people.find((person) => hasFlag(person.flags, "board"));
  if (!presenter && boardGone) setBoardGone(false);
  const boardShown = local.board || (presenter !== undefined && !boardGone);
  const toggleBoard = () =>
    withMotion("words", () => {
      if (boardShown) {
        media.setBoard(false);
        setBoardGone(presenter !== undefined && presenter.pid !== myPid);
      } else {
        setBoardGone(false);
        media.setBoard(true);
      }
    });
  const SHOW = "absolute inset-0 -z-10 size-full object-contain";
  const TAG = "absolute bottom-2.5 left-2.5 bubble-word bg-canvas/70 px-2.5 py-1 text-sm font-semibold";
  const frames: { key: string; render(mode: StageMode): ReactNode }[] = [
    ...(boardShown
      ? [
          {
            key: "board",
            render: (mode: StageMode) => (
              <StageFrame key="board" mode={mode} name={t("board.label")} onFront={() => bring("board")} clickable={mode !== "front"} data-board aria-label={t("board.label")} className="swap-in bubble flex-col border border-bubble bg-card">
                {mode === "front" ? (
                  <>
                    <div className="flex h-11 w-full shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-24">
                      <h2 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
                        <span className="truncate">{presenter && presenter.pid !== myPid ? t("board.of", { name: presenter.name }) : t("board.label")}</span>
                        {iMayDraw ? null : <span className="bubble-word shrink-0 border border-line-strong px-2 py-0.5 font-mono text-xs font-normal text-muted">{t("board.viewOnly")}</span>}
                      </h2>
                      {iAmOwner ? (
                        <button type="button" aria-pressed={boardLocked} className={`${CHIP} ml-auto`} onClick={() => void session.owner({ op: boardLocked ? "unlock-board" : "lock-board" })}>
                          {t("board.lock")}
                        </button>
                      ) : null}
                      <button type="button" aria-label={t("board.close")} title={t("board.close")} className={ICON_BUTTON} onClick={toggleBoard}>
                        <Icon name="close" className="size-4" />
                      </button>
                    </div>
                    <div className="min-h-0 w-full flex-1">
                      <Suspense fallback={<p role="status" className="grid h-full place-items-center text-muted">{t("board.loading")}</p>}>
                        <Whiteboard key={`${iMayDraw ? "draw" : "view"}-${look}`} light={look === "light"} sync={board} langCode={locale === "pt-BR" ? "pt-BR" : "en"} readOnly={!iMayDraw} />
                      </Suspense>
                    </div>
                  </>
                ) : (
                  <>
                    <Icon name="board" className="size-10 text-accent" />
                    <Suspense fallback={null}>
                      <BoardPreview elements={drawn} />
                    </Suspense>
                    <span className={TAG}>{t("board.label")}</span>
                  </>
                )}
              </StageFrame>
            ),
          },
        ]
      : []),
    ...(local.screen
      ? [
          {
            key: "screen-me",
            render: (mode: StageMode) => (
              <StageFrame key="screen-me" mode={mode} name={t("room.yourScreen")} onFront={() => bring("screen-me")} onFloat={(video) => float("screen-me", video)} className="bubble-sent border border-bubble bg-sunken">
                <video ref={attach(local.screen)} autoPlay muted playsInline className={SHOW} />
                <span className={TAG}>{t("room.yourScreen")}</span>
              </StageFrame>
            ),
          },
        ]
      : []),
    ...screens.map((person) => ({
      key: `screen-${person.pid}`,
      render: (mode: StageMode) => (
        <StageFrame key={`screen-${person.pid}`} mode={mode} name={t("room.screenOf", { name: person.name })} onFront={() => bring(`screen-${person.pid}`)} onFloat={(video) => float(`screen-${person.pid}`, video)} className="bubble border border-bubble bg-sunken">
          <video ref={attach(remote[person.pid]?.screen)} autoPlay muted playsInline className={SHOW} />
          {remote[person.pid]?.screenAudio ? <ScreenVolume name={t("room.screenOf", { name: person.name })} loudness={loudnessOf(person.pid)} onChange={(next) => setLoudness({ ...loudness, [person.pid]: next })} /> : null}
          <span className={TAG} translate="no">
            {t("room.screenOf", { name: person.name })}
          </span>
        </StageFrame>
      ),
    })),
    ...shownPeople.map((person) => ({
      key: `person-${person.pid}`,
      render: (mode: StageMode) => (
        <Tile
          key={person.pid}
          person={person}
          isMe={person.pid === myPid}
          video={!sees(person.pid).camera ? undefined : person.pid === myPid ? local.camera : hasFlag(person.flags, "camera") ? remote[person.pid]?.camera : undefined}
          photo={snapshot.photos[person.pid]}
          mode={mode}
          speaking={talkers.has(person.pid)}
          onFront={() => bring(`person-${person.pid}`)}
          onMenu={(at) => setPersonMenu({ pid: person.pid, ...at })}
        />
      ),
    })),
  ];
  const fit = stage && fitStage(stage, frames.length + (alone ? 1 : 0));
  const chosen = frames.find((frame) => frame.key === pinned);
  const front = pinned === null ? undefined : (chosen ?? frames.find((frame) => frame.key === "board" || frame.key.startsWith("screen-")));
  const bring = (key: string) => withMotion("words", () => setPinned(front?.key === key ? null : key));

  const screenOf = (key: string | undefined) => {
    if (key === "screen-me") return local.screen ? { stream: local.screen, name: t("room.yourScreen") } : undefined;
    const person = screens.find((p) => `screen-${p.pid}` === key);
    const stream = person && remote[person.pid]?.screen;
    return person && stream ? { stream, name: t("room.screenOf", { name: person.name }) } : undefined;
  };
  const bestScreen = front?.key.startsWith("screen-") ? front.key : (screens[0] ? `screen-${screens[0].pid}` : local.screen ? "screen-me" : undefined);
  function float(key: string | undefined, video: HTMLVideoElement | null) {
    if (canFloatPage()) {
      if (floater.floating) return floater.close();
      setFloated(key ?? null);
      return void floater.open();
    }
    if (!video) return;
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => undefined);
    else void video.requestPictureInPicture().catch(() => undefined);
  }
  useAutoFloat(bestScreen !== undefined, () => float(bestScreen, null));

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
    className: string,
  ) {
    const active = local[kind] !== undefined;
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={active ? labels[1] : labels[0]}
        title={active ? labels[1] : labels[0]}
        disabled={local.busy !== undefined}
        className={className}
        onClick={() => void media.toggle(kind)}
      >
        <Icon name={active ? on : off} />
      </button>
    );
  }

  function withOptions(
    kind: "microphone" | "camera" | "screen",
    button: ReactNode,
    label: string,
  ) {
    return (
      <div className="relative">
        <div className={`${DOCK.split} ${local[kind] ? DOCK.on : DOCK.off}`}>
          {button}
          <button
            type="button"
            aria-expanded={menu === kind}
            aria-label={label}
            title={label}
            className={DOCK.caret}
            onClick={() => {
              void media.refreshDevices();
              setMenu(menu === kind ? undefined : kind);
            }}
          >
            <Caret />
          </button>
        </div>
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
        className={`${DOCK.top} ${side === panel ? DOCK.open : DOCK.quiet}`}
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

  const openSettings = () => {
    void media.refreshDevices();
    setSheet("media");
  };
  const moreGroups: readonly (readonly MoreItem[])[] = [
    [
      { id: "board", label: t("more.board"), icon: "board", checked: boardShown, run: toggleBoard },
      ...(iAmOwner ? [{ id: "settings", label: t("side.settings"), icon: "settings" as const, run: () => setSide("settings") }] : []),
    ],
    [
      { id: "media", label: t("more.media"), icon: "settings", run: openSettings },
      { id: "look", label: t("more.look"), icon: "face", run: () => setSheet("look") },
      { id: "visibility", label: t("more.visibility"), icon: "eye", run: () => setSheet("visibility") },
      { id: "connection", label: t("more.connection"), icon: "signal", run: () => setStats((open) => !open) },
      { id: "shortcuts", label: t("more.shortcuts"), icon: "keyboard", run: () => setSheet("shortcuts") },
      { id: "palette", label: t("more.palette"), icon: "search", keys: "Ctrl+K", run: () => setPalette(true) },
    ],
  ];

  const panel = shown === "chat" ? (
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
      unread={unreadFrom}
      onSay={session.say}
    />
  ) : shown === "people" ? (
    <PeoplePanel
      people={people}
      me={myPid}
      canModerate={iAmOwner}
      quiet={roomQuiet}
      locked={boardLocked}
      onDraw={(pid, op) => session.owner({ op, pid })}
      onRemove={(pid) => session.owner({ op: "remove", pid })}
      onBan={(pid) => session.owner({ op: "ban", pid })}
      onQuiet={(op) => session.owner({ op })}
      onVoice={(pid, op) => session.owner({ op, pid })}
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
  );

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
      <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-4 sm:px-5">
        <Wordmark className="text-sm max-sm:hidden" />
        <div className="flex min-w-0 items-center gap-2 sm:max-w-[60vw] sm:gap-3">
          <h1
            className="min-w-0 truncate font-display text-lg font-bold tracking-[-0.03em]"
            translate="no"
          >
            {slug}
          </h1>
          <ConnectionStatus connection={connection} />
        </div>
        <div className="flex items-center gap-1 justify-self-end">
          <span className="relative">
            <button type="button" className={`${DOCK.topLabeled} ${DOCK.quiet}`} onClick={invite}>
              <Icon name="invite" />
              <span className="max-sm:sr-only">{t("invite.button")}</span>
            </button>
            <p role="status" className={`pointer-events-none absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-1.5rem)] text-sm break-all ${invited === "idle" ? "" : "arrive bubble border border-bubble bg-card px-4 py-2"}`}>
              {invited === "copied" ? t("invite.copied") : invited === "failed" ? t("invite.failed", { link }) : ""}
            </p>
          </span>
          <div role="group" aria-label={t("dock.panels")} className="flex items-center gap-1">
            {toggle("people", "people", t("side.people"), people.length, true)}
            {toggle("chat", "chat", t("side.chat"), unread)}
          </div>
          <MoreMenu groups={moreGroups} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-3">
        <section
          aria-label={t("room.peopleHeading", { slug })}
          className="relative flex min-w-0 flex-1 items-center justify-center"
        >
          {people.length === 0 ? (
            <p className="text-muted">{t("room.gettingReady")}</p>
          ) : frames.length === 0 ? (
            <p className="text-muted">{t("visibility.none")}</p>
          ) : front ? (
            <div className="swap-in flex size-full min-h-0 gap-3 overflow-hidden max-lg:flex-col">
              <ul className="flex min-h-0 min-w-0 flex-1">{front.render("front")}</ul>
              {frames.length > 1 ? (
                <Others
                  hidden={othersHidden}
                  count={frames.length - 1}
                  onToggle={() => setOthersHidden(!othersHidden)}
                >
                  {frames.filter((frame) => frame !== front).map((frame) => frame.render("strip"))}
                </Others>
              ) : null}
            </div>
          ) : (
            <div ref={measureStage} className="no-scrollbar absolute inset-0 overflow-x-hidden overflow-y-auto">
              <ul
                className={`m-auto grid gap-3 ${fit ? "w-fit" : "w-full grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]"}`}
                style={fit ? { gridTemplateColumns: `repeat(${fit.columns}, ${fit.tile.width}px)`, gridAutoRows: `${fit.tile.height}px` } : undefined}
              >
                {frames.map((frame) => frame.render("grid"))}
                {alone ? <InviteCard link={link} copied={invited} onCopy={invite} /> : null}
              </ul>
            </div>
          )}
          {Object.entries(remote).flatMap(([pid, sources]) =>
            Number(pid) === myPid
              ? []
              : (["microphone", "screenAudio"] as const).flatMap((source) =>
                  sources[source]
                    ? [
                        <audio
                          key={`${pid}-${source}`}
                          ref={play(sources[source], local.speaker, source === "screenAudio" ? heard(loudnessOf(Number(pid))) : 1)}
                          autoPlay
                        />,
                      ]
                    : [],
                ),
          )}
          {kept.length > 0 ? (
            <div role="status" className="pointer-events-none absolute right-2 bottom-2 z-10 flex max-w-[min(24rem,calc(100%-1rem))]">
              <div ref={toast} data-leaving={leaving || undefined} onPointerEnter={() => setHolding(true)} onPointerLeave={() => setHolding(false)} onFocus={() => setHolding(true)} onBlur={() => setHolding(false)} className="chat-toast bubble pointer-events-auto flex min-w-0 items-start gap-1 border border-line-strong bg-card p-2">
                <button type="button" title={t("chat.open")} className={`chat-toast-lines flex min-w-0 flex-1 cursor-pointer flex-col justify-end overflow-hidden text-left ${kept.length > 1 ? "h-[3.875rem]" : "h-7"}`} onClick={() => (setPrivately(false), setSide("chat"))}>
                  <span key={kept.at(-1)?.id} className={`flex w-full min-w-0 shrink-0 flex-col gap-1.5 ${kept.length > 1 ? "chat-roll" : ""}`}>
                    {kept.map((line, index) => (
                      <span key={line.id} aria-hidden={index < kept.length - 2 || undefined} className="flex h-7 min-w-0 shrink-0 items-center gap-1.5 text-sm">
                        <span className="max-w-28 shrink-0 truncate bubble-word bg-canvas px-3 py-1 font-semibold" translate="no">{line.name}</span>
                        <span className="min-w-0 truncate bubble-word bg-bubble px-3 py-1 text-on-bubble">{line.text || t("chat.picture", { name: line.name })}</span>
                      </span>
                    ))}
                  </span>
                </button>
                <button type="button" aria-label={t("chat.hide")} title={t("chat.hide")} className={ICON_BUTTON_SMALL} onClick={() => setClosed(newestId)}>
                  <Icon name="close" className="size-4" />
                </button>
              </div>
            </div>
          ) : null}
          <ul
            role="status"
            className="pointer-events-none absolute top-2 left-2 flex max-w-sm flex-col items-start gap-2"
          >
            {inRoom
              ? connection.notices.map((notice) => (
                  <NoticeLine key={notice.id} notice={notice} />
                ))
              : null}
            {whispers.map((person) => (
              <li key={`whisper-${person.pid}`} className="swap-in bubble pointer-events-auto flex items-center gap-3 border border-bubble bg-card py-2 pr-2 pl-4 text-sm">
                <span className="min-w-0">
                  <span className="mr-2 bubble-word bg-bubble px-2 py-0.5 font-mono text-xs text-on-bubble">{t("chat.private")}</span>
                  {t("chat.privateFrom", { name: person.name, count: unreadFrom[person.pid] ?? 0 })}
                </span>
                <button
                  type="button"
                  className={button({ variant: "accent", size: "xs" })}
                  onClick={() => {
                    setPeer(person.pid);
                    setPrivately(true);
                    setSide("chat");
                  }}
                >
                  {t("chat.open")}
                </button>
              </li>
            ))}
            {iAmMuted ? (
              <li className="swap-in bubble pointer-events-auto flex flex-wrap items-center gap-2.5 border border-line-strong bg-card px-4 py-2.5 text-sm">
                <Icon name="micOff" className="size-4 shrink-0 text-accent" />
                <span>{t(roomQuiet ? "quiet.youRoom" : "quiet.youOne")}</span>
                <button type="button" className={button({ variant: "accent", size: "xs" })} onClick={media.toggleHand}>
                  {t(local.hand ? "dock.handDown" : "dock.handUp")}
                </button>
              </li>
            ) : null}
            {prompt ? (
              <li className="swap-in bubble pointer-events-auto flex flex-col gap-2.5 border border-bubble bg-card px-4 py-3 text-sm">
                <span>{t(prompt === "may-speak" ? "quiet.maySpeak" : "prompt.cameraHidden")}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className={button({ variant: "accent", size: "xs" })}
                    onClick={() => {
                      if (prompt === "may-speak") void media.toggle("microphone");
                      else if (myPid !== undefined) see(myPid, { tile: true, camera: true });
                      setPrompt(undefined);
                    }}
                  >
                    {t(prompt === "may-speak" ? "dock.micOn" : "prompt.cameraShow")}
                  </button>
                  <button type="button" className={button({ variant: "secondary", size: "xs" })} onClick={() => setPrompt(undefined)}>
                    {t(prompt === "may-speak" ? "prompt.notNow" : "prompt.cameraKeep")}
                  </button>
                </span>
              </li>
            ) : null}
            {local.screen && local.settings.pcSound && local.screen.getAudioTracks().length === 0 && soundless !== local.screen ? (
              <ScreenSoundGuide
                route={soundRoute()}
                origin={window.location.origin}
                onRetry={media.addScreenSound}
                onShareAgain={() => {
                  void media.toggle("screen");
                  void media.toggle("screen");
                }}
                onClose={() => setSoundless(local.screen)}
              />
            ) : null}
            {local.problem ? (
              <li className="arrive bubble border border-fg/40 bg-card px-3.5 py-2 text-sm">
                {t(`media.${local.problem.why}.${local.problem.kind}`)}
              </li>
            ) : null}
          </ul>
        </section>

        {phone ? null : (
          <aside
            aria-label={t(`side.${shown}`)}
            inert={!side}
            className={`relative z-10 flex shrink-0 justify-end overflow-hidden transition-[width,opacity,margin] duration-500 ease-(--ease-glide) ${side ? "w-[22.5rem] opacity-100" : "-ml-3 w-0 opacity-0"}`}
          >
            <div className="flex w-[22.5rem] shrink-0 flex-col overflow-hidden bubble-sent border border-line bg-card">
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
                    className={ICON_BUTTON}
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
                {panel}
              </div>
            </div>
          </aside>
        )}
      </div>

      {phone && side ? (
        <Sheet title={t(`side.${side}`)} closeLabel={t("more.close")} onClose={() => setSide(undefined)} bare>
          {panel}
        </Sheet>
      ) : null}

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
            ...(front && frames.length > 1
              ? [
                  {
                    id: "others",
                    group: t("palette.group.panels"),
                    label: t(othersHidden ? "stage.showOthers" : "stage.hideOthers", { count: frames.length - 1 }),
                    keys: "Ctrl+Alt+O",
                    run: () => setOthersHidden(!othersHidden),
                  },
                ]
              : []),
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
            { id: "board", group: t("palette.group.room"), label: t("more.board"), run: toggleBoard },
            ...(iAmOwner ? [{ id: "quiet", group: t("palette.group.people"), label: t(roomQuiet ? "quiet.unmuteAll" : "quiet.muteAll"), run: () => void session.owner({ op: roomQuiet ? "unmute-all" : "mute-all" }) }] : []),
            { id: "theme", group: t("palette.group.site"), label: t(look === "dark" ? "theme.toLight" : "theme.toDark"), run: () => withIris({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, theme.toggle) },
            { id: "media", group: t("palette.group.room"), label: t("more.media"), run: openSettings },
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
              run: invite,
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
                      [t("owner.banShort"), () => void session.owner({ op: "ban", pid: personMenu.pid })] as const,
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
        <ConnectionCard snapshot={snapshot} slug={slug} report={roomMedia.report} onClose={() => setStats(false)} />
      ) : null}

      {sheet === "media" ? (
        <Sheet title={t("more.media")} closeLabel={t("more.close")} onClose={() => setSheet(undefined)} wide>
          <MediaSettings
            settings={local.settings}
            filter={local.voiceFilter}
            strongAvailable={voiceCleaner !== undefined}
            effectsAvailable={cameraEffects !== undefined}
            devices={local}
            onDevice={(kind, id) => void media.choose(kind, id)}
            onFilter={(filter) => void media.setVoiceFilter(filter)}
            onChange={changeSettings}
          />
        </Sheet>
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
              [t("shortcut.others"), "Ctrl+Alt+O"],
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

      <footer className="relative flex h-20 shrink-0 items-center justify-center px-3 sm:px-5">
        <div role="toolbar" aria-label={t("dock.label")} className="flex items-center gap-2 sm:gap-2.5">
          {withOptions("microphone", control("microphone", "mic", "micOff", [t("dock.micOn"), t("dock.micOff")], DOCK.main), t("dock.micMenu"))}
          {withOptions("camera", control("camera", "camera", "cameraOff", [t("dock.cameraOn"), t("dock.cameraOff")], DOCK.main), t("dock.cameraMenu"))}
          {withOptions("screen", control("screen", "screen", "screen", [t("dock.screenOn"), t("dock.screenOff")], DOCK.main), t("dock.screenMenu"))}
          <button
            type="button"
            aria-pressed={local.hand}
            aria-label={t(local.hand ? "dock.handDown" : "dock.handUp")}
            title={t(local.hand ? "dock.handDown" : "dock.handUp")}
            className={`${DOCK.round} ${local.hand ? DOCK.on : DOCK.off}`}
            onClick={media.toggleHand}
          >
            <Icon name="hand" />
          </button>
          <button type="button" className={`${button({ size: "lg" })} max-sm:px-3.5`} onClick={leave}>
            <Icon name="leave" />
            <span className="max-sm:sr-only">{t("room.leave")}</span>
          </button>
        </div>
      </footer>
      {floater.floating
        ? createPortal(
            <FloatingRoom
              screen={screenOf(floated ?? bestScreen) ?? screenOf(bestScreen)}
              microphone={{ on: local.microphone !== undefined, busy: local.busy !== undefined, toggle: () => void media.toggle("microphone") }}
              camera={{ on: local.camera !== undefined, busy: local.busy !== undefined, toggle: () => void media.toggle("camera") }}
              onBack={floater.close}
              onLeave={leave}
            />,
            floater.floating.document.body,
          )
        : null}
    </div>
  );
}
