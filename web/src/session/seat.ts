/** Where a participant's place is kept so a reload can resume it: only for this tab, only until it closes. */
export type SeatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What is needed to resume a place, plus what the page learned about the room. */
export type Seat = { pid: number; secret: string; private: boolean; listed?: boolean };

const PREFIX = "live.seat.";

/** Reads the stored seat of `slug`, or undefined when there is none or it is malformed. */
export function readSeat(storage: SeatStorage, slug: string): Seat | undefined {
  const raw = storage.getItem(PREFIX + slug);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const { pid, secret, private: isPrivate, listed } = value as Record<string, unknown>;
    if (typeof pid !== "number" || typeof secret !== "string" || typeof isPrivate !== "boolean") return undefined;
    return typeof listed === "boolean" ? { pid, secret, private: isPrivate, listed } : { pid, secret, private: isPrivate };
  } catch {
    return undefined;
  }
}

/** Replaces the stored seat of `slug`. */
export function writeSeat(storage: SeatStorage, slug: string, seat: Seat): void {
  try {
    storage.setItem(PREFIX + slug, JSON.stringify(seat));
  } catch {
    return;
  }
}

/** Forgets the stored seat of `slug`. */
export function clearSeat(storage: SeatStorage, slug: string): void {
  try {
    storage.removeItem(PREFIX + slug);
  } catch {
    return;
  }
}
