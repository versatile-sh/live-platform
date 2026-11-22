import { useEffect, useId, useState, type FormEvent } from "react";

import type { RoomSummary } from "../api/rooms";
import { checkName } from "../domain/name";
import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import type { ErrorCode } from "../signal/protocol";
import type { JoinEntry } from "../session/session";
import { Arrow } from "../ui/Arrow";
import { Field } from "../ui/Field";
import { withMotion } from "../ui/motion";
import { button, QUIET_LINK } from "../ui/styles";
import { AccessSettings, type Access } from "./AccessSettings";

type EntryFormProps = {
  slug: string;
  room: RoomSummary;
  refusal?: ErrorCode;
  expired?: boolean;
  onEnter: (entry: JoinEntry) => void;
};

/** A room's doorway: a name and one button, plus the code of a private room that exists. A room about to be created is named by its address and shows its access right there. Entering moves the page forward. */
export function EntryForm({ slug, room, refusal, expired, onEnter }: EntryFormProps) {
  const t = useT();
  const services = useServices();
  const creating = !room.exists;
  const [invite] = useState(() => services.invite.read());
  const [kept] = useState(() => services.passMemory.read(slug));
  const [stored, setStored] = useState(kept);
  const [photo, setPhoto] = useState(() => kept?.face || undefined);
  const [passId, setPassId] = useState(() => kept?.pass);
  const [name, setName] = useState(() => kept?.name || services.nameMemory.read());
  const [access, setAccess] = useState<Access>(() => (creating && (services.readPasswordHash() || kept?.private) ? "private" : "public"));
  const [listed, setListed] = useState(invite.listed ?? kept?.listed ?? false);
  const [code, setCode] = useState(() => (creating ? services.readPasswordHash() || services.generatePassword() : services.readPasswordHash()));
  useEffect(() => {
    services.invite.forget();
    if (!invite.pass) return;
    let current = true;
    void services.takePass(invite.pass).then((pass) => {
      if (!current || !pass) return;
      services.nameMemory.write(pass.name);
      const fresh = { pass: invite.pass, name: pass.name, face: pass.face, private: pass.private, listed: pass.listed };
      services.passMemory.write(slug, fresh);
      setStored(fresh);
      setPassId(invite.pass);
      setName(pass.name);
      setPhoto(pass.face || undefined);
      if (creating) {
        setAccess(pass.private ? "private" : "public");
        setListed(pass.listed);
      }
    });
    return () => {
      current = false;
    };
  }, [services, invite, creating, slug]);
  const [problems, setProblems] = useState<{ name?: string; code?: string }>({});
  const [working, setWorking] = useState(false);
  const formId = useId();
  const needsCode = creating ? access === "private" : room.private;
  const full = room.exists && room.count >= room.capacity;

  const submitButton = (
    <button type="submit" form={formId} disabled={working || full} className={`${button()} w-full gap-2`}>
      {working ? t("entry.working") : creating ? t("entry.submitCreate") : t("entry.submitJoin")}
      <Arrow />
    </button>
  );

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
    if (passId && stored) services.passMemory.write(slug, { ...stored, pass: passId, name: who.name });
    const derived = needsCode ? await services.derive(code.trim(), slug) : undefined;
    services.forgetHash();
    const entry: JoinEntry = {
      name: who.name,
      look: services.lookMemory.read(),
      face: services.faceMemory.read(),
      ...(photo ? { photo } : {}),
      ...(passId ? { pass: passId } : {}),
      ...(derived ? { verifier: derived.verifier, password: code.trim() } : {}),
      ...(creating ? { listed } : {}),
    };
    withMotion("forward", () => onEnter(entry));
    setWorking(false);
  }

  return (
    <form id={formId} aria-labelledby={`${formId}-title`} onSubmit={(event) => void submit(event)} noValidate className="w-full max-w-md">
      <h2 id={`${formId}-title`} className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">
        <span className="block truncate" translate="no">
          {creating ? t("entry.createTitle") : t("entry.joinTitle")}{" "}
          <span className="bubble-word inline-block max-w-full truncate bg-bubble px-3 py-0.5 align-bottom font-mono text-[0.8em] tracking-normal text-on-bubble" translate="no">
            {slug}
          </span>
        </span>
      </h2>
      <p className="mt-2 mb-4 text-muted lg:mb-6">{creating ? t("entry.createIntro") : full ? t("entry.joinFull", { count: room.count, capacity: room.capacity }) : t("entry.joinPeople", { count: room.count, capacity: room.capacity })}</p>
      {expired ? <p className="bubble mb-5 border border-line-strong bg-card p-4 text-sm">{t("ended.expired.body")}</p> : null}

      <Field
        label={t("entry.nameLabel")}
        hint={t("home.nameHint")}
        error={problems.name}
        className="mb-3 lg:mb-5"
        value={name}
        autoComplete="nickname"
        maxLength={40}
        onChange={(event) => {
          setName(event.target.value);
          setProblems(({ code: kept }) => (kept ? { code: kept } : {}));
        }}
      />

      {!creating && room.private ? (
        <Field
          label={t("entry.passwordLabel")}
          hint={t("entry.passwordJoinHint")}
          error={problems.code}
          mono
          large
          value={code}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          onChange={(event) => {
            setCode(event.target.value);
            setProblems(({ name: kept }) => (kept ? { name: kept } : {}));
          }}
        />
      ) : null}

      <p role="alert" className="mt-1 mb-1 min-h-6 text-sm text-amber lg:mt-2">
        {refusal ? t(`refused.${refusal}`) : ""}
      </p>
      {creating ? (
        <div className="mb-5 flex flex-col">
          <AccessSettings access={access} onAccess={setAccess} listed={listed} onListed={setListed} code={code} onRenew={() => setCode(services.generatePassword())} />
        </div>
      ) : null}
      {submitButton}
      <p className="mt-4 text-xs text-muted">
        {t("entry.privacy")}{" "}
        <a href="/privacy" target="_blank" rel="noopener" className={QUIET_LINK}>
          {t("entry.privacyLink")}
        </a>
      </p>
    </form>
  );
}
