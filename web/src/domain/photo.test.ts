import { describe, expect, test } from "vitest";

import { photoAddress, sniffPhoto, toBase64 } from "./photo";

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("sniffPhoto", () => {
  test("tells a JPEG and a GIF from their first bytes", () => {
    expect(sniffPhoto(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffPhoto(bytes("GIF89a...."))).toBe("gif");
    expect(sniffPhoto(bytes("GIF87a...."))).toBe("gif");
  });

  test.each(["<svg onload=alert(1)>", "GIF90a", "\x89PNG\r\n", "", "<!doctype html>"])("does not take %j for a picture it sends as is", (text) => {
    expect(sniffPhoto(bytes(text))).toBeUndefined();
  });
});

describe("photoAddress", () => {
  test("names the kind from the bytes it carries", () => {
    expect(photoAddress(toBase64(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 0xff, 0xd9)))).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    expect(photoAddress(toBase64(bytes("GIF89a\x01\x00\x01\x00")))).toMatch(/^data:image\/gif;base64,R0lGODlh/);
  });

  test.each([toBase64(bytes("<svg onload=alert(1)>")), toBase64(bytes("<html>")), "not base64 !", "", `/9j/"onerror="x`])("shows nothing for %j", (data) => {
    expect(photoAddress(data)).toBeUndefined();
  });
});
