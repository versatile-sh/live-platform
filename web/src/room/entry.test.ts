import { describe, expect, test } from "vitest";

import { checkEntry, entryIsPrivate, isWeakChoice, type EntryValues } from "./entry";

const create = (over: Partial<Extract<EntryValues, { kind: "create" }>> = {}): EntryValues => ({ kind: "create", name: "Ana", access: "public", listed: false, password: "Kq7mR2xP", ...over });
const join = (over: Partial<Extract<EntryValues, { kind: "join" }>> = {}): EntryValues => ({ kind: "join", name: "Ana", roomIsPrivate: false, password: "", ...over });

describe("checkEntry", () => {
  describe("when creating a public room", () => {
    test("accepts a name and carries the lobby choice but no password", () => {
      expect(checkEntry(create({ listed: true }))).toEqual({ ok: true, name: "Ana", private: false, password: undefined, listed: true });
    });

    test("ignores whatever sits in the password field", () => {
      expect(checkEntry(create({ password: "x" })).ok).toBe(true);
    });

    test("refuses a blank name", () => {
      expect(checkEntry(create({ name: "  " }))).toEqual({ ok: false, problems: { name: "empty" } });
    });
  });

  describe("when creating a private room", () => {
    test("accepts the generated password and never lists the room", () => {
      expect(checkEntry(create({ access: "private", listed: true }))).toEqual({ ok: true, name: "Ana", private: true, password: "Kq7mR2xP", listed: undefined });
    });

    test.each([
      ["short1", "short"],
      ["abcdefghij", "needs-digit"],
      ["1234567890", "needs-letter"],
    ] as const)("refuses the typed password %s as %s", (password, problem) => {
      expect(checkEntry(create({ access: "private", password }))).toEqual({ ok: false, problems: { password: problem } });
    });

    test("accepts a weak password but flags it", () => {
      const values = create({ access: "private", password: "abcd1234" });
      expect(checkEntry(values).ok).toBe(true);
      expect(isWeakChoice(values)).toBe(true);
    });
  });

  describe("when joining a private room", () => {
    test("asks for the password", () => {
      expect(checkEntry(join({ roomIsPrivate: true }))).toEqual({ ok: false, problems: { password: "required" } });
    });

    test("sends the typed password without judging its strength", () => {
      expect(checkEntry(join({ roomIsPrivate: true, password: "abc" }))).toMatchObject({ ok: true, private: true, password: "abc" });
    });
  });

  describe("when joining a public room", () => {
    test("needs only a name", () => {
      expect(checkEntry(join())).toEqual({ ok: true, name: "Ana", private: false, password: undefined, listed: undefined });
    });
  });

  test("reports name and password problems together", () => {
    expect(checkEntry(create({ name: "", access: "private", password: "x" }))).toEqual({ ok: false, problems: { name: "empty", password: "short" } });
  });
});

describe("entryIsPrivate", () => {
  test("follows the choice when creating and the room when joining", () => {
    expect(entryIsPrivate(create({ access: "private" }))).toBe(true);
    expect(entryIsPrivate(join({ roomIsPrivate: true }))).toBe(true);
    expect(entryIsPrivate(join())).toBe(false);
  });
});
