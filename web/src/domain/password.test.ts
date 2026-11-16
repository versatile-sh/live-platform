import { describe, expect, test } from "vitest";

import { assessPassword, canonicalPassword, derive, generatePassword, toBase64Url } from "./password";

function scripted(values: number[]) {
  let i = 0;
  return (bytes: Uint8Array) => {
    bytes[0] = values[i++ % values.length] ?? 0;
  };
}

describe("generatePassword", () => {
  test("returns a room code of two groups of four, capitals and digits with no look-alikes", () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePassword()).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    }
  });

  test("always holds a letter and a digit", () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword();
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  test("maps a byte to its alphabet character modulo the alphabet size", () => {
    expect(generatePassword(scripted([8, 0, 1, 2, 3, 4, 5, 32 + 6]))).toBe("A234-5678");
  });

  test("draws again when a code has only letters or only digits", () => {
    expect(generatePassword(scripted([0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 1, 2, 3, 4, 5, 6]))).toBe("A234-5678");
  });

  test("is accepted by the rule a typed password must meet", () => {
    expect(assessPassword(generatePassword()).rating).toBe("ok");
  });
});

describe("canonicalPassword", () => {
  test.each([
    ["8abh-23hk", "8ABH-23HK"],
    [" 8ABH-23HK ", "8ABH-23HK"],
    ["Kq7mR2xP", "Kq7mR2xP"],
    ["my-own-password", "my-own-password"],
    ["8abh-23h", "8abh-23h"],
  ])("reads %j as %j", (typed, canonical) => {
    expect(canonicalPassword(typed)).toBe(canonical);
  });

  test("gives a code typed in lower case the same verifier", async () => {
    const [typed, drawn] = await Promise.all([derive("8abh-23hk", "demo"), derive("8ABH-23HK", "demo")]);
    expect(typed.verifier).toBe(drawn.verifier);
  });
});

describe("assessPassword", () => {
  test.each([
    ["short1", "invalid", "short"],
    ["abcdefghij", "invalid", "needs-digit"],
    ["1234567890", "invalid", "needs-letter"],
  ] as const)("refuses %s as %s", (password, rating, problem) => {
    expect(assessPassword(password)).toEqual({ rating, problem });
  });

  test.each(["password1", "aaaaaaa1", "abcd1234", "qwerty12"])("warns that %s is weak", (password) => {
    expect(assessPassword(password)).toEqual({ rating: "weak" });
  });

  test("accepts a generated-style password without a warning", () => {
    expect(assessPassword("Kq7mR2xP")).toEqual({ rating: "ok" });
  });
});

describe("derive", () => {
  test("returns the pinned verifier and media key for a fixed password and slug", async () => {
    const derived = await derive("Kq7mR2xP", "demo-room");
    expect(derived.verifier).toBe("EP8WfAAaZlx1wfbQcwGRM3LAJp7aAVrNrMMhS_N9J8s");
    expect(Buffer.from(derived.mediaKey).toString("hex")).toBe("acd4ea8804dd63d8aba4fc0ca94b04f750966712d9ef255f32c2232bbacfeb70");
  });

  test("salts with the slug so the same password differs between rooms", async () => {
    const [a, b] = await Promise.all([derive("Kq7mR2xP", "room-a"), derive("Kq7mR2xP", "room-b")]);
    expect(a.verifier).not.toBe(b.verifier);
  });

  test("yields a 43 character verifier and a 32 byte media key", async () => {
    const derived = await derive("Kq7mR2xP", "demo-room");
    expect(derived.verifier).toHaveLength(43);
    expect(derived.mediaKey).toHaveLength(32);
  });
});

describe("toBase64Url", () => {
  test("uses the url alphabet without padding", () => {
    expect(toBase64Url(new Uint8Array([251, 255, 254]))).toBe("-__-");
    expect(toBase64Url(new Uint8Array([1]))).toBe("AQ");
  });
});
