import { useId, useState, type FormEvent } from "react";

import type { RoomSummary } from "../api/rooms";
import { checkName } from "../domain/name";
import { checkSlug, normalizeSlug } from "../domain/slug";
import { useT } from "../i18n/I18nProvider";
import { useNavigate } from "../routing/Navigation";
import { useServices } from "../services";
import type { ErrorCode } from "../signal/protocol";
import type { JoinEntry } from "../session/session";
import { Arrow } from "../ui/Arrow";
import { Field } from "../ui/Field";
import { withMotion } from "../ui/motion";
import { OptionsPane, useOptionsPane } from "../ui/OptionsPane";
import { button } from "../ui/styles";
import { AccessSettings, type Access } from "./AccessSettings";

type EntryFormProps = {
  slug: string;
  room: RoomSummary;
  refusal?: ErrorCode;
  expired?: boolean;
  onEnter: (entry: JoinEntry) => void;
};

/** A room's doorway: a name and one button, plus the code of a private room that exists. A room about to be created keeps its name and access in a pane under More options, the name filled in from the address; changing it opens the room of the name typed. Entering moves the page forward. */
export function EntryForm({ slug, room, refusal, expired, onEnter }: EntryFormProps) {
  const t = useT();
  const services = useServices();
  const navigate = useNavigate();
  const creating = !room.exists;
  const [roomName, setRoomName] = useState(slug);
  const [name, setName] = useState(() => services.nameMemory.read());
  const [access, setAccess] = useState<Access>("public");
  const [listed, setListed] = useState(true);
  const [code, setCode] = useState(() => (creating ? services.generatePassword() : services.readPasswordHash()));
  const [problems, setProblems] = useState<{ name?: string; code?: string; room?: string }>({});
  const [working, setWorking] = useState(false);
  const more = useOptionsPane();
  const formId = useId();
  const needsCode = creating ? access === "private" : room.private;
  const full = room.exists && room.count >= room.capacity;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const who = checkName(name);
    const missingCode = needsCode && code.trim() === "";
    const where = creating ? checkSlug(normalizeSlug(roomName)) : ({ ok: true, slug } as const);
    if (!who.ok || missingCode || !where.ok) {
      setProblems({ ...(who.ok ? {} : { name: t(`entry.name.${who.problem}`) }), ...(missingCode ? { code: t("password.required") } : {}), ...(where.ok ? {} : { room: t(`slug.${where.problem}`) }) });
      if (!where.ok) more.show();
      return;
    }
    setWorking(true);
    services.nameMemory.write(who.name);
    const derived = needsCode ? await services.derive(code.trim(), where.slug) : undefined;
    services.forgetHash();
    const enter = (entry: JoinEntry) => {
      if (where.slug === slug) return onEnter(entry);
      services.entryIntent.put(where.slug, entry);
      navigate(`/${where.slug}`);
    };
    const entry: JoinEntry = {
      name: who.name,
      look: services.lookMemory.read(),
      face: services.faceMemory.read(),
      ...(derived ? { verifier: derived.verifier, password: code.trim() } : {}),
      ...(creating ? { listed } : {}),
    };
    withMotion("forward", () => enter(entry));
    setWorking(false);
  }

  return (
    <form id={formId} onSubmit={(event) => void submit(event)} noValidate className="w-full max-w-md">
      <h2 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">
        <span className="block truncate" translate="no">
          {creating ? t("entry.createTitle") : t("entry.joinTitle")}{" "}
          <span className="bubble-word inline-block max-w-full truncate bg-bubble px-3 py-0.5 align-bottom font-mono text-[0.8em] tracking-normal text-on-bubble" translate="no">
            {creating ? normalizeSlug(roomName) || slug : slug}
          </span>
        </span>
      </h2>
      <p className="mt-2 mb-6 text-muted">{creating ? t("entry.createIntro") : full ? t("entry.joinFull", { count: room.count, capacity: room.capacity }) : t("entry.joinPeople", { count: room.count, capacity: room.capacity })}</p>
      {expired ? <p className="bubble mb-5 border border-line-strong bg-card p-4 text-sm">{t("ended.expired.body")}</p> : null}

      <Field
        label={t("entry.nameLabel")}
        hint={t("home.nameHint")}
        error={problems.name}
        className="mb-5"
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

      <p role="alert" className="mt-2 min-h-6 text-sm text-amber">
        {refusal ? t(`refused.${refusal}`) : ""}
      </p>
      <button type="submit" disabled={working || full} className={`${button()} mt-1 w-full gap-2`}>
        {working ? t("entry.working") : creating ? t("entry.submitCreate") : t("entry.submitJoin")}
        <Arrow />
      </button>
      {creating ? (
        <OptionsPane control={more} label={t("more.label")} back={t("home.back")} className="mt-3">
          <Field
            form={formId}
            label={t("lobby.goLabel")}
            hint={t("entry.roomHint")}
            error={problems.room}
            mono
            className="mb-3"
            prefix={
              <>
                <span className="hidden min-[26rem]:inline">{new URL(services.origin).host}</span>/
              </>
            }
            value={roomName}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={40}
            onChange={(event) => {
              setRoomName(event.target.value);
              setProblems(({ room: _gone, ...kept }) => kept);
            }}
          />
          <AccessSettings access={access} onAccess={setAccess} listed={listed} onListed={setListed} code={code} onRenew={() => setCode(services.generatePassword())} />
        </OptionsPane>
      ) : null}
    </form>
  );
}
