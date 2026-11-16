import { useId, useState, type FormEvent, type ReactNode } from "react";

import { checkName } from "../domain/name";
import { checkSlug, normalizeSlug } from "../domain/slug";
import { useT } from "../i18n/I18nProvider";
import { AppLink, useNavigate } from "../routing/Navigation";
import { LobbyPage } from "../lobby/LobbyPage";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";
import { Social } from "../ui/Social";
import { FIELD, button } from "../ui/styles";
import { Wordmark } from "../ui/Wordmark";

const SWAP = "transition-colors duration-700";

function Said({ mine = false, live = false, children }: { mine?: boolean; live?: boolean; children: ReactNode }) {
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <span
        className={`inline-flex max-w-[22rem] items-center gap-2 border px-4 py-2.5 text-[0.9375rem] leading-snug ${SWAP} ${
          mine
            ? "rounded-[1.25rem] rounded-br-[0.3rem] border-transparent bg-paper font-mono text-sm text-ink group-data-[view=lobby]:bg-bubble"
            : "bubble border-transparent bg-ink text-paper group-data-[view=lobby]:border-line-strong group-data-[view=lobby]:bg-card"
        }`}
      >
        {live ? <span aria-hidden="true" className="pulse size-2 shrink-0 rounded-full bg-ink" /> : null}
        {children}
      </span>
    </li>
  );
}

function Pitch() {
  const t = useT();
  const host = new URL(useServices().origin).host;
  return (
    <section className={`no-scrollbar relative flex flex-col bg-bubble px-6 py-8 text-ink lg:min-h-0 lg:overflow-y-auto group-data-[view=lobby]:bg-canvas group-data-[view=lobby]:text-paper sm:px-10 lg:w-1/2 lg:bg-transparent lg:px-14 lg:py-10 lg:group-data-[view=lobby]:bg-transparent ${SWAP}`}>
      <AppLink href="/" aria-label={t("app.home")} className="self-start">
        <Wordmark onAccent className="text-lg" />
      </AppLink>
      <div className="flex flex-1 flex-col justify-center py-12 lg:py-0">
        <h1 className="font-display text-[2.5rem] leading-[1.04] font-bold tracking-[-0.04em] sm:text-5xl xl:text-6xl">
          <span className="block">{t("home.line1")}</span>
          <span className="block">{t("home.line2")}</span>
          <span className={`bubble-word mt-[0.34em] inline-block bg-ink px-[0.5em] py-[0.24em] font-mono text-[0.42em] leading-[1.15] font-medium tracking-[-0.02em] text-bubble group-data-[view=lobby]:bg-bubble group-data-[view=lobby]:text-ink ${SWAP}`}>
            {t("home.answer")}
          </span>
        </h1>
        <ul aria-hidden="true" className="mt-12 hidden max-w-md flex-col gap-2.5 sm:flex">
          <Said>{t("home.chat1")}</Said>
          <Said mine>
            <span translate="no">{t("home.chat2", { host })}</span>
          </Said>
          <Said>{t("home.chat3")}</Said>
          <Said mine live>
            {t("home.chat4")}
          </Said>
        </ul>
      </div>
    </section>
  );
}

const SEGMENT = "relative z-10 h-full flex-1 rounded-full text-sm font-semibold text-muted transition-colors duration-300 hover:text-fg aria-pressed:text-canvas";
const CHOICE =
  "relative z-10 flex cursor-pointer flex-col gap-1 rounded-[1.25rem] px-4 py-3.5 text-left text-fg transition-colors duration-300 has-checked:text-on-bubble has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg/55";

type Access = "public" | "private";

function RoomCode({ code, onRenew }: { code: string; onRenew: () => void }) {
  const t = useT();
  const { clipboard } = useServices();
  const [copied, setCopied] = useState(false);
  return (
    <div className="bubble flex items-center justify-between gap-3 bg-ink py-3 pr-3 pl-5 text-paper">
      <output aria-label={t("entry.passwordLabel")} className="font-mono text-2xl font-bold tracking-[0.12em]" translate="no">
        {code}
      </output>
      <span className="flex gap-1.5">
        <button
          type="button"
          className="h-8 rounded-full border border-paper/25 px-3 text-xs font-semibold transition-colors duration-200 hover:border-paper/60"
          onClick={() => void clipboard.write(code).then((done) => setCopied(done))}
        >
          {copied ? t("entry.copied") : t("entry.copy")}
        </button>
        <button
          type="button"
          className="h-8 rounded-full border border-paper/25 px-3 text-xs font-semibold transition-colors duration-200 hover:border-paper/60"
          onClick={() => {
            setCopied(false);
            onRenew();
          }}
        >
          {t("home.newCode")}
        </button>
      </span>
    </div>
  );
}

