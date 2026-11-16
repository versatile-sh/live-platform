import { describe, expect, test } from "vitest";

import type { Person } from "../signal/protocol";
import { describePerson } from "./person";

const person = (over: Partial<Person>): Person => ({ pid: 1, slot: 0, name: "Ana", state: "active", flags: 0, ...over });

describe("describePerson", () => {
  test("shows an active person as solid", () => {
    expect(describePerson(person({}))).toMatchObject({ stateKey: "person.active", tone: "solid", trouble: false });
  });

  test("shows a connecting person as dashed and labelled", () => {
    expect(describePerson(person({ state: "connecting" }))).toMatchObject({ stateKey: "person.connecting", tone: "dashed", trouble: false });
  });

  test("dims and labels a reconnecting person", () => {
    expect(describePerson(person({ state: "reconnecting" }))).toMatchObject({ stateKey: "person.reconnecting", tone: "dim", trouble: true });
  });

  test("dims and labels an unstable person even while connecting", () => {
    expect(describePerson(person({ state: "connecting", flags: 64 }))).toMatchObject({ stateKey: "person.unstable", tone: "dim", trouble: true });
  });

  test("lets reconnecting win over unstable", () => {
    expect(describePerson(person({ state: "reconnecting", flags: 64 })).stateKey).toBe("person.reconnecting");
  });

  test("marks the owner and lists the media flags without owner or unstable", () => {
    expect(describePerson(person({ flags: 32 | 64 | 1 | 4 }))).toMatchObject({ isOwner: true, flags: ["screen", "microphone"] });
  });
});
