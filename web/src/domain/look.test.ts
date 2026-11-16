import { describe, expect, test } from "vitest";

import { FACE_PRESETS, cleanFace, formatLook, parseLook, randomLook } from "./look";

describe("look", () => {
  test("reads and writes the form the server carries", () => {
    expect(parseLook("ff9ec7-0e1116-45")).toEqual({ bg: "ff9ec7", fg: "0e1116", turn: 45 });
    expect(formatLook({ bg: "ff9ec7", fg: "0e1116", turn: 45 })).toBe("ff9ec7-0e1116-45");
  });

  test("a turn goes all the way round and wraps", () => {
    expect(formatLook({ bg: "ffffff", fg: "000000", turn: 375 })).toBe("ffffff-000000-15");
    expect(formatLook({ bg: "ffffff", fg: "000000", turn: -15 })).toBe("ffffff-000000-345");
  });

  test.each([undefined, "", "red-blue-0", "ffffff-000000-360", "FFFFFF-000000-0"])("reads %s as the plain look", (text) => {
    expect(parseLook(text)).toEqual({ bg: "c6f432", fg: "0e1116", turn: 0 });
  });

  test("a random look is upright and well formed", () => {
    expect(randomLook(() => 0)).toBe("c6f432-0e1116-0");
    expect(parseLook(randomLook(() => 0.99)).turn).toBe(0);
  });

  test("every preset face fits what the room accepts", () => {
    for (const face of FACE_PRESETS) expect(cleanFace(face)).toBe(face);
  });

  test("a typed face loses invisible characters and anything past twelve", () => {
    expect(cleanFace("  ^_^\u202e  ")).toBe("^_^");
    expect([...cleanFace("abcdefghijklmnop")]).toHaveLength(12);
  });
});
