import { describe, expect, test } from "vitest";

import { roomFromLink, shareLink } from "./share-link";

describe("roomFromLink", () => {
  test.each([
    ["standup", "standup"],
    ["  Stand-Up ", "stand-up"],
    ["https://live.versatile.sh/standup", "standup"],
    ["live.versatile.sh/standup/", "standup"],
    ["https://live.versatile.sh/standup?from=chat", "standup"],
  ])("reads %j as the room %s", (text, slug) => {
    expect(roomFromLink(text)).toEqual({ slug: { ok: true, slug }, password: "" });
  });

  test("keeps the room code a shared link carries", () => {
    expect(roomFromLink(shareLink("https://live.versatile.sh", "secret", "8ABH-23HK"))).toEqual({ slug: { ok: true, slug: "secret" }, password: "8ABH-23HK" });
  });

  test.each([
    ["", "empty"],
    ["https://live.versatile.sh/", "characters"],
    ["live.versatile.sh/lobby", "reserved"],
    ["a b", "characters"],
  ] as const)("refuses %j as %s", (text, problem) => {
    expect(roomFromLink(text).slug).toEqual({ ok: false, problem });
  });
});
