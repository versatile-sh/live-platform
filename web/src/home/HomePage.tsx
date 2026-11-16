import { useId, useState, type FormEvent, type ReactNode } from "react";

import { checkSlug, normalizeSlug } from "../domain/slug";
import { useT } from "../i18n/I18nProvider";
import { AppLink, useNavigate } from "../routing/Navigation";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";
import { Social } from "../ui/Social";
import { FIELD, QUIET_LINK, button } from "../ui/styles";
import { Wordmark } from "../ui/Wordmark";

function Said({ mine = false, live = false, children }: { mine?: boolean; live?: boolean; children: ReactNode }) {
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <span
        className={`inline-flex max-w-[22rem] items-center gap-2 px-4 py-2.5 text-[0.9375rem] leading-snug ${
          mine ? "rounded-[1.25rem] rounded-br-[0.3rem] bg-paper font-mono text-sm text-ink" : "bubble bg-ink text-paper"
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
    <section className="relative isolate flex flex-col overflow-hidden bg-bubble px-6 py-8 text-ink sm:px-10 lg:w-1/2 lg:px-14 lg:py-12">
      <div aria-hidden="true" className="backdrop-glow pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden="true" className="backdrop-grid-ink pointer-events-none absolute inset-0 -z-10" />
      <Wordmark onAccent className="self-start text-lg" />
      <div className="flex flex-1 flex-col justify-center py-12 lg:py-0">
        <h1 className="font-display text-[2.5rem] leading-[1.04] font-bold tracking-[-0.04em] sm:text-5xl xl:text-6xl">
          <span className="block">{t("home.line1")}</span>
          <span className="block">{t("home.line2")}</span>
          <span className="bubble-word mt-[0.34em] inline-block bg-ink px-[0.5em] py-[0.24em] font-mono text-[0.42em] leading-[1.15] font-medium tracking-[-0.02em] text-bubble">{t("home.answer")}</span>
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
  const { origin, nameMemory } = useServices();
  const id = useId();
  const [name, setName] = useState(() => nameMemory.read());
  const [room, setRoom] = useState("");
  const [problem, setProblem] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const check = checkSlug(normalizeSlug(room));
    if (!check.ok) {
      setProblem(t(`slug.${check.problem}`));
      return;
    }
    if (name.trim()) nameMemory.write(name.trim());
    navigate(`/${check.slug}`);
  }

  return (
    <section className="flex flex-1 flex-col px-6 py-8 sm:px-10 lg:py-12">
      <Social className="justify-end" />
      <form onSubmit={submit} noValidate className="m-auto w-full max-w-md py-10">
        <h2 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.04em]">{t("home.formTitle")}</h2>
        <p className="mt-2 mb-9 text-muted">{t("home.formIntro")}</p>

        <label htmlFor={`${id}-name`} className="text-sm font-semibold">
          {t("entry.nameLabel")}
        </label>
        <input id={`${id}-name`} value={name} autoComplete="nickname" maxLength={40} aria-describedby={`${id}-name-note`} className={`${FIELD} mt-1.5`} onChange={(event) => setName(event.target.value)} />
        <p id={`${id}-name-note`} className="mt-1.5 mb-6 min-h-5 text-sm text-muted">
          {t("home.nameHint")}
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
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-room-note`}
            className="h-full min-w-0 flex-1 bg-transparent pr-3.5 pl-0.5 font-mono text-sm text-fg placeholder:text-muted-light focus-visible:outline-none"
            onChange={(event) => {
              setRoom(event.target.value);
              setProblem(undefined);
            }}
          />
        </div>
        <p id={`${id}-room-note`} className={`mt-1.5 mb-7 min-h-5 text-sm ${problem ? "text-amber" : "text-muted"}`}>
          {problem ?? t("home.addressHint")}
        </p>

        <button type="submit" className={`${button()} w-full gap-2`}>
          {t("lobby.goButton")}
          <Arrow />
        </button>
        <p className="mt-8 text-center">
          <AppLink href="/lobby" className={`${QUIET_LINK} inline-flex items-center gap-2 text-sm text-muted`}>
            {t("home.seeRooms")}
          </AppLink>
        </p>
      </form>
    </section>
  );
}

/** The home, in two halves: what the product is, told as a conversation, and the form that takes you into a room. */
export function HomePage() {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Pitch />
      <EnterRoom />
    </div>
  );
}
