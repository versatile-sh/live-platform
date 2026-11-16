import { useRef, useState, type FormEvent } from "react";

import type { RoomSummary } from "../api/rooms";
import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import type { ErrorCode } from "../signal/protocol";
import type { JoinEntry } from "../session/session";
import { PasswordField } from "../ui/PasswordField";
import { CAPTION, SURFACE, button } from "../ui/styles";
import { TextField } from "../ui/TextField";
import { checkEntry, entryIsPrivate, isWeakChoice, type EntryValues } from "./entry";

type EntryFormProps = {
  slug: string;
  room: RoomSummary;
  refusal?: ErrorCode;
  expired?: boolean;
  onEnter: (entry: JoinEntry) => void;
};

const ACCESS_CHOICE = "bubble flex min-h-20 cursor-pointer flex-col gap-1 border border-muted-light p-3 transition-colors has-checked:border-accent has-checked:bg-accent/12 has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-fg/55";

/** Asks what a visitor must tell the room before entering: a name, and for a new room its access and password. */
export function EntryForm({ slug, room, refusal, expired, onEnter }: EntryFormProps) {
  const t = useT();
  const services = useServices();
  const form = useRef<HTMLFormElement>(null);
  const creating = !room.exists;
  const [values, setValues] = useState<EntryValues>(() =>
    creating
      ? { kind: "create", name: services.nameMemory.read(), access: "public", listed: false, password: services.generatePassword() }
      : { kind: "join", name: services.nameMemory.read(), roomIsPrivate: room.private, password: services.readPasswordHash() },
  );
  const [submitted, setSubmitted] = useState(false);
  const [working, setWorking] = useState(false);

  const check = checkEntry(values);
  const problems = submitted && !check.ok ? check.problems : {};
  const isPrivate = entryIsPrivate(values);
  const update = (change: Partial<EntryValues>) => setValues((current) => ({ ...current, ...change }) as EntryValues);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!check.ok) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setWorking(true);
    services.nameMemory.write(check.name);
    const derived = check.private && check.password ? await services.derive(check.password, slug) : undefined;
    services.forgetHash();
    onEnter({
      name: check.name,
      ...(derived ? { verifier: derived.verifier } : {}),
      ...(check.password ? { password: check.password } : {}),
      ...(check.listed === undefined ? {} : { listed: check.listed }),
    });
    setWorking(false);
  }

  const full = room.exists && room.count >= room.capacity;
  const passwordProblem = problems.password
    ? problems.password === "required"
      ? t("password.required")
      : t(problems.password === "short" ? "password.short" : problems.password === "needs-letter" ? "password.needsLetter" : "password.needsDigit")
    : undefined;

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">
        <span translate="no">{creating ? t("entry.createTitle", { slug }) : t("entry.joinTitle", { slug })}</span>
      </h1>
      <p className="mt-4 mb-6 max-w-xl text-muted">{creating ? t("entry.createIntro") : full ? t("entry.joinFull", { count: room.count, capacity: room.capacity }) : t("entry.joinPeople", { count: room.count, capacity: room.capacity })}</p>
      {expired ? <p className={`${SURFACE} mb-6 max-w-xl p-4 text-sm`}>{t("ended.expired.body")}</p> : null}

      <form ref={form} onSubmit={(event) => void submit(event)} noValidate className="max-w-xl">
        <TextField
          label={t("entry.nameLabel")}
          hint={t("entry.nameHint")}
          {...(problems.name ? { error: t(`entry.name.${problems.name}`) } : {})}
          value={values.name}
          autoComplete="nickname"
          onChange={(event) => update({ name: event.target.value })}
        />

        {values.kind === "create" ? (
          <>
            <fieldset className="mt-2 mb-4">
              <legend className="mb-1.5 text-sm font-semibold">{t("entry.accessLegend")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["public", "private"] as const).map((access) => (
                  <label key={access} className={ACCESS_CHOICE}>
                    <input type="radio" name="access" className="sr-only" checked={values.access === access} onChange={() => update({ access })} />
                    <span className="font-semibold">{t(access === "public" ? "entry.accessPublic" : "entry.accessPrivate")}</span>
                    <span className="text-sm text-muted">{t(access === "public" ? "entry.accessPublicHint" : "entry.accessPrivateHint")}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className={`mb-1 flex items-center gap-3 ${isPrivate ? "opacity-60" : ""}`}>
              <input type="checkbox" className="size-5 accent-accent" checked={values.access === "public" && values.listed} disabled={isPrivate} onChange={(event) => update({ listed: event.target.checked })} />
              <span className="font-semibold">{t("entry.listed")}</span>
            </label>
            <p className={`${CAPTION} mb-5 pl-8`}>{isPrivate ? t("entry.listedPrivate") : t("entry.listedHint")}</p>

            {isPrivate ? (
              <PasswordField
                label={t("entry.passwordLabel")}
                value={values.password}
                onChange={(password) => update({ password })}
                generated
                  onGenerate={() => update({ password: services.generatePassword() })}
                hint={
                  isWeakChoice(values) && !problems.password ? (
                    <span className="text-amber">{t("password.weak")}</span>
                  ) : (
                    t("entry.passwordCreateHint")
                  )
                }
                {...(passwordProblem ? { error: passwordProblem } : {})}
              />
            ) : null}
          </>
        ) : room.private ? (
          <>
            <p className="mb-3 text-sm text-muted">{t("entry.joinPrivate")}</p>
            <PasswordField label={t("entry.passwordLabel")} value={values.password} onChange={(password) => update({ password })} hint={t("entry.passwordJoinHint")} {...(passwordProblem ? { error: passwordProblem } : {})} />
          </>
        ) : null}

        <p role="alert" className="min-h-6 text-sm text-amber">
          {refusal ? t(`refused.${refusal}`) : ""}
        </p>
        <button type="submit" disabled={working} className={`${button()} mt-2`}>
          {working ? t("entry.working") : creating ? t("entry.submitCreate") : t("entry.submitJoin")}
        </button>
      </form>
    </div>
  );
}
