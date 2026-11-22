import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { openLink, platformSocket } from "../signal/link";

const BROWSERS = [process.env.CHROME_BIN, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 900, height: 880 },
];
const THEMES = ["light", "dark"] as const;
const MINIMUM = 4.5;

type Viewport = { width: number; height: number };
type Screen = { name: string; path: (viewport: Viewport) => string; waitFor: string };
type Low = { text: string; ratio: number };

const SUBMIT = "button[type=submit]";
const SCREENS: Screen[] = [
  { name: "home", path: () => "", waitFor: SUBMIT },
  { name: "open rooms", path: () => "lobby", waitFor: "text=Back" },
  { name: "free room door", path: ({ width, height }) => `free-${width}x${height}`, waitFor: SUBMIT },
  { name: "occupied room door", path: ({ width, height }) => `busy-${width}x${height}`, waitFor: "text=/\\d+\\/\\d+ people are in it/" },
];

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

async function lowContrast(page: Page, minimum: number): Promise<Low[]> {
  return page.evaluate((floor) => {
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!probe) throw new Error("no 2d context");
    const rgba = (css: string): [number, number, number, number] => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return [r ?? 0, g ?? 0, b ?? 0, (a ?? 0) / 255];
    };
    const over = (top: number[], below: number[]) => [0, 1, 2].map((i) => top[i]! * top[3]! + below[i]! * (1 - top[3]!));
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const backdrop = (el: Element, at: DOMRect): number[] => {
      const stack = document.elementsFromPoint(at.left + at.width / 2, at.top + at.height / 2);
      const layers: number[][] = [];
      for (const node of stack.slice(Math.max(stack.indexOf(el), 0))) {
        const own = rgba(getComputedStyle(node).backgroundColor);
        const pseudo = getComputedStyle(node, "::before");
        const color = own[3] === 0 && pseudo.content !== "none" ? rgba(pseudo.backgroundColor) : own;
        if (color[3] > 0) layers.push(color);
        if (color[3] === 1) break;
      }
      return layers.reduceRight<number[]>((below, top) => [...over(top, below), 1], [255, 255, 255, 1]);
    };
    const failures: { text: string; ratio: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? "";
      const el = node.parentElement;
      if (!text || !el || el.closest("[inert], script, style") || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const style = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(node);
      const at = range.getBoundingClientRect();
      if (at.width === 0 || at.top < 0 || at.bottom > innerHeight || at.left < 0 || at.right > innerWidth) continue;
      const back = backdrop(el, at);
      const fore = rgba(style.color);
      const text3 = over(fore, back);
      const [hi, lo] = [lum(text3), lum(back)].sort((a, b) => b - a);
      const ratio = (hi! + 0.05) / (lo! + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : floor)) failures.push({ text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100 });
    }
    return failures;
  }, minimum);
}

describe.each(SCREENS)("the $name", (screen) => {
  describe.each(THEMES)("in the %s theme", (colorScheme) => {
    test.each(VIEWPORTS)("every visible text reaches 4.5:1 at $width x $height", async (viewport) => {
      const slug = `busy-${viewport.width}x${viewport.height}`;
      const occupant = screen.path(viewport).startsWith("busy-")
        ? openLink({ url: process.env.LIVE_SIGNAL ?? "", hello: { t: "join", slug, name: "Ana", listed: true }, socket: platformSocket(), onEvent: () => undefined })
        : undefined;
      const page = await browser.newPage({ viewport, colorScheme });
      try {
        await page.goto(base + screen.path(viewport));
        await page.locator(screen.waitFor).first().waitFor();
        await page.waitForFunction(() => !document.documentElement.hasAttribute("data-enter"));
        await page.waitForTimeout(1000);
        if (process.env.CONTRAST_SHOTS) await page.screenshot({ path: `${process.env.CONTRAST_SHOTS}/${screen.name.replaceAll(" ", "-")}-${colorScheme}-${viewport.width}.png` });
        expect(await lowContrast(page, MINIMUM)).toEqual([]);
      } finally {
        occupant?.send({ t: "leave" });
        await page.close();
      }
    });
  });
});
