import { describe, expect, test, vi } from "vitest";

import { chunk, createBoardSync, FRAME_BYTES, MAX_BYTES, MAX_ELEMENTS, MAX_QUEUE, wins, type BoardElement, type BoardMessage } from "./board-sync";

const el = (id: string, version: number, versionNonce = 1, extra: object = {}): BoardElement => ({ id, type: "rectangle", version, versionNonce, ...extra });

function setup() {
  vi.useFakeTimers();
  const sent: Array<{ message: BoardMessage; to?: number }> = [];
  const sync = createBoardSync((message, to) => (sent.push({ message, ...(to === undefined ? {} : { to }) }), true));
  return { sync, sent };
}

describe("wins", () => {
  test("the higher version replaces, and on a tie the lower nonce, so everyone settles the same", () => {
    expect(wins(el("a", 2), el("a", 1))).toBe(true);
    expect(wins(el("a", 1), el("a", 2))).toBe(false);
    expect(wins(el("a", 2, 1), el("a", 2, 5))).toBe(true);
    expect(wins(el("a", 2, 5), el("a", 2, 1))).toBe(false);
    expect(wins(el("a", 1), undefined)).toBe(true);
  });
});

const frameBytes = (els: BoardElement[]) => new TextEncoder().encode(JSON.stringify({ k: "els", els })).byteLength;

describe("chunk", () => {
  describe("with elements that all fit", () => {
    test("groups them so every encoded frame stays within the limit", () => {
      const els = [el("a", 1, 1, { text: "x".repeat(300) }), el("b", 1, 1, { text: "y".repeat(300) }), el("c", 1)];
      const { groups, oversized } = chunk(els, 800);
      expect(groups.map((group) => group.map((e) => e.id))).toEqual([["a", "b"], ["c"]]);
      expect(groups.every((group) => frameBytes(group) <= 800)).toBe(true);
      expect(oversized).toEqual([]);
    });
  });

  describe("with multi-byte text", () => {
    test("counts UTF-8 bytes, not characters", () => {
      const cjk = el("a", 1, 1, { text: "字".repeat(200) });
      const { groups, oversized } = chunk([cjk, el("b", 1)], 560);
      expect(frameBytes([cjk])).toBeGreaterThan(560);
      expect(groups.map((group) => group.map((e) => e.id))).toEqual([["b"]]);
      expect(oversized).toEqual([cjk]);
    });
  });

  describe("with an element larger than the server frame", () => {
    test("reports it as oversized and keeps the others", () => {
      const big = el("b", 1, 1, { text: "x".repeat(FRAME_BYTES) });
      const { groups, oversized } = chunk([el("a", 1), big]);
      expect(groups.map((group) => group.map((e) => e.id))).toEqual([["a"]]);
      expect(oversized).toEqual([big]);
    });

    test("accepts one just under the frame size, which the old estimate dropped", () => {
      const wide = el("b", 1, 1, { text: "x".repeat(30_000) });
      expect(chunk([wide]).groups).toEqual([[wide]]);
    });
  });
});

