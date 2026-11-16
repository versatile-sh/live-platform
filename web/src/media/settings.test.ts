import { describe, expect, test } from "vitest";

import { DEFAULT_SETTINGS, cameraShape, parseSettings, screenShape } from "./settings";

describe("parseSettings", () => {
  test.each([null, undefined, "", "not json", "[]", "7"])("answers the defaults for %j", (text) => {
    expect(parseSettings(text)).toEqual(DEFAULT_SETTINGS);
  });

  test("keeps what is valid and replaces what is out of range or of another shape", () => {
    const read = parseSettings(JSON.stringify({ strength: 250, gateDb: -500, echo: "no", balanced: true, talkKey: "F13", screenQuality: "1440p60", cameraQuality: 720, extra: 1 }));
    expect(read).toEqual({ ...DEFAULT_SETTINGS, strength: 100, gateDb: -80, balanced: true, screenQuality: "1440p60" });
  });

  test("survives a round trip", () => {
    const mine = { ...DEFAULT_SETTINGS, strength: 60, gate: true, gateDb: -42, pushToTalk: true, talkKey: "AltLeft" as const, sounds: false, cameraQuality: "1080" as const };
    expect(parseSettings(JSON.stringify(mine))).toEqual(mine);
  });
});

describe("shapes", () => {
  test("a better quality is larger and may send more", () => {
    expect(cameraShape("1080").bitrate).toBeGreaterThan(cameraShape("360").bitrate);
    expect(screenShape("1440p60")).toMatchObject({ width: 2560, height: 1440, frameRate: 60 });
    expect(screenShape("1440p60").bitrate).toBeGreaterThan(screenShape("720p30").bitrate);
  });
});
