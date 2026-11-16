import { describe, expect, test } from "vitest";

import { DICTIONARIES, createTranslate, detectLocale } from "./index";
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

describe("detectLocale", () => {
  test.each([
    [["pt-BR", "en"], "pt-BR"],
    [["pt-PT"], "pt-BR"],
    [["en-US", "pt-BR"], "en"],
    [["fr-FR", "pt"], "pt-BR"],
    [["fr", "de"], "en"],
    [[], "en"],
  ] as const)("reads %j as %s", (languages, locale) => {
    expect(detectLocale(languages)).toBe(locale);
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