describe("createBoardSync", () => {
  test("sends only what changed, paced, and nothing when nothing did", () => {
    const { sync, sent } = setup();
    sync.local([el("a", 1), el("b", 1)]);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(sent).toEqual([{ message: { k: "els", els: [el("a", 1), el("b", 1)] } }]);
    sync.local([el("a", 1), el("b", 2)]);
    sync.local([el("a", 1), el("b", 2)]);
    vi.advanceTimersByTime(150);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.message).toEqual({ k: "els", els: [el("b", 2)] });
  });

  test("takes newer elements from the others, tells who listens, and ignores stale or malformed ones", () => {
    const { sync, sent } = setup();
    const heard = vi.fn();
    sync.subscribe(heard);
    sync.local([el("a", 3)]);
    sync.remote(2, { k: "els", els: [el("a", 2), el("b", 1), { id: 5 }, null] }, 1, [2]);
    expect(sync.getSnapshot()).toEqual([el("a", 3), el("b", 1)]);
    expect(heard).toHaveBeenCalledTimes(2);
    sync.remote(2, { k: "els", els: [el("a", 2)] }, 1, [2]);
    sync.remote(2, "nonsense", 1, [2]);
    sync.remote(2, { k: "els", els: "no" }, 1, [2]);
    expect(heard).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
  });

  test("whoever arrives is given the whole board by the lowest pid among the others, and only by them", () => {
    const { sync, sent } = setup();
    sync.local([el("a", 1)]);
    vi.advanceTimersByTime(150);
    sync.remote(3, { k: "hello" }, 2, [1, 3]);
    vi.advanceTimersByTime(150);
    expect(sent).toHaveLength(1);
    const lowest = setup();
    lowest.sync.local([el("a", 1)]);
    vi.advanceTimersByTime(150);
    lowest.sync.remote(3, { k: "hello" }, 1, [2, 3]);
    vi.advanceTimersByTime(150);
    expect(lowest.sent[1]).toEqual({ message: { k: "els", els: [el("a", 1)] }, to: 3 });
  });

  test("asks the room for the board, and stops sending when stopped", () => {
    const { sync, sent } = setup();
    sync.hello();
    expect(sent).toEqual([{ message: { k: "hello" } }]);
    sync.local([el("a", 1)]);
    sync.stop();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
  });

  describe("local", () => {
    describe("with an element the editor changes in place", () => {
      test("sends every later change of it", () => {
        const { sync, sent } = setup();
        const live = el("a", 1, 1, { x: 0 });
        sync.local([live]);
        vi.advanceTimersByTime(150);
        Object.assign(live, { version: 2, versionNonce: 2, x: 10 });
        sync.local([live]);
        vi.advanceTimersByTime(150);
        expect(sent).toHaveLength(2);
        expect(sent[1]!.message).toEqual({ k: "els", els: [el("a", 2, 2, { x: 10 })] });
      });

      test("sends the element as it was when handed over, even when edited before the frame goes out", () => {
        const { sync, sent } = setup();
        const live = el("a", 1, 1, { x: 0 });
        sync.local([live]);
        Object.assign(live, { version: 2, versionNonce: 2, x: 10 });
        vi.advanceTimersByTime(150);
        expect(sent[0]!.message).toEqual({ k: "els", els: [el("a", 1, 1, { x: 0 })] });
      });
    });
  });

  describe("when the room cannot be reached", () => {
    test("keeps the frame queued and sends it once the send works again", () => {
      vi.useFakeTimers();
      const sent: BoardMessage[] = [];
      let open = false;
      const sync = createBoardSync((message) => (open ? (sent.push(message), true) : false));
      sync.local([el("a", 1)]);
      vi.advanceTimersByTime(450);
      expect(sent).toEqual([]);
      open = true;
      vi.advanceTimersByTime(150);
      expect(sent).toEqual([{ k: "els", els: [el("a", 1)] }]);
      vi.advanceTimersByTime(1000);
      expect(sent).toHaveLength(1);
    });
  });
  describe("hello from a newcomer", () => {
    describe("when the lowest pid may not draw", () => {
      test("the lowest pid that may draw gives the board", () => {
        const { sync, sent } = setup();
        sync.local([el("a", 1)]);
        vi.advanceTimersByTime(150);
        sync.remote(4, { k: "hello" }, 2, [1, 3, 4], [2, 3]);
        vi.advanceTimersByTime(150);
        expect(sent[1]).toEqual({ message: { k: "els", els: [el("a", 1)] }, to: 4 });
      });

      test("a participant who may not draw stays silent", () => {
        const { sync, sent } = setup();
        sync.local([el("a", 1)]);
        vi.advanceTimersByTime(150);
        sync.remote(4, { k: "hello" }, 1, [2, 3, 4], [2, 3]);
        vi.advanceTimersByTime(150);
        expect(sent).toHaveLength(1);
      });
    });

    describe("when the same newcomer asks again", () => {
      test("the next candidate gives the board", () => {
        const first = setup();
        first.sync.local([el("a", 1)]);
        vi.advanceTimersByTime(150);
        first.sync.remote(4, { k: "hello" }, 2, [1, 3, 4], [1, 2, 3]);
        vi.advanceTimersByTime(150);
        expect(first.sent).toHaveLength(1);
        vi.advanceTimersByTime(2000);
        first.sync.remote(4, { k: "hello" }, 2, [1, 3, 4], [1, 2, 3]);
        vi.advanceTimersByTime(150);
        expect(first.sent[1]).toEqual({ message: { k: "els", els: [el("a", 1)] }, to: 4 });
      });
    });
  });

  describe("hello", () => {
    describe("when no elements arrive within the timeout", () => {
      test("sends the identical request once more, and no more than once", () => {
        const { sync, sent } = setup();
        sync.hello();
        vi.advanceTimersByTime(10_000);
        expect(sent).toEqual([{ message: { k: "hello" } }, { message: { k: "hello" } }]);
      });
    });

    describe("when elements arrive in time", () => {
      test("does not ask again", () => {
        const { sync, sent } = setup();
        sync.hello();
        sync.remote(2, { k: "els", els: [el("a", 1)] }, 1, [2]);
        vi.advanceTimersByTime(10_000);
        expect(sent).toHaveLength(1);
      });
    });

    describe("when stopped before the timeout", () => {
      test("does not ask again", () => {
        const { sync, sent } = setup();
        sync.hello();
        sync.stop();
        vi.advanceTimersByTime(10_000);
        expect(sent).toHaveLength(1);
      });
    });
  });

  describe("local", () => {
    describe("with an element too large for one frame", () => {
      test("counts it as oversized, tells the subscribers, and sends the others", () => {
        const { sync, sent } = setup();
        const heard = vi.fn();
        sync.subscribe(heard);
        sync.local([el("a", 1), el("big", 1, 1, { text: "x".repeat(FRAME_BYTES) })]);
        vi.advanceTimersByTime(150);
        expect(sync.getOversized()).toBe(1);
        expect(heard).toHaveBeenCalledTimes(2);
        expect(sent).toEqual([{ message: { k: "els", els: [el("a", 1)] } }]);
      });

      test("stops counting it once it is shrunk to fit", () => {
        const { sync } = setup();
        sync.local([el("big", 1, 1, { text: "x".repeat(FRAME_BYTES) })]);
        sync.local([el("big", 2, 1, { text: "x" })]);
        expect(sync.getOversized()).toBe(0);
      });
    });
  });
});

