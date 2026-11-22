import { describe, expect, test, vi } from "vitest";

import { createPathnameStore, resolveRoute, type PathnameHost, type Reloader } from "./pathname-store";

function fakeHost(initial = "/") {
  let popstate: (() => void) | undefined;
  const host: PathnameHost & { pushed: string[]; back(path: string): void } = {
    location: { pathname: initial },
    pushed: [],
    history: {
      pushState: (_s, _u, url) => {
        host.pushed.push(url);
        host.location.pathname = url;
      },
    },
    addEventListener: (_t, l) => void (popstate = l),
    removeEventListener: () => void (popstate = undefined),
    back(path) {
      host.location.pathname = path;
      popstate?.();
    },
  };
  return host;
}

describe("createPathnameStore", () => {
  test("reads the current pathname", () => {
    expect(createPathnameStore(fakeHost("/standup")).getSnapshot()).toBe("/standup");
  });

  test("navigate pushes the path and notifies subscribers", () => {
    const host = fakeHost();
    const store = createPathnameStore(host);
    const listener = vi.fn();
    store.subscribe(listener);
    store.navigate("/standup");
    expect(host.pushed).toEqual(["/standup"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe("/standup");
  });

  test("navigating to the current path does nothing", () => {
    const host = fakeHost("/standup");
    createPathnameStore(host).navigate("/standup");
    expect(host.pushed).toEqual([]);
  });

  test("notifies on the back button", () => {
    const host = fakeHost("/standup");
    const store = createPathnameStore(host);
    const listener = vi.fn();
    store.subscribe(listener);
    host.back("/");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("stops listening once the last subscriber leaves", () => {
    const host = fakeHost();
    const store = createPathnameStore(host);
    const listener = vi.fn();
    store.subscribe(listener)();
    host.back("/x");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createPathnameStore with a reloader", () => {
  function reloader(stale: boolean) {
    const loads: [string, boolean][] = [];
    const checks = vi.fn();
    const value: Reloader = { stale: () => stale, check: checks, load: (path, replace) => void loads.push([path, replace]) };
    return { value, loads, checks };
  }

  describe("when a newer client was published", () => {
    test("navigating loads the new page in full instead of moving inside this one", () => {
      const host = fakeHost("/standup");
      const { value, loads } = reloader(true);
      const store = createPathnameStore(host, value);
      const listener = vi.fn();
      store.subscribe(listener);
      store.navigate("/");
      expect(loads).toEqual([["/", false]]);
      expect(host.pushed).toEqual([]);
      expect(listener).not.toHaveBeenCalled();
    });

    test("the back button loads the page it lands on in full, in place", () => {
      const host = fakeHost("/");
      const { value, loads } = reloader(true);
      const store = createPathnameStore(host, value);
      const listener = vi.fn();
      store.subscribe(listener);
      host.back("/standup");
      expect(loads).toEqual([["/standup", true]]);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("when a newer client was published and only the hash changes", () => {
    test("stays on the running page, so a call in it goes on", () => {
      const host = fakeHost("/standup");
      const { value, loads } = reloader(true);
      const store = createPathnameStore(host, value);
      const listener = vi.fn();
      store.subscribe(listener);
      host.back("/standup");
      expect(loads).toEqual([]);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("while the client is current", () => {
    test("moves inside the page and asks again whether a newer one exists", () => {
      const host = fakeHost("/standup");
      const { value, loads, checks } = reloader(false);
      const store = createPathnameStore(host, value);
      store.subscribe(vi.fn());
      store.navigate("/");
      host.back("/standup");
      expect(loads).toEqual([]);
      expect(host.pushed).toEqual(["/"]);
      expect(checks).toHaveBeenCalledTimes(2);
    });
  });
});

describe("resolveRoute", () => {
  test.each([
    ["/", { kind: "home" }],
    ["/lobby", { kind: "lobby" }],
    ["/lobby/", { kind: "lobby" }],
    ["/privacy", { kind: "privacy" }],
    ["", { kind: "home" }],
    ["/standup", { kind: "room", slug: "standup" }],
    ["/standup/", { kind: "room", slug: "standup" }],
    ["/team-42", { kind: "room", slug: "team-42" }],
    ["/Standup", { kind: "invalid-room" }],
    ["/api", { kind: "invalid-room" }],
    ["/a", { kind: "invalid-room" }],
    ["/%E0%A4%A", { kind: "invalid-room" }],
    ["/a/b", { kind: "not-found" }],
  ] as const)("sends %j to %j", (pathname, route) => {
    expect(resolveRoute(pathname)).toEqual(route);
  });
});
