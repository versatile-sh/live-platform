/** The part of a whiteboard element the sync reads; the rest travels untouched. */
export type BoardElement = { id: string; version: number; versionNonce: number; [key: string]: unknown };

/** What travels between browsers: elements that changed, or a request for the whole board from someone who just arrived. */
export type BoardMessage = { k: "els"; els: BoardElement[] } | { k: "hello" };

export type BoardSync = {
  subscribe(listener: () => void): () => void;
  /** Every element known, deleted ones included; a new array each time something changed. */
  getSnapshot(): readonly BoardElement[];
  /** Takes the scene as the local editor has it and sends what changed to the room. */
  local(elements: readonly BoardElement[]): void;
  /** Takes a message from another participant; `others` are the pids in the room besides mine. */
  remote(from: number, message: unknown, me: number, others: readonly number[]): void;
  /** Asks the room for the board, once per connection. */
  hello(): void;
  stop(): void;
};

const CHUNK_BYTES = 36_000;
const GAP_MS = 150;

function isElement(value: unknown): value is BoardElement {
  const el = value as BoardElement | null;
  return typeof el === "object" && el !== null && typeof el.id === "string" && typeof el.version === "number" && typeof el.versionNonce === "number";
}

/** Whether `next` replaces `kept`: the higher version wins, and on a tie the lower nonce, so every browser settles on the same element. */
export function wins(next: BoardElement, kept: BoardElement | undefined): boolean {
  return !kept || next.version > kept.version || (next.version === kept.version && next.versionNonce < kept.versionNonce);
}

/** Splits elements into groups that each fit one frame. */
export function chunk(elements: readonly BoardElement[], limit = CHUNK_BYTES): BoardElement[][] {
  const groups: BoardElement[][] = [];
  let size = 0;
  for (const element of elements) {
    const bytes = JSON.stringify(element).length * 2;
    if (bytes > limit) continue;
    if (groups.length === 0 || size + bytes > limit) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1)!.push(element);
    size += bytes;
  }
  return groups;
}

/** Keeps one whiteboard the same in every browser of the room: last version of each element wins, changes go out in paced frames, and whoever arrives is given the board by the participant with the lowest pid. */
export function createBoardSync(send: (message: BoardMessage, to?: number) => boolean, timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void } = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as number) }): BoardSync {
  const known = new Map<string, BoardElement>();
  const listeners = new Set<() => void>();
  const queue: Array<{ els: BoardElement[]; to?: number }> = [];
  let snapshot: readonly BoardElement[] = [];
  let timer: unknown;

  function publish() {
    snapshot = [...known.values()];
    listeners.forEach((listener) => listener());
  }

  function drain() {
    timer = undefined;
    const next = queue[0];
    if (!next) return;
    if (send({ k: "els", els: next.els }, next.to)) queue.shift();
    if (queue.length > 0) timer = timers.set(drain, GAP_MS);
  }

  function post(elements: readonly BoardElement[], to?: number) {
    for (const els of chunk(elements)) queue.push({ els, ...(to === undefined ? {} : { to }) });
    if (timer === undefined && queue.length > 0) timer = timers.set(drain, GAP_MS);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    local(elements) {
      const changed = elements.filter((element) => wins(element, known.get(element.id)));
      if (changed.length === 0) return;
      for (const element of changed) known.set(element.id, { ...element });
      publish();
      post(changed.map((element) => ({ ...element })));
    },
    remote(from, message, me, others) {
      const data = message as BoardMessage | null;
      if (typeof data !== "object" || data === null) return;
      if (data.k === "hello") {
        const giver = Math.min(me, ...others.filter((pid) => pid !== from));
        if (giver === me && known.size > 0) post([...known.values()], from);
        return;
      }
      if (data.k !== "els" || !Array.isArray(data.els)) return;
      const fresh = data.els.filter(isElement).filter((element) => wins(element, known.get(element.id)));
      if (fresh.length === 0) return;
      for (const element of fresh) known.set(element.id, element);
      publish();
    },
    hello() {
      send({ k: "hello" });
    },
    stop() {
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      queue.length = 0;
    },
  };
}
