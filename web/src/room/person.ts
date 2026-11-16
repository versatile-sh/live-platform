import { flagNames, hasFlag, type FlagName } from "../domain/flags";
import type { MessageKey } from "../i18n";
import type { Person } from "../signal/protocol";

/** How a tile looks: solid when present, dashed while still connecting, dim when the person may be gone. */
export type TileTone = "solid" | "dashed" | "dim";

export type PersonView = { stateKey: MessageKey; tone: TileTone; flags: FlagName[]; isOwner: boolean; trouble: boolean };

/**
 * What to show for a participant. Trouble comes first: a person who is reconnecting or unstable is dimmed and labelled
 * whatever else is true, so it is never signalled by colour alone.
 */
export function describePerson(person: Person): PersonView {
  const isOwner = hasFlag(person.flags, "owner");
  const flags = flagNames(person.flags).filter((flag) => flag !== "owner" && flag !== "unstable");
  if (person.state === "reconnecting") return { stateKey: "person.reconnecting", tone: "dim", flags, isOwner, trouble: true };
  if (hasFlag(person.flags, "unstable")) return { stateKey: "person.unstable", tone: "dim", flags, isOwner, trouble: true };
  if (person.state === "connecting") return { stateKey: "person.connecting", tone: "dashed", flags, isOwner, trouble: false };
  return { stateKey: "person.active", tone: "solid", flags, isOwner, trouble: false };
}
