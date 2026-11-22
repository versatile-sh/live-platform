import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer as createVite, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const BROWSERS = [process.env.CHROME_BIN, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
const KEY = "test-issuer-key-of-at-least-32-characters";
const SLUG = "call-77";
const BOT_PASS = "pass-from-the-bot-0077";
const SHOTS = process.env.LIVE_SHOTS;

const passes = new Map<string, object>();
let issuer: HttpServer;
let live: ChildProcess;
let vite: ViteDevServer;
let browser: Browser;
let base: string;
let audit: string;

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

beforeAll(async () => {
  const executablePath = BROWSERS.find((path) => path !== undefined && existsSync(path));
  if (executablePath === undefined) throw new Error("no Chromium found: set CHROME_BIN to a Chrome or Chromium binary");
  const issuerPort = await freePort();
  issuer = createHttpServer((req, res) => {
    const id = (req.url ?? "").slice(1);
    const pass = passes.get(id);
    if (req.headers.authorization !== `Bearer ${KEY}` || !pass) {
      res.writeHead(404).end();
      return;
    }
    passes.delete(id);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(pass));
  });
  await new Promise<void>((done) => issuer.listen(issuerPort, "127.0.0.1", done));
  audit = mkdtempSync(join(tmpdir(), "live-discord-return-"));
  const [http, signal] = [await freePort(), await freePort()];
  live = spawn(process.env.LIVE_BINARY ?? "", [], { env: { ...process.env, PORT: String(http), SIGNAL_PORT: String(signal), MEDIA: "off", PASS_SOURCE: `http://127.0.0.1:${issuerPort}`, PASS_KEY: KEY, AUDIT_DIR: audit }, stdio: "ignore" });
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${http}/up`).then((r) => r.ok, () => false)); i++) await new Promise((resume) => setTimeout(resume, 50));
  process.env.LIVE_HTTP = `http://127.0.0.1:${http}`;
  process.env.LIVE_SIGNAL = `ws://127.0.0.1:${signal}/ws`;
  vite = await createVite({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await vite.listen();
  base = vite.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch({ executablePath, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
  live?.kill("SIGKILL");
  issuer?.close();
  if (audit) rmSync(audit, { recursive: true, force: true });
});

async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity), undefined, { timeout: 10000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function enterRoom(page: Page, button: RegExp) {
  await page.getByRole("button", { name: button }).click();
  await page.getByRole("button", { name: "Leave" }).first().waitFor({ timeout: 15000 });
  await settle(page);
  await expect.poll(() => page.getByLabel("Your name").count(), { timeout: 10000 }).toBe(0);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[src^="data:image/jpeg"]')].some((img) => img.complete && img.naturalWidth === 32), undefined, { timeout: 10000 });
}

async function leaveRoom(page: Page) {
  await page.getByRole("button", { name: "Leave" }).first().click();
  await expect.poll(() => page.getByRole("button", { name: "Leave" }).count(), { timeout: 10000 }).toBe(0);
  await settle(page);
}

function joins(): (string | undefined)[] {
  return readdirSync(audit)
    .flatMap((file) => readFileSync(join(audit, file), "utf8").split("\n"))
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { kind: string; room: string; client?: { discord?: { user_id?: string } } })
    .filter((event) => event.kind === "join" && event.room === SLUG)
    .map((event) => event.client?.discord?.user_id);
}

describe("a person who entered from Discord, in a real browser", () => {
  test("keeps the name, the photo and the Discord origin after leaving and coming back, with or without the old link", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const face = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d");
      if (!context) return "";
      context.fillStyle = "#5865f2";
      context.fillRect(0, 0, 32, 32);
      return canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
    });
    expect(face.length).toBeGreaterThan(100);
    passes.set(BOT_PASS, { name: "Ana Souza", face, private: false, listed: false, slug: SLUG, discordUserId: "42", discordName: "ana", guildId: "7", channelId: "9" });

    await page.goto(`${base}${SLUG}?pass=${BOT_PASS}`);
    await expect.poll(() => page.getByLabel("Your name").inputValue(), { timeout: 10000 }).toBe("Ana Souza");
    expect(new URL(page.url()).search).toBe("");
    await shot(page, "1-door-from-discord");
    await enterRoom(page, /Create and enter|Enter/);
    await shot(page, "2-in-room-first");
    await leaveRoom(page);

    await page.goto(`${base}`);
    await page.goto(`${base}${SLUG}`);
    await expect.poll(() => page.getByLabel("Your name").inputValue(), { timeout: 10000 }).toBe("Ana Souza");
    await shot(page, "3-door-coming-back");
    await enterRoom(page, /Create and enter|Enter/);
    await shot(page, "4-in-room-again");
    await leaveRoom(page);

    await page.goto(`${base}${SLUG}?pass=${BOT_PASS}`);
    await expect.poll(() => page.getByLabel("Your name").inputValue(), { timeout: 10000 }).toBe("Ana Souza");
    await enterRoom(page, /Create and enter|Enter/);
    await shot(page, "5-in-room-from-the-old-link");
    await leaveRoom(page);

    const kept = await page.evaluate(() => localStorage.getItem("live.passes") ?? "");
    expect(kept).not.toContain(BOT_PASS);
    await expect.poll(joins, { timeout: 5000 }).toEqual(["42", "42", "42"]);
    await page.close();
  });
});
