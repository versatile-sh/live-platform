import { describe, expect, test } from "vitest";

import { parsePass, readInvite, readKept, withKept, withoutInvite } from "./guest-pass";

describe("readInvite", () => {
  test("reads whether the room is listed and a well-formed pass id, and ignores the rest", () => {
    expect(readInvite("?listed=0&pass=abcdefghijklmnopqrstuv")).toEqual({ listed: false, pass: "abcdefghijklmnopqrstuv" });
    expect(readInvite("?listed=1")).toEqual({ listed: true, pass: undefined });
    expect(readInvite("?listed=yes&pass=../x")).toEqual({ listed: undefined, pass: undefined });
    expect(readInvite("")).toEqual({ listed: undefined, pass: undefined });
  });
});

describe("withoutInvite", () => {
  test("drops only the invitation's keys", () => {
    expect(withoutInvite("?listed=0&pass=abc&utm=x")).toBe("?utm=x");
    expect(withoutInvite("?listed=1")).toBe("");
  });
});

describe("parsePass", () => {
  test("keeps a pass with a valid name and photo", () => {
    expect(parsePass({ name: " Ana ", face: "AQID", private: true, listed: false, slug: "x" })).toEqual({ name: "Ana", face: "AQID", private: true, listed: false });
  });

  test("refuses one the page could not use", () => {
    expect(parsePass({ name: "", face: "" })).toBeUndefined();
    expect(parsePass({ name: "Ana", face: "<img>" })).toBeUndefined();
    expect(parsePass({ name: "Ana", face: "A".repeat(13_004) })).toBeUndefined();
    expect(parsePass(null)).toBeUndefined();
  });
});

describe("kept passes", () => {
  const kept = { pass: "pass-for-bk-0000000", name: "Ana Souza", face: "/9j/4AAQ", private: false, listed: true };

  describe("when a room was kept", () => {
    test("reads it back for that room only", () => {
      const raw = withKept(null, "bk", kept);

      expect(readKept(raw, "bk")).toEqual(kept);
      expect(readKept(raw, "other")).toBeUndefined();
    });

    test("replaces the earlier entry of the same room", () => {
      const raw = withKept(withKept(null, "bk", kept), "bk", { ...kept, pass: "pass-renewed-000000" });

      expect(readKept(raw, "bk")?.pass).toBe("pass-renewed-000000");
      expect(JSON.parse(raw)).toHaveLength(1);
    });
  });

  describe("with more than eight rooms", () => {
    test("keeps the eight newest", () => {
      let raw: string | null = null;
      for (let i = 0; i < 10; i++) raw = withKept(raw, `room-${i}`, kept);

      expect(readKept(raw, "room-9")).toEqual(kept);
      expect(readKept(raw, "room-2")).toEqual(kept);
      expect(readKept(raw, "room-1")).toBeUndefined();
    });
  });

  describe("with a malformed list", () => {
    test("reads nothing and starts over", () => {
      expect(readKept("{not json", "bk")).toBeUndefined();
      expect(readKept(JSON.stringify([["bk", { face: "<script>" }]]), "bk")).toBeUndefined();
      expect(readKept(withKept("[1,2]", "bk", kept), "bk")).toEqual(kept);
    });

    test("drops a pass id or a name that is not one", () => {
      expect(readKept(JSON.stringify([["bk", { ...kept, pass: "x" }]]), "bk")?.pass).toBeUndefined();
      expect(readKept(JSON.stringify([["bk", { ...kept, name: " " }]]), "bk")?.name).toBe("");
    });
  });
});
