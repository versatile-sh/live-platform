import { describe, expect, test } from "vitest";

import { checkSlug, normalizeSlug } from "./slug";

describe("checkSlug", () => {
  describe("with a well-formed slug", () => {
    test.each(["ab", "standup", "team-1", "a1-b2-c3", "x".repeat(40)])("accepts %s", (slug) => {
      expect(checkSlug(slug)).toEqual({ ok: true, slug });
    });
  });

  describe("with a slug that breaks a rule", () => {
    test.each([
      ["", "empty"],
      ["a", "length"],
      ["x".repeat(41), "length"],
      ["Team", "characters"],
      ["a b", "characters"],
      ["café", "characters"],
      ["a_b", "characters"],
      ["-ab", "hyphens"],
      ["ab-", "hyphens"],
      ["a--b", "hyphens"],
      ["api", "reserved"],
      ["lobby", "reserved"],
      ["new", "reserved"],
    ] as const)("refuses %j as %s", (slug, problem) => {
      expect(checkSlug(slug)).toEqual({ ok: false, problem });
    });
  });
});

describe("normalizeSlug", () => {
  test("trims and lowercases what was typed", () => {
    expect(normalizeSlug("  Stand-Up ")).toBe("stand-up");
  });
});
