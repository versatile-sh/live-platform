import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fakeSockets, type FakeSocket } from "../signal/fake-socket";
import { readSeat, writeSeat } from "./seat";
import { ATTEMPT_TIMEOUT_MS, DEAD_AFTER_MS, HEARTBEAT_MS, NOTICE_MS, RETRY_WINDOW_MS, createSession, type JoinEntry } from "./session";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function setup(entry: JoinEntry | null = { name: "Ana" }) {
  const { factory, sockets } = fakeSockets();
  const storage = memoryStorage();
  const session = createSession({ slug: "demo", url: "ws://x/ws", socket: factory, storage, ...(entry ? { entry } : {}) });
  return { session, sockets, storage };
}

function sentFrames(socket: FakeSocket) {
  return socket.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
}

function enter(socket: FakeSocket, secret = "s1") {
  socket.serverOpen();
  socket.serverSend({ t: "joined", pid: 1, gen: 1, secret });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Session#start", () => {
  describe("with an entry", () => {
    test("opens a socket and sends join with the name", () => {
      const { session, sockets } = setup({ name: "Ana", verifier: "v", listed: true });
      session.start();
      sockets[0]!.serverOpen();
      expect(sentFrames(sockets[0]!)).toEqual([{ t: "join", slug: "demo", name: "Ana", verifier: "v", listed: true }]);
      expect(session.getSnapshot().connection).toEqual({ phase: "joining", resuming: false });
    });

    test("sends the listing and the look for a private room too", () => {
      const { session, sockets } = setup({ name: "Ana", verifier: "v", listed: false, look: "ff9ec7-0e1116-0" });
      session.start();
      sockets[0]!.serverOpen();
      expect(sentFrames(sockets[0]!)[0]).toMatchObject({ verifier: "v", listed: false, look: "ff9ec7-0e1116-0" });
    });

    test("a photo from the entry goes once, right after the room took the person in, never in the join itself", () => {
      const { session, sockets } = setup({ name: "Ana", photo: "AQID" });
      session.start();
      enter(sockets[0]!);
      const frames = sentFrames(sockets[0]!);
      expect(frames[0]).not.toHaveProperty("photo");
      expect(frames.filter((f) => f.t === "photo")).toEqual([{ t: "photo", data: "AQID" }]);
    });

    test("stores the seat once joined", () => {
      const { session, sockets, storage } = setup();
      session.start();
      enter(sockets[0]!);
      expect(readSeat(storage, "demo")).toEqual({ pid: 1, secret: "s1", private: false });
      expect(session.getSnapshot().connection.phase).toBe("joined");
    });
  });

  describe("without an entry", () => {
    test("resumes the stored seat", () => {
      const { session, sockets, storage } = setup(null);
      writeSeat(storage, "demo", { pid: 4, secret: "abc", private: true });
      session.start();
      sockets[0]!.serverOpen();
      expect(sentFrames(sockets[0]!)).toEqual([{ t: "resume", slug: "demo", pid: 4, secret: "abc" }]);
      expect(session.getSnapshot().private).toBe(true);
    });

    test("ends as expired when there is no stored seat", () => {
      const { session, sockets } = setup(null);
      session.start();
      expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "expired" } });
      expect(sockets).toHaveLength(0);
    });
  });
});

describe("Session heartbeat", () => {
  test("sends hb every four seconds once joined", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    sockets[0]!.serverSend({ t: "hb" });
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(sentFrames(sockets[0]!).filter((f) => f.t === "hb")).toHaveLength(2);
  });

  test("keeps the connection alive while the server answers", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(HEARTBEAT_MS);
      sockets[0]!.serverSend({ t: "hb" });
    }
    expect(session.getSnapshot().connection.phase).toBe("joined");
  });
});

describe("Session when the server goes silent", () => {
  test("shows reconnecting after eight seconds and tries to resume with the stored secret", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!, "s1");
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    expect(session.getSnapshot().connection).toMatchObject({ phase: "reconnecting", cause: "dead" });
    expect(sockets[0]!.closedByClient).toBe(true);
    sockets[1]!.serverOpen();
    expect(sentFrames(sockets[1]!)).toEqual([{ t: "resume", slug: "demo", pid: 1, secret: "s1" }]);
  });

  test("returns to joined and replaces the secret when the resume succeeds", () => {
    const { session, sockets, storage } = setup();
    session.start();
    enter(sockets[0]!, "s1");
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    enter(sockets[1]!, "s2");
    expect(session.getSnapshot().connection.phase).toBe("joined");
    expect(readSeat(storage, "demo")?.secret).toBe("s2");
  });

  test("gives up after ten seconds and ends as disconnected without opening more sockets", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    vi.advanceTimersByTime(RETRY_WINDOW_MS);
    expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "disconnected" } });
    const count = sockets.length;
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(count);
  });

  test("abandons an attempt that hangs and tries again within the window", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    vi.advanceTimersByTime(ATTEMPT_TIMEOUT_MS + 400);
    expect(sockets.length).toBeGreaterThanOrEqual(3);
    expect(session.getSnapshot().connection.phase).toBe("reconnecting");
  });
});

