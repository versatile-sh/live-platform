import { describe, expect, test } from "vitest";

import { createRoomsApi, flagEmoji } from "./rooms";

const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("RoomsApi#status", () => {
  test("returns the room", async () => {
    const api = createRoomsApi(respond(200, { slug: "a1", exists: true, private: true, country: "BR", count: 2, capacity: 10 }));
    expect(await api.status("a1")).toEqual({ kind: "ok", room: { slug: "a1", exists: true, private: true, country: "BR", count: 2, capacity: 10 } });
  });

  test("reads a 400 as an invalid slug", async () => {
    expect(await createRoomsApi(respond(400, { error: "invalid slug" })).status("A")).toEqual({ kind: "invalid" });
  });

  test("reads a failure as unreachable", async () => {
    expect(await createRoomsApi(respond(500, {})).status("a1")).toEqual({ kind: "unreachable" });
    expect(await createRoomsApi((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch).status("a1")).toEqual({ kind: "unreachable" });
  });

  test("reads a malformed body as unreachable", async () => {
    expect(await createRoomsApi(respond(200, { slug: 4 })).status("a1")).toEqual({ kind: "unreachable" });
  });
});

describe("RoomsApi#lobby", () => {
  test("returns the listed rooms", async () => {
    const room = { slug: "a1", exists: true, private: false, count: 1, capacity: 10 };
    expect(await createRoomsApi(respond(200, { rooms: [room] })).lobby()).toEqual({ kind: "ok", rooms: [room] });
  });

  test("reads a body without rooms as unreachable", async () => {
    expect(await createRoomsApi(respond(200, {})).lobby()).toEqual({ kind: "unreachable" });
  });
});

describe("flagEmoji", () => {
  test("turns a country code into its flag", () => {
    expect(flagEmoji("BR")).toBe("\u{1F1E7}\u{1F1F7}");
  });

  test("returns nothing for what is not a code", () => {
    expect(flagEmoji("br")).toBe("");
    expect(flagEmoji("BRA")).toBe("");
  });
});
