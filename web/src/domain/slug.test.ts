import { describe, expect, test } from "vitest";

import { checkSlug, normalizeSlug, randomSlug } from "./slug";

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

describe("randomSlug", () => {
  test("draws a name the server accepts, in two groups of four", () => {
    for (let i = 0; i < 200; i++) {
      const slug = randomSlug();
      expect(slug).toMatch(/^[2-9a-hj-np-z]{4}-[2-9a-hj-np-z]{4}$/);
      expect(checkSlug(slug)).toEqual({ ok: true, slug });
    }
  });

  test("takes its letters from the draw it is given", () => {
    let i = 0;
    const draws = [17, 5, 22, 8, 1, 29, 19, 7];
    expect(randomSlug((bytes) => void (bytes[0] = draws[i++] ?? 0))).toBe("k7qa-3xm9");
  });
});