function EnterRoom() {
  const t = useT();
  const navigate = useNavigate();
  const services = useServices();
  const { origin, nameMemory } = services;
  const id = useId();
  const [pane, setPane] = useState<"room" | "settings">("room");
  const [name, setName] = useState(() => nameMemory.read());
  const [room, setRoom] = useState("");
  const [access, setAccess] = useState<Access>("public");
  const [locked, setLocked] = useState(true);
  const [code, setCode] = useState(() => services.generatePassword());
  const [problems, setProblems] = useState<{ name?: string; room?: string }>({});
  const [working, setWorking] = useState(false);
  const withPassword = access === "private" && locked;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const slug = checkSlug(normalizeSlug(room));
    const who = checkName(name);
    if (!slug.ok || !who.ok) {
      setProblems({ ...(who.ok ? {} : { name: t(`entry.name.${who.problem}`) }), ...(slug.ok ? {} : { room: t(`slug.${slug.problem}`) }) });
      setPane("room");
      return;
    }
    setWorking(true);
    nameMemory.write(who.name);
    const derived = withPassword ? await services.derive(code, slug.slug) : undefined;
    services.entryIntent.put(slug.slug, {
      name: who.name,
      listed: access === "public",
      ...(derived ? { verifier: derived.verifier, password: code } : {}),
    });
    navigate(`/${slug.slug}`);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="w-full max-w-md">
      <h2 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">{t("home.formTitle")}</h2>
      <p className="mt-2 mb-7 text-muted">{t("home.formIntro")}</p>

      <div role="group" aria-label={t("home.paneLabel")} data-pane={pane} className="group/pill relative mb-7 flex h-11 rounded-full border border-line-strong p-1">
        <span aria-hidden="true" className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-fg transition-transform duration-500 ease-(--ease-glide) group-data-[pane=settings]/pill:translate-x-full" />
        <button type="button" aria-pressed={pane === "room"} className={SEGMENT} onClick={() => setPane("room")}>
          {t("home.paneRoom")}
        </button>
        <button type="button" aria-pressed={pane === "settings"} className={SEGMENT} onClick={() => setPane("settings")}>
          {t("home.paneSettings")}
        </button>
      </div>

      <div className="-mx-1 overflow-hidden px-1">
        <div data-pane={pane} className="flex w-[200%] transition-transform duration-500 ease-(--ease-glide) data-[pane=settings]:-translate-x-1/2">
          <div inert={pane !== "room"} className="w-1/2 pr-4 transition-opacity duration-300 inert:opacity-0">
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
                setProblems(({ room: kept }) => (kept ? { room: kept } : {}));
              }}
            />
            <p id={`${id}-name-note`} className={`mt-1.5 mb-5 min-h-5 text-sm ${problems.name ? "text-amber" : "text-muted"}`}>
              {problems.name ?? t("home.nameHint")}
            </p>

            <label htmlFor={`${id}-room`} className="text-sm font-semibold">
              {t("lobby.goLabel")}
            </label>
            <div className="mt-1.5 flex h-11 items-center rounded-xl border border-muted-light bg-canvas pl-3.5 transition-colors duration-200 focus-within:border-fg/50 has-aria-invalid:border-amber">
              <span aria-hidden="true" className="shrink-0 font-mono text-sm text-muted select-none" translate="no">
                <span className="hidden min-[26rem]:inline">{new URL(origin).host}</span>/
              </span>
              <input
                id={`${id}-room`}
                value={room}
                placeholder={t("lobby.goPlaceholder")}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={problems.room ? true : undefined}
                aria-describedby={`${id}-room-note`}
                className="h-full min-w-0 flex-1 bg-transparent pr-3.5 pl-0.5 font-mono text-sm text-fg placeholder:text-muted-light focus-visible:outline-none"
                onChange={(event) => {
                  setRoom(event.target.value);
                  setProblems(({ name: kept }) => (kept ? { name: kept } : {}));
                }}
              />
            </div>
            <p id={`${id}-room-note`} className={`mt-1.5 min-h-5 text-sm ${problems.room ? "text-amber" : "text-muted"}`}>
              {problems.room ?? t("home.addressHint")}
            </p>
          </div>

          <div inert={pane !== "settings"} className="w-1/2 pl-4 transition-opacity duration-300 inert:opacity-0">
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">{t("entry.accessLegend")}</legend>
              <div data-access={access} className="group/access relative grid grid-cols-2 rounded-[1.5rem] border border-fg/30 bg-card p-1">
                <span aria-hidden="true" className="bubble absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] bg-bubble transition-transform duration-500 ease-(--ease-glide) group-data-[access=private]/access:translate-x-full" />
                {(["public", "private"] as const).map((option) => (
                  <label key={option} className={CHOICE}>
                    <input type="radio" name={`${id}-access`} className="sr-only" checked={access === option} onChange={() => setAccess(option)} />
                    <span className="font-display text-lg leading-none font-bold tracking-[-0.03em]">{t(option === "public" ? "entry.accessPublic" : "entry.accessPrivate")}</span>
                    <span className="text-[0.8125rem] leading-snug opacity-75">{t(option === "public" ? "home.publicHint" : "home.privateHint")}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div key={access} className="swap-in mt-5 flex h-[7.25rem] flex-col justify-start gap-3">
              {access === "private" ? (
                <>
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
                    {t("home.lock")}
                    <input type="checkbox" role="switch" checked={locked} onChange={(event) => setLocked(event.target.checked)} className="peer sr-only" />
                    <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-line-strong transition-colors duration-300 peer-checked:bg-bubble peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-fg/55 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-paper after:transition-transform after:duration-300 peer-checked:after:translate-x-5 peer-checked:after:bg-ink" />
                  </label>
                  {locked ? <RoomCode code={code} onRenew={() => setCode(services.generatePassword())} /> : <p className="text-sm text-muted">{t("home.unlockedHint")}</p>}
                </>
              ) : (
                <p className="text-sm text-muted">{t("home.publicNote")}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <button type="submit" disabled={working} className={`${button()} mt-6 w-full gap-2`}>
        {working ? t("entry.working") : t("lobby.goButton")}
        <Arrow />
      </button>
      <p className="mt-3 text-center text-sm text-muted">{t("home.settingsNote")}</p>
    </form>
  );
}

/** The home, in two halves: what the product is, told as a conversation, and a panel on the right. The panel is the form that takes you into a room, the open rooms (the lime half slides across and they arrive on it), or whatever a room needs to ask before letting someone in. */
export function HomePage({ view = "home", panel }: { view?: "home" | "lobby" | "entry"; panel?: ReactNode }) {
  const t = useT();
  const lobby = view === "lobby";
  return (
    <div data-view={view} className="group relative isolate flex flex-1 flex-col overflow-hidden bg-canvas lg:min-h-0 lg:flex-row">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 hidden w-[150%] transition-transform duration-700 ease-(--ease-glide) group-data-[view=lobby]:-translate-x-1/3 lg:flex">
        <div className="relative w-1/3 bg-bubble">
          <div className="backdrop-glow absolute inset-0" />
          <div className="backdrop-grid-ink absolute inset-0" />
        </div>
        <div className="w-1/3 bg-canvas" />
        <div className="relative w-1/3 bg-bubble">
          <div className="backdrop-glow absolute inset-0" />
          <div className="backdrop-grid-ink absolute inset-0" />
        </div>
      </div>
      <Pitch />
      <div className={`no-scrollbar relative flex flex-1 flex-col px-6 py-8 group-data-[view=lobby]:bg-bubble sm:px-10 lg:min-h-0 lg:overflow-y-auto lg:py-10 lg:group-data-[view=lobby]:bg-transparent ${SWAP}`}>
        <Social className="justify-end" />
        <div className="relative flex flex-1 items-center justify-center py-8">
          {view === "entry" ? (
            <div className="arrive flex w-full justify-center">{panel}</div>
          ) : (
            <div inert={lobby} className="flex w-full justify-center transition-[translate,opacity] duration-500 ease-(--ease-glide) group-data-[view=lobby]:pointer-events-none group-data-[view=lobby]:-translate-x-24 group-data-[view=lobby]:opacity-0 max-lg:group-data-[view=lobby]:hidden">
              <EnterRoom />
            </div>
          )}
          {lobby ? (
            <div className="ride-in flex w-full justify-center lg:absolute lg:inset-0 lg:items-start lg:pt-[6vh]">
              <LobbyPage />
            </div>
          ) : null}
        </div>
        {view === "entry" ? null : (
          <AppLink
            href={lobby ? "/" : "/lobby"}
            className="mx-auto inline-flex h-10 w-56 shrink-0 items-center justify-center gap-2 rounded-full border border-line-strong text-sm font-semibold text-muted transition-colors duration-500 hover:border-fg/50 hover:text-fg group-data-[view=lobby]:border-ink group-data-[view=lobby]:bg-ink group-data-[view=lobby]:text-paper group-data-[view=lobby]:hover:opacity-85"
          >
            {lobby ? <Arrow back /> : null}
            {t(lobby ? "lobby.back" : "home.seeRooms")}
            {lobby ? null : <Arrow />}
          </AppLink>
        )}
      </div>
    </div>
  );
}
