import { useState, type FormEvent } from "react";

import { checkName } from "../domain/name";
import { roomFromLink, shareLink } from "../domain/share-link";
import { checkSlug, normalizeSlug, randomSlug } from "../domain/slug";
import { useT } from "../i18n/I18nProvider";
import { useNavigate } from "../routing/Navigation";
import { AccessSettings, type Access } from "../room/AccessSettings";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";
import { Disclosure } from "../ui/Disclosure";
import { Field } from "../ui/Field";
import { button } from "../ui/styles";

/** The home's panel: one button that creates a room with nothing typed, the room's name and settings one click away, and a field that joins a room from its link or name. */
export function EnterRoom() {
  const t = useT();
  const navigate = useNavigate();
  const services = useServices();
  const { origin, nameMemory } = services;
  const host = new URL(origin).host;
  const [more, setMore] = useState(false);
  const [name, setName] = useState(() => nameMemory.read());
  const [room, setRoom] = useState("");
  const [access, setAccess] = useState<Access>("public");
  const [listed, setListed] = useState(true);
  const [code, setCode] = useState(() => services.generatePassword());
  const [problems, setProblems] = useState<{ name?: string; room?: string }>({});
  const [working, setWorking] = useState(false);
  const [link, setLink] = useState("");
  const [linkProblem, setLinkProblem] = useState<string | undefined>();
  const withPassword = access === "private";

  async function create(event: FormEvent) {
    event.preventDefault();
    const where = checkSlug(room.trim() === "" ? randomSlug() : normalizeSlug(room));
    const who = checkName(name);
    const askAtTheDoor = !who.ok && who.problem === "empty" && !withPassword && listed;
    if (!where.ok || (!who.ok && !askAtTheDoor)) {
      setProblems({ ...(who.ok ? {} : { name: t(`entry.name.${who.problem}`) }), ...(where.ok ? {} : { room: t(`slug.${where.problem}`) }) });
      setMore(true);
      return;
    }
    if (!who.ok) {
      navigate(`/${where.slug}`);
      return;
    }
    setWorking(true);
    nameMemory.write(who.name);
    const derived = withPassword ? await services.derive(code, where.slug) : undefined;
    services.entryIntent.put(where.slug, {
      name: who.name,
      look: services.lookMemory.read(),
      face: services.faceMemory.read(),
      listed,
      ...(derived ? { verifier: derived.verifier, password: code } : {}),
    });
    navigate(`/${where.slug}`);
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const { slug, password } = roomFromLink(link);
    if (!slug.ok) {
      setLinkProblem(t(`slug.${slug.problem}`));
      return;
    }
    navigate(shareLink("", slug.slug, password || undefined));
  }

  return (
    <div className="w-full max-w-md">
      <form onSubmit={(event) => void create(event)} noValidate>
        <h2 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">{t("home.formTitle")}</h2>
        <p className="mt-2 mb-7 text-muted">{t("home.formIntro")}</p>
        <button type="submit" disabled={working} className={`${button({ variant: "accent", size: "lg" })} w-full gap-2`}>
          {working ? t("entry.working") : t("home.create")}
          <Arrow />
        </button>
        <Disclosure label={t("more.label")} open={more} onOpen={setMore} className="mt-3">
          <Field
            label={t("entry.nameLabel")}
            hint={t("home.nameHint")}
            error={problems.name}
            className="mb-3"
            value={name}
            autoComplete="nickname"
            maxLength={40}
            onChange={(event) => {
              setName(event.target.value);
              setProblems(({ room: kept }) => (kept ? { room: kept } : {}));
            }}
          />
          <Field
            label={t("lobby.goLabel")}
            hint={t("home.addressHint")}
            error={problems.room}
            className="mb-3"
            mono
            prefix={
              <>
                <span className="hidden min-[26rem]:inline">{host}</span>/
              </>
            }
            value={room}
            placeholder={t("lobby.goPlaceholder")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setRoom(event.target.value);
              setProblems(({ name: kept }) => (kept ? { name: kept } : {}));
            }}
          />
          <AccessSettings access={access} onAccess={setAccess} listed={listed} onListed={setListed} code={code} onRenew={() => setCode(services.generatePassword())} />
          <p className="mt-4 text-sm text-muted">{t("home.settingsNote")}</p>
        </Disclosure>
      </form>

      <form onSubmit={join} noValidate className="mt-8 border-t border-line pt-7">
        <h2 className="font-display text-xl leading-tight font-bold tracking-[-0.03em]">{t("home.joinTitle")}</h2>
        <div className="mt-3 flex items-start gap-2">
          <Field
            label={t("home.joinLabel")}
            error={linkProblem}
            className="min-w-0 flex-1"
            mono
            value={link}
            placeholder={t("home.joinPlaceholder", { host })}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setLink(event.target.value);
              setLinkProblem(undefined);
            }}
          />
          <button type="submit" className={`${button({ variant: "secondary" })} mt-6.5`}>
            {t("lobby.goButton")}
          </button>
        </div>
      </form>
    </div>
  );
}
