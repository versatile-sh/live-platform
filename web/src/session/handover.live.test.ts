import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import { platformSocket } from "../signal/link";
import { createSession, type Session } from "./session";

const started: ChildProcess[] = [];
const closing: Server[] = [];
const dirs: string[] = [];

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

async function server(state: string): Promise<{ child: ChildProcess; signal: number }> {
  const [http, signal] = [await freePort(), await freePort()];
  const child = spawn(process.env.LIVE_BINARY ?? "", [], { env: { ...process.env, PORT: String(http), SIGNAL_PORT: String(signal), MEDIA: "off", HANDOVER_DIR: state }, stdio: "ignore" });
  started.push(child);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${http}/up`)).ok) return { child, signal };
    } catch {
      await new Promise((resume) => setTimeout(resume, 50));
    }
  }
  throw new Error("the server did not come up");
}

/** Stands for the name both containers answer to: new connections go to whichever server it points at. */
async function door(first: number): Promise<{ port: number; point(to: number): void }> {
  let target = first;
  const listener = createServer((socket) => {
    const upstream = connect(target, "127.0.0.1");
    socket.pipe(upstream).pipe(socket);
    const drop = () => {
      socket.destroy();
      upstream.destroy();
    };
    socket.on("error", drop).on("close", drop);
    upstream.on("error", drop).on("close", drop);
  });
  closing.push(listener);
  const port = await freePort();
  await new Promise<void>((done) => listener.listen(port, "127.0.0.1", done));
  return { port, point: (to) => void (target = to) };
}

function enter(url: string, name: string): Session {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
  const session = createSession({ slug: "handover", url, socket: platformSocket(), storage, entry: { name } });
  session.start();
  return session;
}

function until(session: Session, ready: (session: Session) => boolean, within = 15_000): Promise<void> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`timed out; connection is ${JSON.stringify(session.getSnapshot().connection).slice(0, 300)}`)), within);
    const check = () => {
      if (!ready(session)) return;
      clearTimeout(timer);
      stop();
      done();
    };
    const stop = session.subscribe(check);
    check();
  });
}

const joinedWith = (count: number) => (session: Session) => {
  const { connection } = session.getSnapshot();
  return connection.phase === "joined" && connection.roster.people.length === count && connection.roster.people.every((person) => person.state === "active");
};

afterAll(() => {
  started.forEach((child) => child.kill("SIGKILL"));
  closing.forEach((listener) => listener.close());
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("a server deploy, with the browser's own session code", () => {
  test("the old server hands its rooms over and both people are back in their places within seconds", async () => {
    const state = mkdtempSync(join(tmpdir(), "live-handover-"));
    dirs.push(state);
    const old = await server(state);
    const name = await door(old.signal);
    const url = `ws://127.0.0.1:${name.port}/ws`;

    const ana = enter(url, "Ana");
    await until(ana, joinedWith(1));
    const bia = enter(url, "Bia");
    await until(bia, joinedWith(2));
    await until(ana, joinedWith(2));
    const before = [ana, bia].map((session) => {
      const { connection } = session.getSnapshot();
      return connection.phase === "joined" ? connection.me : 0;
    });
    ana.owner({ op: "mute-all" });
    await until(bia, (session) => session.getSnapshot().connection.phase === "joined" && (session.getSnapshot().connection as { roster: { quiet?: boolean } }).roster.quiet === true);

    const next = await server(state);
    name.point(next.signal);
    const dropped = Promise.all([ana, bia].map((session) => until(session, (s) => s.getSnapshot().connection.phase === "reconnecting")));
    const at = Date.now();
    old.child.kill("SIGTERM");
    await dropped;
    await Promise.all([until(ana, joinedWith(2)), until(bia, joinedWith(2))]);
    const blink = Date.now() - at;

    const after = [ana, bia].map((session) => {
      const { connection } = session.getSnapshot();
      return connection.phase === "joined" ? connection.me : 0;
    });
    expect(after).toEqual(before);
    const { connection } = ana.getSnapshot();
    expect(connection.phase === "joined" && connection.roster.quiet).toBe(true);
    expect(connection.phase === "joined" && connection.roster.people.find((person) => person.pid === before[0])?.flags).toBe(32);
    expect(blink).toBeLessThan(6000);
    console.info(`handover: back in ${blink} ms`);
    ana.leave();
    bia.leave();
  });
});
