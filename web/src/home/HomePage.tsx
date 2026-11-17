import { useEffect, useRef, useState, type ReactNode } from "react";
import { withIris } from "../ui/motion";

import { useChooseLocale, useT } from "../i18n/I18nProvider";
import { PROJECT_LINKS } from "../project/project-store";
import { AppLink, useNavigate } from "../routing/Navigation";
import { LobbyPage } from "../lobby/LobbyPage";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";
import { CommandPalette } from "../ui/CommandPalette";
import { OptionsPlaceContext, type OptionsPlace } from "../ui/OptionsPane";
import { Social } from "../ui/Social";
import { CONVEYOR_LINK } from "../ui/styles";
import { Wordmark } from "../ui/Wordmark";
import { EnterRoom } from "./EnterRoom";

const SWAP = "transition-colors duration-700";
const CONVEY = "transition-[color,background-color,border-color,translate] duration-700 ease-(--ease-glide) group-data-[more]:transition-[color,background-color,border-color,translate,visibility]";
const LEAVE_RIGHT = "slide-out-right max-lg:hidden";

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
    <section className={`no-scrollbar relative flex shrink-0 flex-col bg-bubble px-6 py-5 text-ink group-data-[more]:invisible group-data-[view=lobby]:bg-canvas group-data-[view=lobby]:text-paper sm:px-10 lg:min-h-0 lg:w-1/2 lg:overflow-y-auto lg:bg-transparent lg:px-14 lg:py-10 lg:group-data-[more]:-translate-x-full lg:group-data-[view=lobby]:bg-transparent ${CONVEY}`}>
      <AppLink href="/" aria-label={t("app.home")} className="self-start">
        <Wordmark onAccent className="text-lg" />
      </AppLink>
      <div className="flex flex-1 flex-col justify-center pt-4 lg:py-0">
        <h1 className="font-display text-[2rem] leading-[1.04] min-[380px]:text-[2.25rem] font-bold tracking-[-0.04em] sm:text-5xl xl:text-6xl">
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

/** The home, in two halves: what the product is, told as a conversation, and a panel on the right. The panel is the form that takes you into a room, the open rooms (the lime half slides across and they arrive on it), or whatever a room needs to ask before letting someone in. A form's options push the page one more stop: the form takes the left half and its options the right (on a phone they cover the page). */
export function HomePage({ view = "home", panel }: { view?: "home" | "lobby" | "entry"; panel?: ReactNode }) {
  const t = useT();
  const [track, setTrack] = useState({ view, stop: view === "lobby" ? 1 : 0 });
  const [leaving, setLeaving] = useState<"lobby" | "entry" | undefined>();
  const [more, setMore] = useState(false);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const doorway = useRef<ReactNode>(null);
  if (view === "entry") doorway.current = panel;
  let stop = track.stop;
  if (track.view !== view) {
    stop = view === "lobby" ? 1 : view === "entry" && track.view === "lobby" ? 2 : 0;
    setTrack({ view, stop });
    setLeaving(track.view === "entry" || (track.view === "lobby" && view === "home") ? track.view : undefined);
    setMore(false);
  }
  const back = leaving !== undefined && view !== leaving;
  const place: OptionsPlace = { open: more, onOpen: setMore, target: slot };
  const idle: OptionsPlace = { open: false, onOpen: () => undefined, target: slot };
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
    <div data-view={view} data-stop={stop + (more ? 1 : 0)} data-more={more ? "" : undefined} className="group relative isolate flex h-dvh flex-col overflow-hidden bg-canvas lg:h-auto lg:min-h-0 lg:flex-1 lg:flex-row">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 hidden w-[200%] transition-transform duration-700 ease-(--ease-glide) group-data-[stop=1]:-translate-x-1/4 group-data-[stop=2]:-translate-x-1/2 group-data-[stop=3]:-translate-x-3/4 lg:flex">
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
      <div className={`no-scrollbar relative flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 group-data-[view=lobby]:bg-bubble sm:px-10 max-lg:group-data-[more]:invisible lg:py-10 lg:group-data-[more]:-translate-x-full lg:group-data-[view=lobby]:bg-transparent ${CONVEY}`}>
        <Social className="justify-end" />
        <div className="relative flex flex-1 items-center justify-center py-2 lg:py-8">
          {view === "entry" ? null : (
            <div inert={view !== "home"} className={`flex w-full justify-center transition-[translate,opacity] duration-500 ease-(--ease-glide) ${back && view === "home" ? "slide-in-left" : ""} ${view === "home" ? "" : `${HIDDEN} max-lg:hidden`}`}>
              <OptionsPlaceContext value={view === "home" ? place : idle}>
                <EnterRoom />
              </OptionsPlaceContext>
            </div>
          )}
          {lobby || leftLobby || leaving === "lobby" ? (
            <div
              inert={!lobby}
              className={`flex w-full justify-center transition-[translate,opacity] duration-500 ease-(--ease-glide) lg:absolute lg:inset-0 lg:items-start lg:pt-[6vh] ${lobby ? "ride-in" : leaving === "lobby" ? LEAVE_RIGHT : `ride-in ${HIDDEN} max-lg:hidden`}`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && leaving === "lobby") setLeaving(undefined);
              }}
            >
              <LobbyPage active={lobby} />
            </div>
          ) : null}
          {view === "entry" || leaving === "entry" ? (
            <div
              inert={view !== "entry"}
              className={`no-scrollbar flex w-full lg:absolute lg:inset-0 lg:overflow-y-auto ${view === "entry" ? "ride-in" : LEAVE_RIGHT}`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && view !== "entry") setLeaving(undefined);
              }}
            >
              <OptionsPlaceContext value={view === "entry" ? place : idle}>
                <div className="m-auto flex w-full justify-center py-2">{view === "entry" ? panel : doorway.current}</div>
              </OptionsPlaceContext>
            </div>
          ) : null}
        </div>
        <AppLink
          href={lobby ? "/" : view === "entry" ? (leftLobby ? "/lobby" : "/") : "/lobby"}
          inert={more && view === "entry"}
          className={`${CONVEYOR_LINK} inert:opacity-0`}
        >
          {view === "home" ? null : <Arrow back />}
          {t(lobby ? "lobby.back" : view === "entry" ? "home.back" : "home.seeRooms")}
          {view === "home" ? <Arrow /> : null}
        </AppLink>
      </div>
      <div ref={setSlot} className="invisible absolute inset-0 z-20 translate-x-full bg-canvas transition-[translate,visibility] duration-700 ease-(--ease-glide) group-data-[more]:visible group-data-[more]:translate-x-0 group-data-[more]:transition-[translate] lg:left-1/2 lg:border-l lg:border-line" />
    </div>
  );
}
