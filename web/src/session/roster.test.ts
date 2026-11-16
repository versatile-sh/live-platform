import { describe, expect, test } from "vitest";

import type { Person } from "../signal/protocol";
import { EMPTY_ROSTER, applyRoster } from "./roster";

function person(pid: number, slot: number, name = `p${pid}`): Person {
  return { pid, slot, name, state: "connecting", flags: 0 };
}

describe("applyRoster", () => {
  describe("with a version greater than the last applied", () => {
    test("replaces the whole roster, sorted by slot", () => {
      const update = applyRoster(EMPTY_ROSTER, { v: 1, people: [person(2, 1), person(1, 0)], gone: [] });
      expect(update).toMatchObject({ applied: true, roster: { version: 1, people: [{ pid: 1 }, { pid: 2 }] } });
    });
  });

  describe("with the same version", () => {
    test("changes nothing", () => {
      const first = applyRoster(EMPTY_ROSTER, { v: 3, people: [person(1, 0)], gone: [] });
      if (!first.applied) throw new Error("expected the first roster to apply");
      expect(applyRoster(first.roster, { v: 3, people: [], gone: [] })).toEqual({ applied: false });
    });
  });

  describe("with an older version", () => {
    test("is ignored", () => {
      const first = applyRoster(EMPTY_ROSTER, { v: 5, people: [person(1, 0)], gone: [] });
      if (!first.applied) throw new Error("expected the first roster to apply");
      expect(applyRoster(first.roster, { v: 4, people: [], gone: [] })).toEqual({ applied: false });
    });
  });

  describe("as the first roster", () => {
    test("reports no arrivals so that joining a full room is not a burst of notices", () => {
      expect(applyRoster(EMPTY_ROSTER, { v: 2, people: [person(1, 0), person(2, 1)], gone: [] })).toMatchObject({ arrived: [], left: [] });
    });
  });

  describe("when someone joins and someone goes", () => {
    test("reports the arrival and the departure with its reason", () => {
      const first = applyRoster(EMPTY_ROSTER, { v: 1, people: [person(1, 0, "Ana"), person(2, 1, "Bia")], gone: [] });
      if (!first.applied) throw new Error("expected the first roster to apply");
      const next = applyRoster(first.roster, { v: 2, people: [person(1, 0, "Ana"), person(3, 1, "Caio")], gone: [{ pid: 2, reason: "media-timeout" }] });
      expect(next).toMatchObject({ arrived: [{ pid: 3 }], left: [{ pid: 2, name: "Bia", reason: "media-timeout" }] });
    });

    test("reads a missing reason as left", () => {
      const first = applyRoster(EMPTY_ROSTER, { v: 1, people: [person(2, 0, "Bia")], gone: [] });
      if (!first.applied) throw new Error("expected the first roster to apply");
      expect(applyRoster(first.roster, { v: 2, people: [], gone: [] })).toMatchObject({ left: [{ name: "Bia", reason: "left" }] });
    });
  });
});
