import { checkSlug } from "../domain/slug";

/** The slice of `window` the store needs, so tests can hand it a fake. */
export type PathnameHost = {
  location: { pathname: string };
  history: { pushState(state: unknown, unused: string, url: string): void };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
};

export type PathnameStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): string;
  navigate(path: string): void;
};

/** The current pathname as an external store over the History API, for `useSyncExternalStore`. */
export function createPathnameStore(host: PathnameHost): PathnameStore {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener) {
      if (listeners.size === 0) host.addEventListener("popstate", notify);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) host.removeEventListener("popstate", notify);
      };
    },
    getSnapshot: () => host.location.pathname,
    navigate(path) {
      if (path === host.location.pathname) return;
      host.history.pushState(null, "", path);
      notify();
    },
  };
}

/** Where a pathname leads. */
export type Route = { kind: "home" } | { kind: "lobby" } | { kind: "privacy" } | { kind: "room"; slug: string } | { kind: "invalid-room" } | { kind: "not-found" };

/** Maps a pathname to the page it shows: `/` is the home, `/lobby` the open rooms, `/privacy` the privacy policy, and any other single valid segment a room. */
export function resolveRoute(pathname: string): Route {
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed === "") return { kind: "home" };
  if (trimmed === "/lobby") return { kind: "lobby" };
  if (trimmed === "/privacy") return { kind: "privacy" };
  const segments = trimmed.split("/").slice(1);
  if (segments.length !== 1 || !segments[0]) return { kind: "not-found" };
  let segment: string;
  try {
    segment = decodeURIComponent(segments[0]);
  } catch {
    return { kind: "invalid-room" };
  }
  const check = checkSlug(segment);
  return check.ok ? { kind: "room", slug: check.slug } : { kind: "invalid-room" };
}
