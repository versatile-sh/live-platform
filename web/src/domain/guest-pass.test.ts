import { describe, expect, test } from "vitest";

import { parsePass, readInvite, withoutInvite } from "./guest-pass";

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
