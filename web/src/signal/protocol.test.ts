import { describe, expect, test } from "vitest";

import { closeMeaning, encodeClientFrame, parseServerFrame } from "./protocol";

describe("parseServerFrame", () => {
  test("reads a joined frame", () => {
    expect(parseServerFrame('{"t":"joined","pid":3,"gen":1,"secret":"abc"}')).toEqual({ t: "joined", pid: 3, gen: 1, secret: "abc" });
  });

  test("reads a roster with people and departures", () => {
    const text = JSON.stringify({ t: "roster", v: 4, people: [{ pid: 1, slot: 0, name: "Ana", state: "connecting", flags: 32 }], gone: [{ pid: 2, reason: "media-timeout" }] });
    expect(parseServerFrame(text)).toEqual({
      t: "roster",
      v: 4,
      people: [{ pid: 1, slot: 0, name: "Ana", state: "connecting", flags: 32 }],
      gone: [{ pid: 2, reason: "media-timeout" }],
    });
  });

  test("treats an absent gone list as empty", () => {
    expect(parseServerFrame('{"t":"roster","v":1,"people":[]}')).toEqual({ t: "roster", v: 1, people: [], gone: [] });
  });

  test("keeps an unknown departure reason as unknown", () => {
    const frame = parseServerFrame('{"t":"roster","v":1,"people":[],"gone":[{"pid":2,"reason":"abducted"}]}');
    expect(frame).toMatchObject({ gone: [{ pid: 2, reason: "unknown" }] });
  });

  test("maps an unknown error code to INTERNAL", () => {
    expect(parseServerFrame('{"t":"error","code":"BOOM","message":"x"}')).toEqual({ t: "error", code: "INTERNAL", message: "x" });
  });

  test.each(["not json", "[]", '{"t":"roster","v":"1","people":[]}', '{"t":"roster","v":1,"people":[{"pid":1}]}', '{"t":"nope"}', '{"t":"joined"}'])("returns undefined for %s", (text) => {
    expect(parseServerFrame(text)).toBeUndefined();
  });
});

describe("encodeClientFrame", () => {
  test("serialises an owner frame flat", () => {
    expect(JSON.parse(encodeClientFrame({ t: "owner", op: "transfer", pid: 7 }))).toEqual({ t: "owner", op: "transfer", pid: 7 });
  });
});

describe("closeMeaning", () => {
  test.each([
    [1000, "left"],
    [4001, "superseded"],
    [4400, "refused"],
    [4401, "no-hello"],
    [4403, "removed"],
    [4408, "silent"],
    [4409, "slow"],
    [4429, "flood"],
    [1006, "abnormal"],
  ] as const)("reads %i as %s", (code, kind) => {
    expect(closeMeaning(code).kind).toBe(kind);
  });
});
