import { describe, expect, test } from "vitest";

import { IDLE, reduceConnection, type Connection, type ConnectionEvent } from "./connection";
import type { Person } from "../signal/protocol";

function run(events: ConnectionEvent[], from: Connection = IDLE): Connection {
  return events.reduce(reduceConnection, from);
}

function person(pid: number, slot: number, name = `p${pid}`): Person {
  return { pid, slot, name, state: "connecting", flags: 0 };
}

const joined = [{ type: "start", resuming: false }, { type: "joined", pid: 1 }] as const satisfies ConnectionEvent[];
const rosterOf = (v: number, people: Person[], gone: Array<{ pid: number; reason: "left" | "removed-by-owner" | "media-timeout" }> = []): ConnectionEvent => ({
  type: "roster",
  frame: { t: "roster", v, people, gone },
});

describe("reduceConnection", () => {
  describe("from idle", () => {
    test("start moves to joining", () => {
      expect(run([{ type: "start", resuming: false }])).toEqual({ phase: "joining", resuming: false });
    });

    test.each<ConnectionEvent>([{ type: "joined", pid: 1 }, { type: "gave-up" }, { type: "attempt" }, { type: "end", reason: { kind: "left" } }])("ignores %j", (event) => {
      expect(run([event])).toEqual(IDLE);
    });
  });

  describe("while joining", () => {
    test("joined moves to joined with an empty roster", () => {
      expect(run([...joined])).toMatchObject({ phase: "joined", me: 1, roster: { version: 0, people: [] } });
    });

    test("a drop before joined ends as unreachable", () => {
      expect(run([{ type: "start", resuming: false }, { type: "dropped", cause: "network", at: 0 }])).toEqual({ phase: "ended", reason: { kind: "unreachable" } });
    });

    test("a refusal ends with the error code", () => {
      expect(run([{ type: "start", resuming: false }, { type: "end", reason: { kind: "refused", code: "PERMISSION_DENIED" } }])).toEqual({
        phase: "ended",
        reason: { kind: "refused", code: "PERMISSION_DENIED" },
      });
    });
  });

  describe("while joined", () => {
    test("a roster is applied and a stale one is not", () => {
      const state = run([...joined, rosterOf(2, [person(1, 0), person(2, 1)]), rosterOf(1, [])]);
      expect(state).toMatchObject({ phase: "joined", roster: { version: 2 } });
    });

    test("an arrival after the first roster leaves a notice", () => {
      const state = run([...joined, rosterOf(1, [person(1, 0)]), rosterOf(2, [person(1, 0), person(2, 1, "Bia")])]);
      expect(state).toMatchObject({ notices: [{ kind: "arrived", name: "Bia" }] });
    });

    test("a departure leaves a notice with the reason", () => {
      const state = run([...joined, rosterOf(1, [person(1, 0), person(2, 1, "Bia")]), rosterOf(2, [person(1, 0)], [{ pid: 2, reason: "media-timeout" }])]);
      expect(state).toMatchObject({ notices: [{ kind: "left", name: "Bia", reason: "media-timeout" }] });
    });

    test("a notice expiry removes only that notice", () => {
      const base = run([...joined, rosterOf(1, [person(1, 0)]), rosterOf(2, [person(1, 0), person(2, 1)]), rosterOf(3, [person(1, 0), person(2, 1), person(3, 2)])]);
      const state = reduceConnection(base, { type: "notice-expired", id: 1 });
      expect(state).toMatchObject({ notices: [{ id: 2 }] });
    });

    test("keeps only the latest few notices", () => {
      const steps = [2, 3, 4, 5, 6, 7].map((v) => rosterOf(v, Array.from({ length: v - 1 }, (_, i) => person(i + 1, i))));
      const state = run([...joined, rosterOf(1, [person(1, 0)]), ...steps]);
      expect(state.phase === "joined" && state.notices).toHaveLength(4);
    });

    test("a roster that lists me as gone by the owner ends as removed", () => {
      const state = run([...joined, rosterOf(1, [person(1, 0)]), rosterOf(2, [], [{ pid: 1, reason: "removed-by-owner" }])]);
      expect(state).toEqual({ phase: "ended", reason: { kind: "removed" } });
    });

    test("a roster that lists me as gone for media ends as dropped by the server", () => {
      const state = run([...joined, rosterOf(1, [person(1, 0)]), rosterOf(2, [], [{ pid: 1, reason: "media-timeout" }])]);
      expect(state).toEqual({ phase: "ended", reason: { kind: "dropped-by-server", reason: "media-timeout" } });
    });

    test("an owner refusal becomes a notice and keeps me joined", () => {
      expect(run([...joined, { type: "owner-refused", code: "INVARIANT_VIOLATION" }])).toMatchObject({ phase: "joined", notices: [{ kind: "refused", code: "INVARIANT_VIOLATION" }] });
    });

    test("a drop moves to reconnecting and keeps the roster", () => {
      const state = run([...joined, rosterOf(3, [person(1, 0)]), { type: "dropped", cause: "dead", at: 1000 }]);
      expect(state).toMatchObject({ phase: "reconnecting", cause: "dead", since: 1000, attempts: 0, roster: { version: 3 } });
    });
  });

  describe("while reconnecting", () => {
    const dropped = [...joined, rosterOf(3, [person(1, 0)]), { type: "dropped", cause: "network", at: 0 }] as const satisfies ConnectionEvent[];

    test("counts attempts", () => {
      expect(run([...dropped, { type: "attempt" }, { type: "attempt" }])).toMatchObject({ phase: "reconnecting", attempts: 2 });
    });

    test("a resumed joined returns to joined with the roster intact", () => {
      expect(run([...dropped, { type: "joined", pid: 1 }])).toMatchObject({ phase: "joined", me: 1, roster: { version: 3 } });
    });

    test("a later roster with a lower version is still ignored after resuming", () => {
      const state = run([...dropped, { type: "joined", pid: 1 }, rosterOf(2, [])]);
      expect(state).toMatchObject({ roster: { version: 3 } });
    });

    test("giving up ends as disconnected", () => {
      expect(run([...dropped, { type: "gave-up" }])).toEqual({ phase: "ended", reason: { kind: "disconnected" } });
    });

    test("a second drop only updates the cause", () => {
      expect(run([...dropped, { type: "dropped", cause: "silent", at: 500 }])).toMatchObject({ cause: "silent", since: 0 });
    });

    test("a roster is ignored", () => {
      expect(run([...dropped, rosterOf(9, [])])).toMatchObject({ roster: { version: 3 } });
    });
  });

  describe("once ended", () => {
    const ended = run([{ type: "start", resuming: false }, { type: "end", reason: { kind: "superseded" } }]);

    test("ignores everything but a new start", () => {
      expect(run([{ type: "joined", pid: 1 }, { type: "gave-up" }, { type: "end", reason: { kind: "left" } }], ended)).toEqual(ended);
    });

    test("a start rejoins", () => {
      expect(run([{ type: "start", resuming: false }], ended)).toEqual({ phase: "joining", resuming: false });
    });
  });
});