describe("remote elements from a peer", () => {
  describe("with a version or nonce that is not a safe non-negative integer", () => {
    test("rejects the element", () => {
      const { sync } = setup();
      const bad = [el("a", 1e308), el("b", -1), el("c", 1.5), el("d", 1, Number.MAX_SAFE_INTEGER + 1), el("e", 1, -2), el("f", Number.NaN)];
      sync.remote(2, { k: "els", els: [...bad, { id: "g", version: 1, versionNonce: 1 }, { ...el("h", 1), type: 4 }, el("ok", 1)] }, 1, [2]);
      expect(sync.getSnapshot().map((e) => e.id)).toEqual(["ok"]);
    });
  });

  describe("with more elements than the cap", () => {
    test("keeps the first ones and drops the rest", () => {
      const { sync } = setup();
      const els = Array.from({ length: MAX_ELEMENTS + 5 }, (_, i) => el(`e${i}`, 1));
      sync.remote(2, { k: "els", els }, 1, [2]);
      expect(sync.getSnapshot()).toHaveLength(MAX_ELEMENTS);
    });

    test("still takes a newer version of an element it already has", () => {
      const { sync } = setup();
      sync.remote(2, { k: "els", els: Array.from({ length: MAX_ELEMENTS }, (_, i) => el(`e${i}`, 1)) }, 1, [2]);
      sync.remote(2, { k: "els", els: [el("e0", 2), el("extra", 1)] }, 1, [2]);
      expect(sync.getSnapshot().find((e) => e.id === "e0")?.version).toBe(2);
      expect(sync.getSnapshot().some((e) => e.id === "extra")).toBe(false);
    });
  });

  describe("with more bytes than the cap", () => {
    test("drops the elements that would pass it", () => {
      const { sync } = setup();
      const chunkOf = (i: number) => el(`big${i}`, 1, 1, { text: "x".repeat(1 << 20) });
      sync.remote(2, { k: "els", els: Array.from({ length: 18 }, (_, i) => chunkOf(i)) }, 1, [2]);
      expect(sync.getSnapshot().length).toBe(MAX_BYTES / (1 << 20) - 1);
    });
  });
});

