import { describe, expect, test } from "vitest";

import { COLOURS, FACES, packLook, randomLook, unpackLook } from "./look";

describe("look", () => {
  test("packs and unpacks every face, colour and tilt to the same thing", () => {
    for (let face = 0; face < FACES.length; face++) for (let colour = 0; colour < COLOURS; colour++) for (let turn = 0; turn < 5; turn++) expect(unpackLook(packLook({ face, colour, turn }))).toEqual({ face, colour, turn });
  });

  test.each([undefined, -1, 1.5, 5 << 7, 65535])("reads %s as the plain look", (packed) => {
    expect(unpackLook(packed as number | undefined)).toEqual(packed === undefined ? { face: 0, colour: 0, turn: 0 } : { face: 0, colour: 0, turn: 2 });
  });

  test("a random look is upright and within range", () => {
    expect(unpackLook(randomLook(() => 0.999))).toEqual({ face: 15, colour: 7, turn: 2 });
    expect(unpackLook(randomLook(() => 0))).toEqual({ face: 0, colour: 0, turn: 2 });
  });
});
