import { describe, expect, test } from "vitest";

import { derive } from "../domain/password";
import { readSeat } from "../session/seat";
import { createSession } from "../session/session";
import { openLink, platformSocket, type Link, type LinkEvent } from "./link";
import type { Hello, ServerFrame } from "./protocol";

type Client = {
  link: Link;
  events: LinkEvent[];
  frame<T extends ServerFrame["t"]>(t: T, where?: (f: Extract<ServerFrame, { t: T }>) => boolean): Promise<Extract<ServerFrame, { t: T }>>;
  closed(): Promise<Extract<LinkEvent, { kind: "closed" }>>;
};

let counter = 0;
const slugOf = (prefix: string) => `${prefix}-${process.pid}-${Date.now().toString(36)}-${counter++}`;

function connect(hello: Hello): Client {
  const events: LinkEvent[] = [];
  const waiters: Array<() => void> = [];
  const link = openLink({
    url: process.env.LIVE_SIGNAL ?? "",
    hello,
    socket: platformSocket(),
    onEvent: (event) => {
      events.push(event);
      waiters.splice(0).forEach((wake) => wake());
    },
  });
  const until = <T>(find: () => T | undefined): Promise<T> =>
    new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`timed out; saw ${JSON.stringify(events)}`)), 30_000);
      const check = () => {
        const found = find();
        if (found !== undefined) {
          clearTimeout(timer);
          done(found);
        } else waiters.push(check);
      };
      check();
    });
  return {
    link,
    events,
    frame: (t, where) =>
      until<Extract<ServerFrame, { t: typeof t }>>(() => {
        for (const event of events) if (event.kind === "frame" && event.frame.t === t && (!where || where(event.frame as never))) return event.frame as never;
        return undefined;
      }),
    closed: () => until<Extract<LinkEvent, { kind: "closed" }>>(() => events.find((e) => e.kind === "closed") as Extract<LinkEvent, { kind: "closed" }> | undefined),
  };
}

const api = (path: string) => fetch(`${process.env.LIVE_HTTP}${path}`).then((r) => r.json() as Promise<Record<string, unknown>>);

