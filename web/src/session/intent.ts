import type { JoinEntry } from "./session";

/** What the home form decided for a room, held in memory until the room page picks it up. */
export type EntryIntent = {
  put(slug: string, entry: JoinEntry): void;
  read(slug: string): JoinEntry | undefined;
  clear(slug: string): void;
};

/** An intent store that forgets on reload: a password in it never reaches storage. */
export function createEntryIntent(): EntryIntent {
  const pending = new Map<string, JoinEntry>();
  return {
    put: (slug, entry) => void pending.set(slug, entry),
    read: (slug) => pending.get(slug),
    clear: (slug) => void pending.delete(slug),
  };
}
