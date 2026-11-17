import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../styles.css"), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]));
}

const dark = tokens(css.slice(css.indexOf("@theme"), css.indexOf("@media (prefers-color-scheme: light)")));
const light = { ...dark, ...tokens(css.slice(css.indexOf("@media (prefers-color-scheme: light)"), css.indexOf("html {"))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

describe.each([
  ["dark", dark],
  ["light", light],
] as const)("%s theme tokens", (_name, theme) => {
  test.each([
    ["fg", "canvas"],
    ["fg", "card"],
    ["muted", "canvas"],
    ["muted", "card"],
    ["accent", "canvas"],
    ["accent", "card"],
    ["amber", "canvas"],
    ["amber", "card"],
    ["on-bubble", "bubble"],
  ])("text %s on %s reaches 4.5:1", (foreground, background) => {
    expect(contrast(theme[foreground]!, theme[background]!)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(["canvas", "card"])("the control border reaches 3:1 against the %s", (background) => {
    expect(contrast(theme["muted-light"]!, theme[background]!)).toBeGreaterThanOrEqual(3);
  });
});
