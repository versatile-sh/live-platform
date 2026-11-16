import { checkName, type NameProblem } from "../domain/name";
import { assessPassword, type PasswordProblem } from "../domain/password";

/** What the entry form holds. `kind` says whether the person is creating a free slug or joining a room that exists. */
export type EntryValues =
  | { kind: "create"; name: string; access: "public" | "private"; listed: boolean; password: string }
  | { kind: "join"; name: string; roomIsPrivate: boolean; password: string };

export type EntryProblems = { name?: NameProblem; password?: PasswordProblem | "required" };

/** The outcome of checking the form: what to send, or what is wrong. */
export type EntryCheck =
  | { ok: true; name: string; private: boolean; password: string | undefined; listed: boolean | undefined }
  | { ok: false; problems: EntryProblems };

/** Whether the room being entered will ask for a password. */
export function entryIsPrivate(values: EntryValues): boolean {
  return values.kind === "create" ? values.access === "private" : values.roomIsPrivate;
}

/** Checks the form: the name always, the password when the room is private (its rule when creating, presence when joining). */
export function checkEntry(values: EntryValues): EntryCheck {
  const problems: EntryProblems = {};
  const name = checkName(values.name);
  if (!name.ok) problems.name = name.problem;
  const needsPassword = entryIsPrivate(values);
  if (needsPassword && values.kind === "create") {
    const assessment = assessPassword(values.password);
    if (assessment.rating === "invalid") problems.password = assessment.problem;
  } else if (needsPassword && values.password.length === 0) {
    problems.password = "required";
  }
  if (!name.ok || problems.password) return { ok: false, problems };
  return {
    ok: true,
    name: name.name,
    private: needsPassword,
    password: needsPassword ? values.password : undefined,
    listed: values.kind === "create" && values.access === "public" ? values.listed : undefined,
  };
}

/** Whether the owner's typed password is accepted but guessable, so the page should warn. */
export function isWeakChoice(values: EntryValues): boolean {
  return values.kind === "create" && values.access === "private" && assessPassword(values.password).rating === "weak";
}
