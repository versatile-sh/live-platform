import { describe, expect, test } from "vitest";

import { EMOJI, linkify } from "./links";

describe("linkify", () => {
  test("turns a web address into a link and leaves the words around it", () => {
    expect(linkify("entra em https://live.versatile.sh/meet agora")).toEqual([{ text: "entra em " }, { text: "https://live.versatile.sh/meet", href: "https://live.versatile.sh/meet" }, { text: " agora" }]);
  });

  test("keeps the full stop of the sentence out of the address", () => {
    expect(linkify("see https://example.com/a.")).toEqual([{ text: "see " }, { text: "https://example.com/a", href: "https://example.com/a" }, { text: "." }]);
  });

  test.each(["javascript:alert(1)", "data:text/html,<b>", "ftp://x.y/z", "www.example.com", "just words"])("makes no link of %s", (text) => {
    expect(linkify(text)).toEqual([{ text }]);
  });

  test("an address alone is one link", () => {
    expect(linkify("https://live.versatile.sh/")).toEqual([{ text: "https://live.versatile.sh/", href: "https://live.versatile.sh/" }]);
  });
});

describe("EMOJI", () => {
  test("every one is free of the invisible joiners the room refuses", () => {
    for (const emoji of EMOJI) expect(/\p{Cf}/u.test(emoji)).toBe(false);
  });
});
