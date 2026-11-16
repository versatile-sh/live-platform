import { useId, useState, type FormEvent } from "react";

import type { RoomSummary } from "../api/rooms";
import { checkName } from "../domain/name";
import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import type { ErrorCode } from "../signal/protocol";
import type { JoinEntry } from "../session/session";
import { Arrow } from "../ui/Arrow";
import { FIELD, button } from "../ui/styles";
import { AccessSettings, type Access } from "./AccessSettings";

type EntryFormProps = {
  slug: string;
  room: RoomSummary;
  refusal?: ErrorCode;
  expired?: boolean;
  onEnter: (entry: JoinEntry) => void;
};

/** A room's doorway: a name, then either the settings of a room about to be created or the code of a private one that exists. */
export function EntryForm({ slug, room, refusal, expired, onEnter }: EntryFormProps) {
  const t = useT();
  const services = useServices();
  const id = useId();
  const creating = !room.exists;
  const [name, setName] = useState(() => services.nameMemory.read());
  const [access, setAccess] = useState<Access>("public");
  const [listed, setListed] = useState(true);
  const [code, setCode] = useState(() => (creating ? services.generatePassword() : services.readPasswordHash()));
  const [problems, setProblems] = useState<{ name?: string; code?: string }>({});
  const [working, setWorking] = useState(false);
  const needsCode = creating ? access === "private" : room.private;
  const full = room.exists && room.count >= room.capacity;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const who = checkName(name);
    const missingCode = needsCode && code.trim() === "";
    if (!who.ok || missingCode) {
      setProblems({ ...(who.ok ? {} : { name: t(`entry.name.${who.problem}`) }), ...(missingCode ? { code: t("password.required") } : {}) });
      return;
    }
    setWorking(true);
    services.nameMemory.write(who.name);
    const derived = needsCode ? await services.derive(code.trim(), slug) : undefined;
    services.forgetHash();
    onEnter({
      name: who.name,
      ...(derived ? { verifier: derived.verifier, password: code.trim() } : {}),
      ...(creating ? { listed } : {}),
    });
    setWorking(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="w-full max-w-md">
      <h2 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">
        <span className="block truncate" translate="no">
          {creating ? t("entry.createTitle", { slug }) : t("entry.joinTitle", { slug })}
        </span>
      </h2>
      <p className="mt-2 mb-6 text-muted">{creating ? t("entry.createIntro") : full ? t("entry.joinFull", { count: room.count, capacity: room.capacity }) : t("entry.joinPeople", { count: room.count, capacity: room.capacity })}</p>
      {expired ? <p className="bubble mb-5 border border-line-strong bg-card p-4 text-sm">{t("ended.expired.body")}</p> : null}

      <label htmlFor={`${id}-name`} className="text-sm font-semibold">
        {t("entry.nameLabel")}
      </label>
      <input
        id={`${id}-name`}
        value={name}
        autoComplete="nickname"
        maxLength={40}
        aria-invalid={problems.name ? true : undefined}
        aria-describedby={`${id}-name-note`}
        className={`${FIELD} mt-1.5`}
        onChange={(event) => {
          setName(event.target.value);
          setProblems(({ code: kept }) => (kept ? { code: kept } : {}));
        }}
      />
      <p id={`${id}-name-note`} className={`mt-1.5 mb-5 min-h-5 text-sm ${problems.name ? "text-amber" : "text-muted"}`}>
        {problems.name ?? t("home.nameHint")}
      </p>

      {creating ? (
        <AccessSettings access={access} onAccess={setAccess} listed={listed} onListed={setListed} code={code} onRenew={() => setCode(services.generatePassword())} />
      ) : room.private ? (
        <>
          <label htmlFor={`${id}-code`} className="text-sm font-semibold">
            {t("entry.passwordLabel")}
          </label>
          <input
            id={`${id}-code`}
            value={code}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            aria-invalid={problems.code ? true : undefined}
            aria-describedby={`${id}-code-note`}
            className={`${FIELD} mt-1.5 h-14 font-mono text-xl font-bold tracking-[0.12em] uppercase placeholder:font-normal placeholder:tracking-[0.12em]`}
            onChange={(event) => {
              setCode(event.target.value);
              setProblems(({ name: kept }) => (kept ? { name: kept } : {}));
            }}
          />
          <p id={`${id}-code-note`} className={`mt-1.5 min-h-5 text-sm ${problems.code ? "text-amber" : "text-muted"}`}>
            {problems.code ?? t("entry.passwordJoinHint")}
          </p>
        </>
      ) : null}

      <p role="alert" className="mt-2 min-h-6 text-sm text-amber">
        {refusal ? t(`refused.${refusal}`) : ""}
      </p>
      <button type="submit" disabled={working || full} className={`${button()} mt-1 w-full gap-2`}>
        {working ? t("entry.working") : creating ? t("entry.submitCreate") : t("entry.submitJoin")}
        <Arrow />
      </button>
    </form>
  );
}
