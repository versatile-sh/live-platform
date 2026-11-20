import { describe, expect, test } from "vitest";

import { DICTIONARIES, chosenLocale, createTranslate } from "./index";
import { en } from "./en";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  test("have the same keys in both languages", () => {
    expect(Object.keys(DICTIONARIES["pt-BR"]).sort()).toEqual(Object.keys(en).sort());
  });

  test("use the same placeholders for every key in both languages", () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(DICTIONARIES["pt-BR"][key]), key).toEqual(placeholders(en[key]));
    }
  });

  test("have no empty message", () => {
    for (const locale of ["en", "pt-BR"] as const) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale])) expect(value.trim(), `${locale} ${key}`).not.toBe("");
    }
  });

  test("keep Portuguese accents", () => {
    expect(DICTIONARIES["pt-BR"]["entry.joinFull"]).toContain("lotada");
    expect(DICTIONARIES["pt-BR"]["ended.expired.title"]).toBe("Seu lugar foi liberado");
    expect(DICTIONARIES["pt-BR"]["lobby.error"]).toContain("Não");
  });
});

describe("chosenLocale", () => {
  test.each([
    [null, "en"],
    [undefined, "en"],
    ["", "en"],
    ["en", "en"],
    ["pt-BR", "pt-BR"],
    ["fr", "en"],
  ] as const)("reads a saved %j as %s", (saved, locale) => {
    expect(chosenLocale(saved)).toBe(locale);
  });

  test("without a saved choice, follows the browser: Portuguese for pt, English for the rest", () => {
    expect(chosenLocale(null, ["pt-BR", "en"])).toBe("pt-BR");
    expect(chosenLocale(null, ["pt"])).toBe("pt-BR");
    expect(chosenLocale(null, ["en-US", "pt-BR"])).toBe("en");
  });

  test("a saved choice wins over the browser, so English chosen once stays English", () => {
    expect(chosenLocale("en", ["pt-BR"])).toBe("en");
    expect(chosenLocale("pt-BR", ["en-US"])).toBe("pt-BR");
  });
});

describe("createTranslate", () => {
  test("fills placeholders", () => {
    expect(createTranslate("en")("lobby.roomPeople", { count: 3, capacity: 10 })).toBe("3/10 people");
  });

  test("leaves an unknown placeholder visible", () => {
    expect(createTranslate("en")("lobby.roomPeople", { count: 3 })).toBe("3/{capacity} people");
  });
});