describe("hello from a participant", () => {
  const mine = [1];
  function giver() {
    vi.useFakeTimers();
    const sent: Array<{ message: BoardMessage; to?: number }> = [];
    let open = true;
    const sync = createBoardSync((message, to) => {
      if (!open) return false;
      sent.push({ message, ...(to === undefined ? {} : { to }) });
      return true;
    });
    sync.local([el("a", 1)]);
    vi.advanceTimersByTime(150);
    sent.length = 0;
    return { sync, sent, block: () => (open = false), unblock: () => (open = true) };
  }
  const transfers = (sent: Array<{ to?: number }>) => sent.filter((s) => s.to === 4).length;

  describe("from someone who is not in the room", () => {
    test("is ignored", () => {
      const { sync, sent } = giver();
      sync.remote(9, { k: "hello" }, 1, [2, 4], mine);
      vi.advanceTimersByTime(1000);
      expect(sent).toEqual([]);
    });
  });

  describe("while a transfer to the same sender is still queued", () => {
    test("is ignored, so the board goes once", () => {
      const { sync, sent, block, unblock } = giver();
      block();
      sync.remote(4, { k: "hello" }, 1, [2, 4], mine);
      vi.advanceTimersByTime(5000);
      sync.remote(4, { k: "hello" }, 1, [2, 4], mine);
      unblock();
      vi.advanceTimersByTime(1000);
      expect(transfers(sent)).toBe(1);
    });
  });

  describe("again within the minimum interval", () => {
    test("is ignored, and answered once the interval has passed", () => {
      const { sync, sent } = giver();
      sync.remote(4, { k: "hello" }, 1, [2, 4], mine);
      vi.advanceTimersByTime(200);
      sync.remote(4, { k: "hello" }, 1, [2, 4], mine);
      vi.advanceTimersByTime(200);
      expect(transfers(sent)).toBe(1);
      vi.advanceTimersByTime(2000);
      sync.remote(4, { k: "hello" }, 1, [2, 4], mine);
      vi.advanceTimersByTime(200);
      expect(transfers(sent)).toBe(2);
    });
  });

  describe("when the queue is already full", () => {
    test("does not queue the transfer", () => {
      vi.useFakeTimers();
      const sent: Array<{ to?: number }> = [];
      const sync = createBoardSync((_message, to) => (sent.push({ ...(to === undefined ? {} : { to }) }), true));
      sync.local(Array.from({ length: MAX_QUEUE + 10 }, (_, i) => el(`e${i}`, 1, 1, { text: "x".repeat(FRAME_BYTES - 200) })));
      sync.remote(4, { k: "hello" }, 1, [2, 4], mine);
      vi.advanceTimersByTime(150 * (MAX_QUEUE + 100));
      expect(transfers(sent)).toBe(0);
    });
  });
});
