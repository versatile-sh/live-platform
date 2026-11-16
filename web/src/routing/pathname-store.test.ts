import { describe, expect, test, vi } from "vitest";

import { createPathnameStore, resolveRoute, type PathnameHost } from "./pathname-store";

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

describe("resolveRoute", () => {
  test.each([
    ["/", { kind: "lobby" }],
    ["", { kind: "lobby" }],
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
