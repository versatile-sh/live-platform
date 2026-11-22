import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { openLink, platformSocket } from "../signal/link";

const BROWSERS = [process.env.CHROME_BIN, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];

const STACKED = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 700, height: 900 },
  { width: 900, height: 880 },
];
const WIDE = [
  { width: 1280, height: 650 },
  { width: 1440, height: 900 },
];

type Screen = { name: string; path: (viewport: Viewport) => string; primary: string; waitFor: string };
type Viewport = { width: number; height: number };

const SUBMIT = "button[type=submit]";
const SCREENS: Screen[] = [
  { name: "home", path: () => "", primary: SUBMIT, waitFor: SUBMIT },
  { name: "open rooms", path: () => "lobby", primary: "a[href='/']:not(h1 a)", waitFor: "text=Back" },
  { name: "free room door", path: ({ width, height }) => `free-${width}x${height}`, primary: SUBMIT, waitFor: SUBMIT },
  { name: "occupied room door (N/10 people)", path: ({ width, height }) => `busy-${width}x${height}`, primary: SUBMIT, waitFor: "text=/\\d+\\/\\d+ people are in it/" },
  { name: "occupied room door with a guest pass", path: ({ width, height }) => `busy-${width}x${height}?pass=0123456789abcdef0123`, primary: SUBMIT, waitFor: "text=/\\d+\\/\\d+ people are in it/" },
];

type Probe = {
  scrollers: string[];
  pitchBottom: number;
  controlsTop: number;
  overlaps: string[];
  primary: { top: number; bottom: number; hit: boolean };
  pageOverflows: boolean;
};

let vite: ViteDevServer;
let browser: Browser;
let base: string;

beforeAll(async () => {
  const executablePath = BROWSERS.find((path) => path !== undefined && existsSync(path));
  if (executablePath === undefined) throw new Error("no Chromium found: set CHROME_BIN to a Chrome or Chromium binary");
  vite = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await vite.listen();
  base = vite.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch({ executablePath });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await vite?.close();
});

async function probe(page: Page, primary: string): Promise<Probe> {
  return page.evaluate((primarySelector) => {
    const pitch = document.querySelector("h1")?.closest("section");
    if (!pitch) throw new Error("the pitch is missing");
    const pitchBox = pitch.getBoundingClientRect();
    const shown = (el: Element) => el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true });
    const controls = [...document.querySelectorAll<HTMLElement>("input, button, a[href]")].filter((el) => !pitch.contains(el) && !el.closest("[inert]") && shown(el));
    const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const target = [...document.querySelectorAll<HTMLElement>(primarySelector)].find((el) => shown(el) && !pitch.contains(el));
    if (!target) throw new Error(`the primary control ${primarySelector} is missing`);
    const box = target.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const scrollers = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const { overflowY } = getComputedStyle(el);
        return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().split(" ")[0]}`);
    return {
      scrollers,
      pitchBottom: pitchBox.bottom,
      controlsTop: Math.min(...controls.map((el) => el.getBoundingClientRect().top)),
      overlaps: controls.filter((el) => intersects(pitchBox, el.getBoundingClientRect())).map((el) => el.outerHTML.slice(0, 60)),
      primary: { top: box.top, bottom: box.bottom, hit: hit === target || target.contains(hit) },
      pageOverflows: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  }, primary);
}

async function open(screen: Screen, viewport: Viewport): Promise<{ page: Page; close: () => Promise<void> }> {
  const slug = `busy-${viewport.width}x${viewport.height}`;
  const occupant = screen.path(viewport).startsWith("busy-")
    ? openLink({ url: process.env.LIVE_SIGNAL ?? "", hello: { t: "join", slug, name: "Ana", listed: true }, socket: platformSocket(), onEvent: () => undefined })
    : undefined;
  const page = await browser.newPage({ viewport });
  await page.route("**/api/pass/*", (route) => route.fulfill({ json: { name: "Gus", face: "", private: false, listed: true } }));
  await page.goto(base + screen.path(viewport));
  await page.locator(screen.waitFor).first().waitFor();
  await page.waitForTimeout(1500);
  return {
    page,
    close: async () => {
      occupant?.send({ t: "leave" });
      await page.close();
    },
  };
}

describe.each(SCREENS)("the $name", (screen) => {
  describe.each(STACKED)("stacked at $width x $height", (viewport) => {
    test("the page is the only scroller, the wheel scrolls it from the lime pane, nothing overlaps and the primary control is reachable", async () => {
      const { page, close } = await open(screen, viewport);
      try {
        const top = await probe(page, screen.primary);
        expect(top.scrollers).toEqual([]);
        expect(top.overlaps).toEqual([]);
        expect(top.controlsTop).toBeGreaterThanOrEqual(top.pitchBottom - 1);

        if (top.pageOverflows) {
          const pitchCenter = await page.evaluate(() => {
            const box = document.querySelector("h1")?.closest("section")?.getBoundingClientRect();
            if (!box) throw new Error("the pitch is missing");
            return { x: box.left + box.width / 2, y: Math.min(box.top + box.height / 2, window.innerHeight - 1) };
          });
          await page.mouse.move(pitchCenter.x, pitchCenter.y);
          await page.mouse.wheel(0, 120);
          await page.waitForTimeout(300);
          expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        }

        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, 10000);
        await page.waitForTimeout(300);
        const bottom = await probe(page, screen.primary);
        expect(bottom.primary.top).toBeGreaterThanOrEqual(0);
        expect(bottom.primary.bottom).toBeLessThanOrEqual(viewport.height + 1);
        expect(bottom.primary.hit).toBe(true);
        expect(bottom.scrollers).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  describe.each(WIDE)("wide at $width x $height", (viewport) => {
    test("the halves do not overlap, the page does not scroll and the primary control is reachable", async () => {
      const { page, close } = await open(screen, viewport);
      try {
        const state = await probe(page, screen.primary);
        expect(state.overlaps).toEqual([]);
        expect(state.pageOverflows).toBe(false);
        await page.locator(screen.primary).first().scrollIntoViewIfNeeded();
        const reached = await probe(page, screen.primary);
        expect(reached.primary.bottom).toBeLessThanOrEqual(viewport.height + 1);
        expect(reached.primary.hit).toBe(true);
      } finally {
        await close();
      }
    });
  });
});
