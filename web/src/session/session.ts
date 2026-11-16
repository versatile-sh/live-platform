import { openLink, type Link, type LinkEvent, type SocketFactory } from "../signal/link";
import type { Hello, OwnerOp, ServerFrame, RtcSignal } from "../signal/protocol";
import { IDLE, reduceConnection, type Connection, type ConnectionEvent, type DropCause, type EndReason } from "./connection";
import { clearSeat, readSeat, writeSeat, type SeatStorage } from "./seat";

/** Seconds between heartbeats, and how long silence from the server is tolerated, in milliseconds. */
export const HEARTBEAT_MS = 4000;
export const DEAD_AFTER_MS = 8000;
export const RETRY_WINDOW_MS = 10_000;
export const ATTEMPT_TIMEOUT_MS = 3000;
export const NOTICE_MS = 6000;
const BACKOFF_MS = [300, 600, 1000, 1500, 2000];

/** What a person gave to enter a room. A verifier makes the room private. */
export type JoinEntry = { name: string; verifier?: string; listed?: boolean; password?: string; look?: string; face?: string };

/** One line said in the room, as this page heard it. */
export type ChatLine = { id: number; pid: number; to?: number; name: string; text: string; at: number };

const CHAT_KEPT = 300;

export type SessionSnapshot = {
  connection: Connection;
  chat: readonly ChatLine[];
  /** The photo each participant is showing, as a JPEG data address, by participant id. */
  photos: Readonly<Record<number, string>>;
  /** How long my last heartbeat took to come back, in milliseconds. */
  rtt: number | undefined;
  slug: string;
  private: boolean;
  listed: boolean | undefined;
  password: string | undefined;
};

export type SessionOptions = {
  slug: string;
  url: string;
  socket: SocketFactory;
  storage: SeatStorage;
  entry?: JoinEntry;
};

export type Session = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionSnapshot;
  /** Opens the connection: a join with the entry, or a resume of the stored seat when there is no entry. */
  start(): void;
  /** Whether `rejoin` can enter again without asking the person anything. */
  canRejoin(): boolean;
  rejoin(): void;
  /** Leaves the room for good: tells the server, forgets the seat and ends the session. */
  leave(): void;
  /** Stops the session; a participant who is in the room leaves it. */
  dispose(): void;
  owner(op: OwnerOp, effect?: { listed?: boolean; password?: string | undefined; private?: boolean }): boolean;
  /** Sends a media signal to the server; false when it could not be sent. */
  sendRtc(signal: RtcSignal): boolean;
  /** Sends a piece of the whiteboard to the others in the room, or to one of them. */
  sendBoard(data: object, to?: number): boolean;
  /** Hears pieces of the whiteboard from the others. */
  onBoard(listener: (from: number, data: unknown) => void): () => void;
  /** Hears the server's media signals, and each time my place in the room is (re)established, when media must start over. */
  onRtc(listener: (event: { kind: "signal"; signal: RtcSignal } | { kind: "seated" }) => void): () => void;
  /** Changes how I appear to the room: colour and tilt, and the characters of my face. */
  setLook(look: string, face: string): void;
  /** Shows a photo of mine to the room while I am in it (JPEG as base64), or takes it away when empty. */
  setPhoto(data: string): void;
  /** Says a line to the room, or privately to one participant; false when it could not be sent. */
  say(text: string, to?: number): boolean;
  /** Tells the room what I am sending (microphone, camera, screen, hand); it is told again after a reconnection. */
  setMedia(flags: number): void;
};

type Handle = ReturnType<typeof setTimeout>;

function causeOf(meaning: Extract<LinkEvent, { kind: "closed" }>["meaning"]): DropCause {
  switch (meaning.kind) {
    case "silent":
      return "silent";
    case "slow":
      return "slow";
    case "no-hello":
      return "no-hello";
    default:
      return "network";
  }
}

/**
 * My presence in one room as an observable store: it owns the socket, the heartbeat, the dead-socket watchdog,
 * the resume retries and the stored seat, and exposes the connection state machine's current state.
 */
