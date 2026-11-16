import { describe, expect, test } from "vitest";

import { checkName } from "./name";

describe("checkName", () => {
  test("trims a valid name", () => {
    expect(checkName("  Ana Paula ")).toEqual({ ok: true, name: "Ana Paula" });
  });

  test("refuses a blank name", () => {
    expect(checkName("   ")).toEqual({ ok: false, problem: "empty" });
  });

  test("counts characters, not bytes, against the limit", () => {
    expect(checkName("é".repeat(40)).ok).toBe(true);
    expect(checkName("é".repeat(41))).toEqual({ ok: false, problem: "length" });
  });

  test("refuses invisible characters", () => {
    expect(checkName("Ana​Paula")).toEqual({ ok: false, problem: "invisible" });
  });
});
