import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { LobbyResult } from "../api/rooms";
import { createLobbyStore, type Visibility } from "./lobby-store";

const room = (slug: string) => ({ slug, exists: true, private: false, count: 1, capacity: 10 });

function setup(results: LobbyResult[]) {
  let visible = true;
  let onChange: (() => void) | undefined;
  const visibility: Visibility = {
    isVisible: () => visible,
    subscribe: (l) => {
      onChange = l;
      return () => void (onChange = undefined);
    },
  };
  const load = vi.fn(async () => results.shift() ?? ({ kind: "unreachable" } as const));
  const store = createLobbyStore({ load, visibility, intervalMs: 5000 });
  return {
    store,
    load,
    hide() {
      visible = false;
      onChange?.();
    },
    show() {
      visible = true;
      onChange?.();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createLobbyStore", () => {
  test("starts loading and shows the rooms once they arrive", async () => {
    const { store } = setup([{ kind: "ok", rooms: [room("a")] }]);
    store.subscribe(() => {});
    expect(store.getSnapshot()).toEqual({ status: "loading" });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toEqual({ status: "ready", rooms: [room("a")] });
  });

  test("refreshes every interval while subscribed", async () => {
    const { store, load } = setup([{ kind: "ok", rooms: [] }, { kind: "ok", rooms: [room("b")] }]);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual({ status: "ready", rooms: [room("b")] });
  });

  test("keeps the last list when a refresh fails", async () => {
    const { store } = setup([{ kind: "ok", rooms: [room("a")] }, { kind: "unreachable" }]);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getSnapshot()).toEqual({ status: "failed", rooms: [room("a")] });
  });

  test("stops polling while the tab is hidden and refreshes at once when it returns", async () => {
    const { store, load, hide, show } = setup([{ kind: "ok", rooms: [] }, { kind: "ok", rooms: [] }]);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    hide();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    show();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("stops polling when the last subscriber leaves", async () => {
    const { store, load } = setup([{ kind: "ok", rooms: [] }]);
    const unsubscribe = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
