import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { withIris } from "../ui/motion";

import { checkName } from "../domain/name";
import { checkSlug, normalizeSlug } from "../domain/slug";
import { useChooseLocale, useT } from "../i18n/I18nProvider";
import { PROJECT_LINKS } from "../project/project-store";
import { AppLink, useNavigate } from "../routing/Navigation";
import { LobbyPage } from "../lobby/LobbyPage";
import { AccessSettings, type Access } from "../room/AccessSettings";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";
import { CommandPalette } from "../ui/CommandPalette";
import { Social } from "../ui/Social";
import { Field } from "../ui/Field";
import { CONVEYOR_LINK, button } from "../ui/styles";
import { Wordmark } from "../ui/Wordmark";
import { Segmented } from "../ui/Segmented";

const SWAP = "transition-colors duration-700";

function Said({ mine = false, live = false, children }: { mine?: boolean; live?: boolean; children: ReactNode }) {
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <span
        className={`inline-flex max-w-[22rem] items-center gap-2 border px-4 py-2.5 text-[0.9375rem] leading-snug ${SWAP} ${
          mine
            ? "bubble-sent border-transparent bg-paper font-mono text-sm text-ink group-data-[view=lobby]:bg-bubble"
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

function EnterRoom() {
  const t = useT();
  const navigate = useNavigate();
  const services = useServices();
  const { origin, nameMemory } = services;
  const [pane, setPane] = useState<"room" | "settings">("room");
  const [name, setName] = useState(() => nameMemory.read());
  const [room, setRoom] = useState("");
  const [access, setAccess] = useState<Access>("public");
  const [listed, setListed] = useState(true);
  const [code, setCode] = useState(() => services.generatePassword());
  const [problems, setProblems] = useState<{ name?: string; room?: string }>({});
  const [working, setWorking] = useState(false);
  const withPassword = access === "private";

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
      look: services.lookMemory.read(),
      face: services.faceMemory.read(),
      listed,
      ...(derived ? { verifier: derived.verifier, password: code } : {}),
    });
    navigate(`/${slug.slug}`);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="w-full max-w-md">
      <h2 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">{t("home.formTitle")}</h2>
      <p className="mt-2 mb-7 text-muted">{t("home.formIntro")}</p>

      <Segmented<"room" | "settings">
        label={t("home.paneLabel")}
        value={pane}
        onChange={setPane}
        className="mb-7 h-11"
        options={[
          { value: "room", text: t("home.paneRoom") },
          { value: "settings", text: t("home.paneSettings") },
        ]}
      />

      <div className="-mx-1 overflow-hidden px-1">
        <div data-pane={pane} className="flex w-[200%] transition-transform duration-500 ease-(--ease-glide) data-[pane=settings]:-translate-x-1/2">
          <div inert={pane !== "room"} className="w-1/2 pr-4 transition-opacity duration-300 inert:opacity-0">
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
                setProblems(({ room: kept }) => (kept ? { room: kept } : {}));
              }}
            />
            <Field
              label={t("lobby.goLabel")}
              hint={t("home.addressHint")}
              error={problems.room}
              mono
              prefix={
                <>
                  <span className="hidden min-[26rem]:inline">{new URL(origin).host}</span>/
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
          </div>

          <div inert={pane !== "settings"} className="w-1/2 pl-4 transition-opacity duration-300 inert:opacity-0">
            <AccessSettings access={access} onAccess={setAccess} listed={listed} onListed={setListed} code={code} onRenew={() => setCode(services.generatePassword())} />
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
  const [track, setTrack] = useState({ view, stop: view === "lobby" ? 1 : 0 });
  const [leavingDoorway, setLeavingDoorway] = useState(false);
  const doorway = useRef<ReactNode>(null);
  if (view === "entry") doorway.current = panel;
  let stop = track.stop;
  if (track.view !== view) {
    stop = view === "lobby" ? 1 : view === "entry" && track.view === "lobby" ? 2 : 0;
    setTrack({ view, stop });
    setLeavingDoorway(track.view === "entry");
  }
  const back = leavingDoorway && view !== "entry";
  const [palette, setPalette] = useState(false);
  const { theme } = useServices();
  const navigate = useNavigate();
  const choose = useChooseLocale();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setPalette((open) => !open);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const lobby = view === "lobby";
  const leftLobby = view === "entry" && stop === 2;
  const HIDDEN = "pointer-events-none -translate-x-24 opacity-0";

  return (
    <div data-view={view} data-stop={stop} className="group relative isolate flex flex-1 flex-col overflow-hidden bg-canvas lg:min-h-0 lg:flex-row">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 hidden w-[200%] transition-transform duration-700 ease-(--ease-glide) group-data-[stop=1]:-translate-x-1/4 group-data-[stop=2]:-translate-x-1/2 lg:flex">
        {[0, 1].map((pair) => (
          <div key={pair} className="flex w-1/2">
            <div className="relative w-1/2 bg-bubble">
              <div className="backdrop-glow absolute inset-0" />
              <div className="backdrop-grid-ink absolute inset-0" />
            </div>
            <div className="w-1/2 bg-canvas" />
          </div>
        ))}
      </div>
      {palette ? (
        <CommandPalette
          onClose={() => setPalette(false)}
          commands={[
            { id: "home", group: t("palette.group.site"), label: t("palette.home"), run: () => navigate("/") },
            { id: "rooms", group: t("palette.group.site"), label: t("palette.rooms"), run: () => navigate("/lobby") },
            { id: "github", group: t("palette.group.site"), label: t("palette.github"), run: () => void window.open(PROJECT_LINKS.repo, "_blank", "noreferrer") },
            { id: "x", group: t("palette.group.site"), label: t("palette.x"), run: () => void window.open(PROJECT_LINKS.x, "_blank", "noreferrer") },
            { id: "theme", group: t("palette.group.site"), label: t(theme.getSnapshot() === "dark" ? "theme.toLight" : "theme.toDark"), run: () => withIris({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, theme.toggle) },
            { id: "en", group: t("palette.group.language"), label: "English", run: () => choose("en") },
            { id: "pt", group: t("palette.group.language"), label: "Português", run: () => choose("pt-BR") },
          ]}
        />
      ) : null}
      <Pitch />
      <div className={`no-scrollbar relative flex flex-1 flex-col px-6 py-8 group-data-[view=lobby]:bg-bubble sm:px-10 lg:min-h-0 lg:overflow-y-auto lg:py-10 lg:group-data-[view=lobby]:bg-transparent ${SWAP}`}>
        <Social className="justify-end" />
        <div className="relative flex flex-1 items-center justify-center py-8">
          {view === "entry" ? null : (
            <div inert={view !== "home"} className={`flex w-full justify-center transition-[translate,opacity] duration-500 ease-(--ease-glide) ${back && view === "home" ? "slide-in-left" : ""} ${view === "home" ? "" : `${HIDDEN} max-lg:hidden`}`}>
              <EnterRoom />
            </div>
          )}
          {lobby || leftLobby ? (
            <div inert={!lobby} className={`ride-in flex w-full justify-center transition-[translate,opacity] duration-500 ease-(--ease-glide) lg:absolute lg:inset-0 lg:items-start lg:pt-[6vh] ${lobby ? "" : `${HIDDEN} max-lg:hidden`}`}>
              <LobbyPage active={lobby} />
            </div>
          ) : null}
          {view === "entry" || back ? (
            <div
              inert={view !== "entry"}
              className={`no-scrollbar flex w-full lg:absolute lg:inset-0 lg:overflow-y-auto ${view === "entry" ? "ride-in" : "slide-out-right max-lg:hidden"}`}
              onAnimationEnd={() => {
                if (view !== "entry") setLeavingDoorway(false);
              }}
            >
              <div className="m-auto flex w-full justify-center py-2">{view === "entry" ? panel : doorway.current}</div>
            </div>
          ) : null}
        </div>
        <AppLink
          href={lobby ? "/" : view === "entry" ? (leftLobby ? "/lobby" : "/") : "/lobby"}
          className={CONVEYOR_LINK}
        >
          {view === "home" ? null : <Arrow back />}
          {t(lobby ? "lobby.back" : view === "entry" ? "home.back" : "home.seeRooms")}
          {view === "home" ? <Arrow /> : null}
        </AppLink>
      </div>
    </div>
  );
}
