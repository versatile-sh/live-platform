/** The part of a whiteboard element the sync reads; the rest travels untouched. */
export type BoardElement = { id: string; version: number; versionNonce: number; [key: string]: unknown };

/** What travels between browsers: elements that changed, or a request for the whole board from someone who just arrived. */
export type BoardMessage = { k: "els"; els: BoardElement[] } | { k: "hello" };

export type BoardSync = {
  subscribe(listener: () => void): () => void;
  /** Every element known, deleted ones included; a new array each time something changed. */
  getSnapshot(): readonly BoardElement[];
  /** How many of my elements are too large for one frame and so never reach the room; changes notify the subscribers. */
  getOversized(): number;
  /** Takes the scene as the local editor has it and sends what changed to the room. */
  local(elements: readonly BoardElement[]): void;
  /** Takes a message from another participant; `others` are the pids in the room besides mine and `drawers` those of everyone who may draw, me included when I may (defaults to all of them). */
  remote(from: number, message: unknown, me: number, others: readonly number[], drawers?: readonly number[]): void;
  /** Asks the room for the board when I arrive; asks once more when nothing came back, so the next participant who may draw answers. */
  hello(): void;
  stop(): void;
};

/** The server's cap on one board frame, in UTF-8 bytes of the JSON the browser sends (`boardMaxBytes` in `server/core/room/board.go`). */
export const FRAME_BYTES = 48 << 10;
const GAP_MS = 150;
const HELLO_RETRY_MS = 2000;
const HELLO_ATTEMPTS = 2;
const EMPTY_FRAME_BYTES = JSON.stringify({ k: "els", els: [] }).length;
const encoder = new TextEncoder();

function isElement(value: unknown): value is BoardElement {
  const el = value as BoardElement | null;
  return typeof el === "object" && el !== null && typeof el.id === "string" && typeof el.version === "number" && typeof el.versionNonce === "number";
}

/** Whether `next` replaces `kept`: the higher version wins, and on a tie the lower nonce, so every browser settles on the same element. */
export function wins(next: BoardElement, kept: BoardElement | undefined): boolean {
  return !kept || next.version > kept.version || (next.version === kept.version && next.versionNonce < kept.versionNonce);
}

/** Splits elements into groups whose encoded frame each fits `limit` bytes, and names the elements that could not fit even alone. */
export function chunk(elements: readonly BoardElement[], limit = FRAME_BYTES): { groups: BoardElement[][]; oversized: BoardElement[] } {
  const groups: BoardElement[][] = [];
  const oversized: BoardElement[] = [];
  let size = 0;
  for (const element of elements) {
    const bytes = encoder.encode(JSON.stringify(element)).byteLength;
    if (EMPTY_FRAME_BYTES + bytes > limit) {
      oversized.push(element);
      continue;
    }
    if (groups.length === 0 || size + bytes + 1 > limit) {
      groups.push([]);
      size = EMPTY_FRAME_BYTES;
    } else {
      size += 1;
    }
    groups.at(-1)!.push(element);
    size += bytes;
  }
  return { groups, oversized };
}

/** Keeps one whiteboard the same in every browser of the room: last version of each element wins, changes go out in paced frames, and whoever arrives is given the board by the lowest pid among those who may draw, and by the next one when asked again. */
export function createBoardSync(send: (message: BoardMessage, to?: number) => boolean, timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void } = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as number) }): BoardSync {
  const known = new Map<string, BoardElement>();
  const listeners = new Set<() => void>();
  const queue: Array<{ els: BoardElement[]; to?: number }> = [];
  let snapshot: readonly BoardElement[] = [];
  const oversized = new Set<string>();
  const asked = new Map<number, number>();
  let timer: unknown;
  let helloTimer: unknown;
  let heard = false;
  let helloRound = 0;

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
    const { groups, oversized: tooLarge } = chunk(elements);
    let changed = false;
    for (const element of elements) {
      if (!tooLarge.includes(element) && oversized.delete(element.id)) changed = true;
    }
    for (const element of tooLarge) {
      if (element.isDeleted === true) {
        if (oversized.delete(element.id)) changed = true;
        continue;
      }
      if (!oversized.has(element.id)) changed = true;
      oversized.add(element.id);
    }
    if (changed && to === undefined) listeners.forEach((listener) => listener());
    for (const els of groups) queue.push({ els, ...(to === undefined ? {} : { to }) });
    if (timer === undefined && queue.length > 0) timer = timers.set(drain, GAP_MS);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getOversized: () => oversized.size,
    local(elements) {
      const changed = elements.filter((element) => wins(element, known.get(element.id)));
      if (changed.length === 0) return;
      for (const element of changed) known.set(element.id, { ...element });
      publish();
      post(changed.map((element) => ({ ...element })));
    },
    remote(from, message, me, others, drawers = [me, ...others]) {
      const data = message as BoardMessage | null;
      if (typeof data !== "object" || data === null) return;
      if (data.k === "hello") {
        const round = ((asked.get(from) ?? 0) % HELLO_ATTEMPTS) + 1;
        asked.set(from, round);
        const candidates = [...new Set(drawers)].filter((pid) => pid !== from).sort((a, b) => a - b);
        const giver = candidates[(round - 1) % Math.max(candidates.length, 1)];
        if (giver === me && known.size > 0) post([...known.values()], from);
        return;
      }
      if (data.k !== "els" || !Array.isArray(data.els)) return;
      heard = true;
      const fresh = data.els.filter(isElement).filter((element) => wins(element, known.get(element.id)));
      if (fresh.length === 0) return;
      for (const element of fresh) known.set(element.id, element);
      publish();
    },
    hello() {
      if (helloTimer !== undefined) timers.clear(helloTimer);
      helloRound = 0;
      heard = false;
      const ask = () => {
        helloTimer = undefined;
        if (heard) return;
        send({ k: "hello" });
        helloRound += 1;
        if (helloRound < HELLO_ATTEMPTS) helloTimer = timers.set(ask, HELLO_RETRY_MS);
      };
      ask();
    },
    stop() {
      if (helloTimer !== undefined) timers.clear(helloTimer);
      helloTimer = undefined;
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      queue.length = 0;
    },
  };
}
