import type { LobbyResult, RoomSummary } from "../api/rooms";

export type LobbyState = { status: "loading" } | { status: "ready"; rooms: RoomSummary[] } | { status: "failed"; rooms: RoomSummary[] };

/** Whether the tab is visible and a way to hear when that changes. */
export type Visibility = { isVisible(): boolean; subscribe(listener: () => void): () => void };

export type LobbyStore = { subscribe(listener: () => void): () => void; getSnapshot(): LobbyState };

export type LobbyStoreOptions = {
  load: (signal: AbortSignal) => Promise<LobbyResult>;
  visibility: Visibility;
  intervalMs?: number;
};

/** The platform's page visibility. */
export function documentVisibility(): Visibility {
  return {
    isVisible: () => document.visibilityState === "visible",
    subscribe(listener) {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

/**
 * The listed rooms as an external store. It polls only while someone is subscribed and the tab is visible,
 * fetches at once when the tab returns, and keeps the last list on screen while a refresh fails.
 */
export function createLobbyStore({ load, visibility, intervalMs = 5000 }: LobbyStoreOptions): LobbyStore {
  const listeners = new Set<() => void>();
  let state: LobbyState = { status: "loading" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let stopWatching: (() => void) | undefined;

  function set(next: LobbyState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function stop() {
    clearTimeout(timer);
    controller?.abort();
    timer = controller = undefined;
  }

  async function refresh() {
    stop();
    if (!visibility.isVisible()) return;
    const mine = new AbortController();
    controller = mine;
    const result = await load(mine.signal);
    if (mine.signal.aborted) return;
    const known = state.status === "loading" ? [] : state.rooms;
    set(result.kind === "ok" ? { status: "ready", rooms: result.rooms } : { status: "failed", rooms: known });
    timer = setTimeout(() => void refresh(), intervalMs);
  }

  return {
    subscribe(listener) {
      if (listeners.size === 0) {
        stopWatching = visibility.subscribe(() => void refresh());
        void refresh();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopWatching?.();
          stop();
        }
      };
    },
    getSnapshot: () => state,
  };
}
