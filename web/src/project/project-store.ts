/** Where the project lives in public, and how many people starred it; the count is zero until the server knows better. */
export type Project = { repo: string; x: string; stars: number };

export type ProjectStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Project;
};

/** The addresses the page links to when the server says nothing else. */
export const PROJECT_LINKS: Project = { repo: "https://github.com/versatile-sh/live-platform", x: "https://x.com/versatile_sh", stars: 0 };

/** Where the community gathers: the Discord server and the page that adds the Live Versatile bot to one. */
export const COMMUNITY_LINKS = { discord: "https://discord.gg/h92jrzRK2H", bot: "https://live.versatile.sh/bot/install" } as const;

/** The star count, asked of our own server once, the first time something on the page shows it. */
export function createProjectStore(load: () => Promise<number | undefined>): ProjectStore {
  const listeners = new Set<() => void>();
  let project = PROJECT_LINKS;
  let asked = false;
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!asked) {
        asked = true;
        void load().then((stars) => {
          if (stars === undefined) return;
          project = { ...project, stars };
          listeners.forEach((notify) => notify());
        });
      }
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => project,
  };
}

/** Reads the star count from `/api/project`; any failure is simply no count. */
export async function loadStars(fetcher: typeof fetch = (...args) => fetch(...args)): Promise<number | undefined> {
  try {
    const response = await fetcher("/api/project", { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { stars?: unknown };
    return typeof body.stars === "number" && Number.isInteger(body.stars) && body.stars >= 0 ? body.stars : undefined;
  } catch {
    return undefined;
  }
}

/** A count as people write it: 947, 1.2k, 38k. */
export function compactCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
}
