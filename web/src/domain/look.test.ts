import { describe, expect, test } from "vitest";

import { COLOURS, FACE_PRESETS, cleanFace, packLook, randomLook, unpackLook } from "./look";

describe("look", () => {
  test("packs and unpacks every colour and tilt to the same thing", () => {
    for (let colour = 0; colour < COLOURS; colour++) for (let turn = 0; turn < 5; turn++) expect(unpackLook(packLook({ colour, turn }))).toEqual({ colour, turn });
  });

  test.each([-1, 1.5, 5 << 7, 65535])("reads %s as the plain look", (packed) => {
    expect(unpackLook(packed)).toEqual({ colour: 0, turn: 2 });
  });

  test("a random look is upright and within range", () => {
    expect(unpackLook(randomLook(() => 0.999))).toEqual({ colour: 7, turn: 2 });
  });

  test("every preset face fits what the room accepts", () => {
    for (const face of FACE_PRESETS) expect(cleanFace(face)).toBe(face);
  });

  test("a typed face loses invisible characters and anything past twelve", () => {
    expect(cleanFace("  ^_^\u202e  ")).toBe("^_^");
    expect([...cleanFace("abcdefghijklmnop")]).toHaveLength(12);
  });
});
