const MAX_NAME = 40;

/** Why a display name was refused. */
export type NameProblem = "empty" | "length" | "invisible";

/** The outcome of checking a display name the way the server does. */
export type NameCheck = { ok: true; name: string } | { ok: false; problem: NameProblem };

/** Trims and checks a display name: 1 to 40 characters, no control or invisible ones. */
export function checkName(raw: string): NameCheck {
  const name = raw.trim();
  const length = [...name].length;
  if (length === 0) return { ok: false, problem: "empty" };
  if (length > MAX_NAME) return { ok: false, problem: "length" };
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return { ok: false, problem: "invisible" };
  return { ok: true, name };
}
