const BUNDLE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

/** The entry bundle a page names, such as `/assets/index-L9dTNq8_.js`, or nothing when it names none (the development server). */
export function bundleIn(html: string): string | undefined {
  return BUNDLE.exec(html)?.[0];
}

/** Whether a newer client was published since this page loaded, learned by asking the server which bundle its page names now. */
export type Freshness = { stale(): boolean; check(): void };

type FreshnessOptions = { current: string | undefined; latest: () => Promise<string | undefined>; now: () => number; every?: number };

/** Compares the running bundle with the server's at most once per `every` milliseconds; without a running bundle it never reports one stale. */
export function createFreshness({ current, latest, now, every = 60_000 }: FreshnessOptions): Freshness {
  let stale = false;
  let asking = false;
  let last = -Infinity;
  return {
    stale: () => stale,
    check() {
      if (current === undefined || stale || asking || now() - last < every) return;
      asking = true;
      last = now();
      latest()
        .then((found) => {
          if (found !== undefined && found !== current) stale = true;
        })
        .catch(() => undefined)
        .finally(() => {
          asking = false;
        });
    },
  };
}