describe("the lv.1 server", () => {
  describe("when a free slug is joined", () => {
    test("creates the room, answers joined first and then the roster with me as owner", async () => {
      const slug = slugOf("create");
      const me = connect({ t: "join", slug, name: "Ana", listed: true });
      const joined = await me.frame("joined");
      const roster = await me.frame("roster");
      expect(me.events[0]).toMatchObject({ frame: { t: "joined" } });
      expect(roster.people).toEqual([expect.objectContaining({ pid: joined.pid, name: "Ana", state: "connecting", flags: 32 })]);
      expect(await api(`/api/rooms/${slug}`)).toMatchObject({ slug, exists: true, private: false, count: 1 });
      expect((await api("/api/lobby")).rooms).toEqual(expect.arrayContaining([expect.objectContaining({ slug })]));
      me.link.send({ t: "leave" });
      expect((await me.closed()).meaning.kind).toBe("left");
    });
  });

  describe("when a second participant joins", () => {
    test("both see two people in slot order", async () => {
      const slug = slugOf("two");
      const ana = connect({ t: "join", slug, name: "Ana" });
      await ana.frame("joined");
      const bia = connect({ t: "join", slug, name: "Bia" });
      await bia.frame("joined");
      const seen = await ana.frame("roster", (r) => r.people.length === 2);
      expect(seen.people.map((p) => p.name)).toEqual(["Ana", "Bia"]);
      expect((await bia.frame("roster", (r) => r.people.length === 2)).v).toBe(seen.v);
      ana.link.send({ t: "leave" });
      bia.link.send({ t: "leave" });
    });
  });

  describe("when a participant resumes after a dropped socket", () => {
    test("keeps the same pid, rotates the secret and refuses the old one", async () => {
      const slug = slugOf("resume");
      const first = connect({ t: "join", slug, name: "Ana" });
      const joined = await first.frame("joined");
      first.link.close();
      const second = connect({ t: "resume", slug, pid: joined.pid, secret: joined.secret });
      const resumed = await second.frame("joined");
      expect(resumed.pid).toBe(joined.pid);
      expect(resumed.secret).not.toBe(joined.secret);
      const stale = connect({ t: "resume", slug, pid: joined.pid, secret: joined.secret });
      const closed = await stale.closed();
      expect(closed).toMatchObject({ code: 4400, error: { code: "NOT_FOUND" } });
      second.link.send({ t: "leave" });
    });
  });

  describe("when a private room is entered", () => {
    test("accepts the right password, refuses a wrong one and refuses none", async () => {
      const slug = slugOf("secret");
      const right = await derive("Kq7mR2xP", slug);
      const wrong = await derive("Zz9yX8wV", slug);
      const owner = connect({ t: "join", slug, name: "Ana", verifier: right.verifier });
      await owner.frame("joined");
      expect(await api(`/api/rooms/${slug}`)).toMatchObject({ private: true });

      const intruder = connect({ t: "join", slug, name: "Eve", verifier: wrong.verifier });
      expect(await intruder.closed()).toMatchObject({ code: 4400, error: { code: "PERMISSION_DENIED" } });
      const nobody = connect({ t: "join", slug, name: "Eve" });
      expect(await nobody.closed()).toMatchObject({ code: 4400, error: { code: "PERMISSION_DENIED" } });
      const friend = connect({ t: "join", slug, name: "Bia", verifier: right.verifier });
      await friend.frame("joined");
      owner.link.send({ t: "leave" });
      friend.link.send({ t: "leave" });
    });
  });

  describe("when a frame comes before joined", () => {
    test("the link refuses to send it", async () => {
      const me = connect({ t: "join", slug: slugOf("early"), name: "Ana" });
      expect(me.link.send({ t: "hb" })).toBe(false);
      await me.frame("joined");
      me.link.send({ t: "leave" });
    });
  });

  describe("when the owner acts before their media is up", () => {
    test("is refused with INVARIANT_VIOLATION and stays connected", async () => {
      const slug = slugOf("owner");
      const ana = connect({ t: "join", slug, name: "Ana" });
      await ana.frame("joined");
      const bia = connect({ t: "join", slug, name: "Bia" });
      const joined = await bia.frame("joined");
      await ana.frame("roster", (r) => r.people.length === 2);
      ana.link.send({ t: "owner", op: "remove", pid: joined.pid });
      expect(await ana.frame("error")).toMatchObject({ code: "INVARIANT_VIOLATION", message: "only the active owner may do this" });
      expect(ana.events.some((e) => e.kind === "closed")).toBe(false);
      ana.link.send({ t: "leave" });
      bia.link.send({ t: "leave" });
    });
  });

  describe("when no media ever comes up", () => {
    test("the server drops the participant after about fifteen seconds with 4403 and tells the others why", async () => {
      const slug = slugOf("nomedia");
      const ana = connect({ t: "join", slug, name: "Ana" });
      await ana.frame("joined");
      const bia = connect({ t: "join", slug, name: "Bia" });
      await bia.frame("joined");
      const beat = setInterval(() => [ana, bia].forEach((c) => c.link.send({ t: "hb" })), 4000);
      try {
        const after = await bia.frame("roster", (r) => r.gone.length > 0);
        expect(after.gone).toEqual([{ pid: 1, reason: "media-timeout" }]);
        expect(await ana.closed()).toMatchObject({ code: 4403 });
      } finally {
        clearInterval(beat);
      }
    }, 40_000);
  });

  describe("a session against the real server", () => {
    test("joins, stores the seat and leaves", async () => {
      const slug = slugOf("session");
      const map = new Map<string, string>();
      const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
      const session = createSession({ slug, url: process.env.LIVE_SIGNAL ?? "", socket: platformSocket(), storage, entry: { name: "Ana" } });
      const joined = new Promise<void>((done) => {
        const stop = session.subscribe(() => {
          const connection = session.getSnapshot().connection;
          if (connection.phase === "joined" && connection.roster.people.length === 1) {
            stop();
            done();
          }
        });
      });
      session.start();
      await joined;
      expect(readSeat(storage, slug)).toMatchObject({ private: false });
      session.leave();
      expect(session.getSnapshot().connection).toEqual({ phase: "ended", reason: { kind: "left" } });
      expect(readSeat(storage, slug)).toBeUndefined();
    });
  });
});
