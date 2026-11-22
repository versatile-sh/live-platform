import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import { platformSocket } from "../signal/link";
import { createSession, type Session } from "./session";

const KEY = "test-issuer-key-of-at-least-32-characters";
const started: ChildProcess[] = [];
const issuers: HttpServer[] = [];
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

async function issuer(passes: Map<string, object>): Promise<number> {
  const port = await freePort();
  const server = createHttpServer((req, res) => {
    const id = (req.url ?? "").slice(1);
    const pass = passes.get(id);
    if (req.headers.authorization !== `Bearer ${KEY}` || !pass) {
      res.writeHead(404).end();
      return;
    }
    passes.delete(id);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(pass));
  });
  issuers.push(server);
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  return port;
}

async function server(issuerPort: number, audit: string): Promise<{ http: string; signal: string }> {
  const [http, signal] = [await freePort(), await freePort()];
  const child = spawn(process.env.LIVE_BINARY ?? "", [], { env: { ...process.env, PORT: String(http), SIGNAL_PORT: String(signal), MEDIA: "off", PASS_SOURCE: `http://127.0.0.1:${issuerPort}`, PASS_KEY: KEY, AUDIT_DIR: audit }, stdio: "ignore" });
  started.push(child);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${http}/up`)).ok) return { http: `http://127.0.0.1:${http}`, signal: `ws://127.0.0.1:${signal}/ws` };
    } catch {
      await new Promise((resume) => setTimeout(resume, 50));
    }
  }
  throw new Error("the server did not come up");
}

function enter(url: string, pass: string, heard: (pass: string | undefined) => void): Session {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
  const session = createSession({ slug: "call-42", url, socket: platformSocket(), storage, entry: { name: "Ana", pass }, onPass: heard });
  session.start();
  return session;
}

function joined(session: Session, within = 15_000): Promise<void> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`timed out; connection is ${JSON.stringify(session.getSnapshot().connection).slice(0, 300)}`)), within);
    const check = () => {
      if (session.getSnapshot().connection.phase !== "joined") return;
      clearTimeout(timer);
      stop();
      done();
    };
    const stop = session.subscribe(check);
    check();
  });
}

function nextPass(): { heard: (pass: string | undefined) => void; value: Promise<string | undefined> } {
  let heard: (pass: string | undefined) => void = () => undefined;
  const value = new Promise<string | undefined>((done) => (heard = done));
  return { heard, value };
}

async function discordJoins(audit: string): Promise<(string | undefined)[]> {
  for (let i = 0; i < 50; i++) {
    const joins = readdirSync(audit)
      .flatMap((file) => readFileSync(join(audit, file), "utf8").split("\n"))
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { kind: string; client?: { discord?: { user_id?: string } } })
      .filter((event) => event.kind === "join");
    if (joins.length >= 3) return joins.map((event) => event.client?.discord?.user_id);
    await new Promise((resume) => setTimeout(resume, 100));
  }
  throw new Error("the audit log did not record three joins");
}

afterAll(() => {
  started.forEach((child) => child.kill("SIGKILL"));
  issuers.forEach((issuer) => issuer.close());
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("leaving a room entered from Discord and coming back, with the browser's own session code", () => {
  test("the pass handed back on entry lets the same person in again with the Discord origin, once", async () => {
    const audit = mkdtempSync(join(tmpdir(), "live-rejoin-"));
    dirs.push(audit);
    const passes = new Map<string, object>([["pass-from-the-bot-0001", { name: "Ana", face: "", private: false, listed: false, slug: "call-42", discordUserId: "42", discordName: "ana", guildId: "7", channelId: "9" }]]);
    const live = await server(await issuer(passes), audit);
    expect((await fetch(`${live.http}/api/pass/pass-from-the-bot-0001`)).status).toBe(200);

    const first = nextPass();
    const visit = enter(live.signal, "pass-from-the-bot-0001", first.heard);
    await joined(visit);
    const renewed = await first.value;
    expect(renewed).toMatch(/^[A-Za-z0-9_-]{43}$/);
    visit.leave();

    const second = nextPass();
    const back = enter(live.signal, renewed ?? "", second.heard);
    await joined(back);
    const again = await second.value;
    expect(again).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(again).not.toBe(renewed);

    const stale = nextPass();
    const replay = enter(live.signal, renewed ?? "", stale.heard);
    await joined(replay);
    expect(await stale.value).toBeUndefined();

    expect(await discordJoins(audit)).toEqual(["42", "42", undefined]);
    back.leave();
    replay.leave();
  });
});
