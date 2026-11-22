import { describe, expect, test, vi } from "vitest";

import { bundleIn, createFreshness } from "./freshness";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("bundleIn", () => {
  test("finds the entry bundle a page names", () => {
    expect(bundleIn('<script type="module" crossorigin src="/assets/index-L9dTNq8_.js"></script>')).toBe("/assets/index-L9dTNq8_.js");
    expect(bundleIn("https://live.test/assets/index-DOJbCqQS.js")).toBe("/assets/index-DOJbCqQS.js");
  });

  test("finds nothing on the development server's page", () => {
    expect(bundleIn('<script type="module" src="/src/main.tsx"></script>')).toBeUndefined();
  });
});

describe("createFreshness", () => {
  describe("when the server names another bundle", () => {
    test("reports the running client stale", async () => {
      const freshness = createFreshness({ current: "/assets/index-old.js", latest: async () => "/assets/index-new.js", now: () => 0 });
      freshness.check();
      await flush();
      expect(freshness.stale()).toBe(true);
    });
  });

  describe("when the server names the same bundle, or cannot be asked", () => {
    test("keeps the running client", async () => {
      const same = createFreshness({ current: "/assets/index-a.js", latest: async () => "/assets/index-a.js", now: () => 0 });
      const offline = createFreshness({ current: "/assets/index-a.js", latest: async () => Promise.reject(new Error("offline")), now: () => 0 });
      same.check();
      offline.check();
      await flush();
      expect(same.stale()).toBe(false);
      expect(offline.stale()).toBe(false);
    });
  });

  describe("without a running bundle", () => {
    test("never asks", () => {
      const latest = vi.fn(async () => "/assets/index-new.js");
      createFreshness({ current: undefined, latest, now: () => 0 }).check();
      expect(latest).not.toHaveBeenCalled();
    });
  });

  test("asks at most once a minute", async () => {
    let now = 0;
    const latest = vi.fn(async () => "/assets/index-a.js");
    const freshness = createFreshness({ current: "/assets/index-a.js", latest, now: () => now });
    freshness.check();
    await flush();
    now = 59_999;
    freshness.check();
    expect(latest).toHaveBeenCalledTimes(1);
    now = 60_000;
    freshness.check();
    expect(latest).toHaveBeenCalledTimes(2);
  });
});
