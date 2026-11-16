import { describe, expect, test, vi } from "vitest";

import { compactCount, createProjectStore, loadStars } from "./project-store";

const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("project store", () => {
  test("asks once, on the first subscriber, and tells everyone when the count arrives", async () => {
    const load = vi.fn(async () => 1234);
    const store = createProjectStore(load);
    expect(load).not.toHaveBeenCalled();
    const heard = vi.fn();
    store.subscribe(heard);
    store.subscribe(() => undefined);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().stars).toBe(1234);
  });

  test("keeps the links and shows no count when the server has none", async () => {
    const store = createProjectStore(async () => undefined);
    store.subscribe(() => undefined);
    await Promise.resolve();
    expect(store.getSnapshot()).toEqual({ repo: "https://github.com/versatile-sh/call-platform", x: "https://x.com/versatile_sh" });
  });
});

describe("loadStars", () => {
  test.each([
    [{ stars: 42 }, true, 42],
    [{ stars: null }, true, undefined],
    [{ stars: -1 }, true, undefined],
    [{ stars: "42" }, true, undefined],
    [{ stars: 42 }, false, undefined],
  ])("reads %j (ok %s) as %s", async (body, ok, expected) => {
    expect(await loadStars(answer(body, ok))).toBe(expected);
  });

  test("is no count when the request fails", async () => {
    expect(await loadStars((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toBeUndefined();
  });
});

describe("compactCount", () => {
  test.each([
    [0, "0"],
    [947, "947"],
    [1000, "1k"],
    [1249, "1.2k"],
    [9960, "10k"],
    [38400, "38k"],
  ])("writes %i as %s", (count, text) => {
    expect(compactCount(count)).toBe(text);
  });
});