describe("Session when the socket closes", () => {
  test("an abnormal close shows reconnecting at once", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    sockets[0]!.serverClose(1006);
    expect(session.getSnapshot().connection).toMatchObject({ phase: "reconnecting", cause: "network" });
    expect(sockets).toHaveLength(2);
  });

  test.each([
    [4408, "silent"],
    [4409, "slow"],
    [4401, "no-hello"],
  ] as const)("code %i retries with cause %s", (code, cause) => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    sockets[0]!.serverClose(code);
    expect(session.getSnapshot().connection).toMatchObject({ phase: "reconnecting", cause });
  });

  test.each([
    [4001, { kind: "superseded" }],
    [4403, { kind: "removed" }],
    [4429, { kind: "flood" }],
    [1000, { kind: "server-closed" }],
  ] as const)("code %i ends with %j and never retries", (code, reason) => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    sockets[0]!.serverClose(code);
    vi.advanceTimersByTime(30_000);
    expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason });
    expect(sockets).toHaveLength(1);
  });

  test("a refused entry ends with the error code and never retries", () => {
    const { session, sockets } = setup({ name: "Ana", verifier: "wrong" });
    session.start();
    sockets[0]!.serverOpen();
    sockets[0]!.serverSend({ t: "error", code: "PERMISSION_DENIED", message: "needs password" });
    sockets[0]!.serverClose(4400);
    vi.advanceTimersByTime(30_000);
    expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "refused", code: "PERMISSION_DENIED" } });
    expect(sockets).toHaveLength(1);
  });

  test("a refused resume with NOT_FOUND ends as expired", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    sockets[0]!.serverClose(1006);
    sockets[1]!.serverOpen();
    sockets[1]!.serverSend({ t: "error", code: "NOT_FOUND", message: "participant not found" });
    sockets[1]!.serverClose(4400);
    expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "expired" } });
  });

  test("a socket that fails before joined ends as unreachable", () => {
    const { session, sockets } = setup();
    session.start();
    sockets[0]!.serverClose(1006);
    expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "unreachable" } });
  });

  test("a socket that never answers ends as unreachable after eight seconds", () => {
    const { session } = setup();
    session.start();
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "unreachable" } });
  });
});

describe("Session#rejoin", () => {
  test("joins again with the same entry after the session ended", () => {
    const { session, sockets } = setup({ name: "Ana" });
    session.start();
    enter(sockets[0]!);
    sockets[0]!.serverClose(4001);
    session.rejoin();
    sockets[1]!.serverOpen();
    expect(sentFrames(sockets[1]!)[0]).toMatchObject({ t: "join", name: "Ana" });
  });

  test("is not available without an entry", () => {
    expect(setup(null).session.canRejoin()).toBe(false);
  });
});

describe("Session#leave", () => {
  test("sends leave, forgets the seat and ends as left", () => {
    const { session, sockets, storage } = setup();
    session.start();
    enter(sockets[0]!);
    session.leave();
    expect(sentFrames(sockets[0]!).at(-1)).toEqual({ t: "leave" });
    expect(readSeat(storage, "demo")).toBeUndefined();
    expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "left" } });
  });
});

describe("Session#dispose", () => {
  test("a joined participant leaves", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    session.dispose();
    expect(sentFrames(sockets[0]!).at(-1)).toEqual({ t: "leave" });
  });
});

describe("Session notices", () => {
  test("a departure notice expires after a few seconds", () => {
    const { session, sockets } = setup();
    session.start();
    enter(sockets[0]!);
    const person = (pid: number) => ({ pid, slot: pid, name: `p${pid}`, state: "connecting", flags: 0 });
    sockets[0]!.serverSend({ t: "roster", v: 1, people: [person(1), person(2)], gone: [] });
    sockets[0]!.serverSend({ t: "roster", v: 2, people: [person(1)], gone: [{ pid: 2, reason: "media-timeout" }] });
    const joined = () => session.getSnapshot().connection;
    expect(joined()).toMatchObject({ notices: [{ kind: "left", reason: "media-timeout" }] });
    vi.advanceTimersByTime(NOTICE_MS);
    sockets[0]!.serverSend({ t: "hb" });
    expect(joined()).toMatchObject({ notices: [] });
  });
});

describe("Session#owner", () => {
  test("the join names the guest pass it came with, for the server to vouch for", () => {
    const { session, sockets } = setup({ name: "Ana", pass: "abcdefghijklmnopqrstuv" });
    session.start();
    sockets[0]!.serverOpen();
    expect(sentFrames(sockets[0]!)[0]).toMatchObject({ t: "join", name: "Ana", pass: "abcdefghijklmnopqrstuv" });
  });

  test("sends the frame and records the listed choice", () => {
    const { session, sockets, storage } = setup();
    session.start();
    enter(sockets[0]!);
    expect(session.owner({ op: "listed", listed: true }, { listed: true })).toBe(true);
    expect(sentFrames(sockets[0]!).at(-1)).toEqual({ t: "owner", op: "listed", listed: true });
    expect(session.getSnapshot().listed).toBe(true);
    expect(readSeat(storage, "demo")?.listed).toBe(true);
  });

  test("reports false when not joined", () => {
    const { session } = setup();
    expect(session.owner({ op: "remove", pid: 2 })).toBe(false);
  });
});