export function createSession({ slug, url, socket, storage, entry }: SessionOptions): Session {
  let snapshot: SessionSnapshot = {
    connection: IDLE,
    chat: [],
    photos: {},
    rtt: undefined,
    slug,
    private: entry?.verifier !== undefined,
    listed: entry?.listed,
    password: entry?.password,
  };
  const listeners = new Set<() => void>();
  let link: Link | undefined;
  let generation = 0;
  let leaving = false;
  let resuming = false;
  const boardListeners = new Set<(from: number, data: unknown) => void>();
  const rtcListeners = new Set<(event: { kind: "signal"; signal: RtcSignal } | { kind: "seated" }) => void>();
  let mediaFlags = 0;
  let beatAt = 0;
  let nextChatId = 1;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let watchdog: Handle | undefined;
  let deadline: Handle | undefined;
  let retry: Handle | undefined;
  const noticeTimers = new Map<number, Handle>();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function patch(next: Partial<SessionSnapshot>) {
    snapshot = { ...snapshot, ...next };
    emit();
  }

  function stopTimers() {
    clearInterval(heartbeat);
    clearTimeout(watchdog);
    clearTimeout(deadline);
    clearTimeout(retry);
    heartbeat = watchdog = deadline = retry = undefined;
  }

  function closeLink() {
    generation++;
    link?.close();
    link = undefined;
  }

  function scheduleNoticeExpiry(connection: Connection) {
    if (connection.phase !== "joined" && connection.phase !== "reconnecting") return;
    for (const notice of connection.notices) {
      if (noticeTimers.has(notice.id)) continue;
      noticeTimers.set(
        notice.id,
        setTimeout(() => {
          noticeTimers.delete(notice.id);
          dispatch({ type: "notice-expired", id: notice.id });
        }, NOTICE_MS),
      );
    }
  }

  function dispatch(event: ConnectionEvent) {
    const next = reduceConnection(snapshot.connection, event);
    if (next === snapshot.connection) return;
    patch({ connection: next });
    scheduleNoticeExpiry(next);
    if (next.phase === "ended") {
      stopTimers();
      closeLink();
      noticeTimers.forEach(clearTimeout);
      noticeTimers.clear();
      clearSeat(storage, slug);
    }
  }

  function armWatchdog(ms: number) {
    clearTimeout(watchdog);
    watchdog = setTimeout(onSilence, ms);
  }

  function onSilence() {
    const phase = snapshot.connection.phase;
    closeLink();
    if (phase === "joined") recover("dead");
    else if (phase === "reconnecting") attemptFailed();
    else dispatch({ type: "dropped", cause: "network", at: Date.now() });
  }

  function open(hello: Hello, timeoutMs: number) {
    closeLink();
    resuming = hello.t === "resume";
    const mine = generation;
    link = openLink({
      url,
      hello,
      socket,
      onEvent: (event) => {
        if (mine === generation) onLinkEvent(event);
      },
    });
    armWatchdog(timeoutMs);
  }

  function onJoined(frame: Extract<ServerFrame, { t: "joined" }>) {
    clearTimeout(deadline);
    clearTimeout(retry);
    deadline = retry = undefined;
    writeSeat(storage, slug, { pid: frame.pid, secret: frame.secret, private: snapshot.private, ...(snapshot.listed === undefined ? {} : { listed: snapshot.listed }) });
    dispatch({ type: "joined", pid: frame.pid });
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      beatAt = Date.now();
      link?.send({ t: "hb" });
    }, HEARTBEAT_MS);
    if (mediaFlags !== 0) link?.send({ t: "media", flags: mediaFlags });
    rtcListeners.forEach((listener) => listener({ kind: "seated" }));
  }

  function onLinkEvent(event: LinkEvent) {
    if (event.kind === "frame") {
      const { frame } = event;
      if (snapshot.connection.phase === "joined" || frame.t === "joined") armWatchdog(DEAD_AFTER_MS);
      if (frame.t === "joined") onJoined(frame);
      else if (frame.t === "roster") dispatch({ type: "roster", frame });
      else if (frame.t === "chat") patch({ chat: [...snapshot.chat, { id: nextChatId++, pid: frame.pid, name: frame.name, text: frame.text, at: frame.at, ...(frame.to ? { to: frame.to } : {}) }].slice(-CHAT_KEPT) });
      else if (frame.t === "board") boardListeners.forEach((listener) => listener(frame.pid, frame.data));
      else if (frame.t === "rtc") {
        const { t: _t, ...signal } = frame;
        rtcListeners.forEach((listener) => listener({ kind: "signal", signal }));
      } else if (frame.t === "photo") {
        const { [frame.pid]: _gone, ...others } = snapshot.photos;
        patch({ photos: frame.data === "" ? others : { ...others, [frame.pid]: `data:image/jpeg;base64,${frame.data}` } });
      } else if (frame.t === "hb" && beatAt > 0) {
        patch({ rtt: Date.now() - beatAt });
        beatAt = 0;
      }
      else if (frame.t === "error" && snapshot.connection.phase === "joined") dispatch({ type: "owner-refused", code: frame.code });
      return;
    }
    if (leaving) return;
    const phase = snapshot.connection.phase;
    const { meaning, error } = event;
    link = undefined;
    switch (meaning.kind) {
      case "refused":
        if (error?.code === "NOT_FOUND" && resuming) end({ kind: "expired" });
        else end(error ? { kind: "refused", code: error.code } : { kind: "bad-frame" });
        return;
      case "superseded":
        end({ kind: "superseded" });
        return;
      case "removed":
        end({ kind: "removed" });
        return;
      case "flood":
        end({ kind: "flood" });
        return;
      case "left":
        if (phase === "reconnecting") attemptFailed();
        else end({ kind: "server-closed" });
        return;
      default:
        if (phase === "joined") recover(causeOf(meaning));
        else if (phase === "reconnecting") attemptFailed();
        else dispatch({ type: "dropped", cause: causeOf(meaning), at: Date.now() });
    }
  }

  function end(reason: EndReason) {
    dispatch({ type: "end", reason });
  }

  function recover(cause: DropCause) {
    clearInterval(heartbeat);
    clearTimeout(watchdog);
    dispatch({ type: "dropped", cause, at: Date.now() });
    if (snapshot.connection.phase !== "reconnecting") return;
    deadline = setTimeout(() => {
      clearTimeout(retry);
      dispatch({ type: "gave-up" });
    }, RETRY_WINDOW_MS);
    attempt();
  }

  function attempt() {
    if (snapshot.connection.phase !== "reconnecting") return;
    const seat = readSeat(storage, slug);
    if (!seat) {
      end({ kind: "expired" });
      return;
    }
    dispatch({ type: "attempt" });
    open({ t: "resume", slug, pid: seat.pid, secret: seat.secret }, ATTEMPT_TIMEOUT_MS);
  }

  function attemptFailed() {
    const state = snapshot.connection;
    if (state.phase !== "reconnecting") return;
    clearTimeout(watchdog);
    const delay = BACKOFF_MS[Math.min(Math.max(state.attempts - 1, 0), BACKOFF_MS.length - 1)] ?? 2000;
    retry = setTimeout(attempt, delay);
  }

  function begin(hello: Hello) {
    leaving = false;
    dispatch({ type: "start", resuming: hello.t === "resume" });
    if (snapshot.connection.phase === "joining") open(hello, DEAD_AFTER_MS);
  }

  function joinHello(joining: JoinEntry): Hello {
    return {
      t: "join",
      slug,
      name: joining.name,
      ...(joining.verifier === undefined ? {} : { verifier: joining.verifier }),
      ...(joining.listed === undefined ? {} : { listed: joining.listed }),
      ...(joining.look ? { look: joining.look } : {}),
      ...(joining.face ? { face: joining.face } : {}),
    };
  }

  function tellServerGoodbye() {
    if (snapshot.connection.phase === "joined") link?.send({ t: "leave" });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start() {
      if (entry) {
        begin(joinHello(entry));
        return;
      }
      const seat = readSeat(storage, slug);
      if (!seat) {
        dispatch({ type: "start", resuming: true });
        end({ kind: "expired" });
        return;
      }
      patch({ private: seat.private, listed: seat.listed });
      begin({ t: "resume", slug, pid: seat.pid, secret: seat.secret });
    },
    canRejoin: () => entry !== undefined,
    rejoin() {
      if (entry && snapshot.connection.phase === "ended") begin(joinHello(entry));
    },
    leave() {
      leaving = true;
      tellServerGoodbye();
      end({ kind: "left" });
    },
    dispose() {
      leaving = true;
      tellServerGoodbye();
      stopTimers();
      noticeTimers.forEach(clearTimeout);
      noticeTimers.clear();
      closeLink();
      if (snapshot.connection.phase !== "ended") clearSeat(storage, slug);
    },
    sendBoard(data, to) {
      return link?.send({ t: "board", board: JSON.stringify(data), ...(to ? { to } : {}) }) ?? false;
    },
    onBoard(listener) {
      boardListeners.add(listener);
      return () => void boardListeners.delete(listener);
    },
    sendRtc(signal) {
      return link?.send({ t: "rtc", ...signal }) ?? false;
    },
    onRtc(listener) {
      rtcListeners.add(listener);
      return () => void rtcListeners.delete(listener);
    },
    setLook(look, face) {
      link?.send({ t: "look", look, face });
    },
    setPhoto(data) {
      link?.send({ t: "photo", data });
    },
    say(text, to) {
      return link?.send({ t: "chat", text, ...(to ? { to } : {}) }) ?? false;
    },
    setMedia(flags) {
      if (flags === mediaFlags) return;
      mediaFlags = flags;
      link?.send({ t: "media", flags });
    },
    owner(op, effect) {
      const sent = link?.send({ t: "owner", ...op }) ?? false;
      if (sent && effect) {
        patch({
          ...(effect.listed === undefined ? {} : { listed: effect.listed }),
          ...(effect.private === undefined ? {} : { private: effect.private }),
          ...("password" in effect ? { password: effect.password } : {}),
        });
        const seat = readSeat(storage, slug);
        if (seat) writeSeat(storage, slug, { ...seat, private: snapshot.private, ...(snapshot.listed === undefined ? {} : { listed: snapshot.listed }) });
      }
      return sent;
    },
  };
}
