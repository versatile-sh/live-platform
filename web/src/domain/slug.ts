import { generatePassword, type RandomBytes } from "./password";

const MIN_LENGTH = 2;
const MAX_LENGTH = 40;
const RESERVED = new Set(["api", "ws", "up", "assets", "lobby", "static", "new", "about", "docs", "privacy"]);

/** Why a slug was refused, in the order the checks run. */
export type SlugProblem = "empty" | "length" | "characters" | "hyphens" | "reserved";

/** The outcome of checking a slug the way the server does. */
export type SlugCheck = { ok: true; slug: string } | { ok: false; problem: SlugProblem };

/** Lowercases and trims what a person typed so that a pasted `Standup ` still finds `standup`. */
export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Mirrors the server's slug rule: 2 to 40 lowercase letters, digits and single inner hyphens, never a reserved path. */
export function checkSlug(slug: string): SlugCheck {
  if (slug.length === 0) return { ok: false, problem: "empty" };
  if (slug.length < MIN_LENGTH || slug.length > MAX_LENGTH) return { ok: false, problem: "length" };
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, problem: "characters" };
  if (slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) return { ok: false, problem: "hyphens" };
  if (RESERVED.has(slug)) return { ok: false, problem: "reserved" };
  return { ok: true, slug };
}

/** A room name drawn at random, like `8abh-23hk`: two groups of four letters and digits without look-alikes. One in about 10^12, so it is free in practice. */
export function randomSlug(random?: RandomBytes): string {
  return generatePassword(random).toLowerCase();
}
