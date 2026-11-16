import { Suspense, lazy, useState, useSyncExternalStore } from "react";

import type { RoomSummary } from "../api/rooms";
import { useLocale, useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";

const WorldMap = lazy(() => import("../map/WorldMap"));

const TOGGLE = "h-full rounded-full px-3.5 text-ink/70 transition-colors duration-200 hover:text-ink aria-pressed:bg-ink aria-pressed:text-paper";

function Presence({ count, capacity }: { count: number; capacity: number }) {
  return (
    <span aria-hidden="true" className="hidden gap-1 sm:flex">
      {Array.from({ length: capacity }, (_, seat) => (
        <span key={seat} className={`size-1.5 rounded-full ${seat < count ? "bg-bubble" : "bg-paper/25"}`} />
      ))}
    </span>
  );
}

function RoomRow({ room }: { room: RoomSummary }) {
  const t = useT();
  const full = room.count >= room.capacity;
  return (
    <li>
      <AppLink href={`/${room.slug}`} aria-label={t("lobby.roomEnter", { slug: room.slug })} className="bubble group/row flex h-16 items-center gap-4 bg-ink px-5 text-paper transition-transform duration-200 hover:translate-x-1">
        <span className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-[-0.03em]" translate="no">
          {room.slug}
        </span>
        {full ? <span className="bubble-word bg-paper px-2 py-0.5 font-mono text-xs text-ink">{t("lobby.roomFull")}</span> : null}
        {room.country ? (
          <span className="font-mono text-xs text-paper/70">
            <span translate="no">{room.country}</span>
            <span className="sr-only">{t("lobby.country", { code: room.country })}</span>
          </span>
        ) : null}
        <Presence count={room.count} capacity={room.capacity} />
        <span className="w-24 text-right font-mono text-xs text-paper/70 tabular-nums">{t("lobby.roomPeople", { count: room.count, capacity: room.capacity })}</span>
        <span className="text-paper/60 transition-colors duration-200 group-hover/row:text-bubble">
          <Arrow />
        </span>
      </AppLink>
    </li>
  );
}

/** The open rooms, drawn for the lime panel: the ones their owners chose to list, asked for only when someone comes to see them. */
export function LobbyPage() {
  const t = useT();
  const { lobby } = useServices();
  const state = useSyncExternalStore(lobby.subscribe, lobby.getSnapshot);
  const rooms = state.status === "loading" ? [] : state.rooms;
  const [view, setView] = useState<"list" | "map">("list");
  const [country, setCountry] = useState<string | undefined>();
  const names = new Intl.DisplayNames([useLocale()], { type: "region" });

  const counts = new Map<string, number>();
  for (const room of rooms) if (room.country) counts.set(room.country, (counts.get(room.country) ?? 0) + 1);
  const picked = country && counts.has(country) ? country : undefined;
  const shown = view === "map" && picked ? rooms.filter((room) => room.country === picked) : rooms;
  const note =
    state.status === "loading"
      ? t("lobby.loading")
      : state.status === "failed"
        ? t("lobby.error")
        : view === "map"
          ? picked
            ? t("lobby.mapPicked", { country: names.of(picked) ?? picked })
            : counts.size > 0
              ? t("lobby.mapHint")
              : t("lobby.mapNone")
          : rooms.length > 0
            ? t("lobby.intro")
            : "";

  return (
    <section aria-labelledby="listed" className="w-full max-w-xl text-ink">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="listed" className="font-display text-4xl leading-[1.04] font-bold tracking-[-0.04em] sm:text-5xl">
          {t("lobby.heading")}
        </h2>
        <div role="group" aria-label={t("lobby.viewLabel")} className="flex h-9 items-center rounded-full border border-ink/35 p-0.5 text-sm font-semibold">
          {(["list", "map"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)} className={TOGGLE}>
              {t(option === "list" ? "lobby.viewList" : "lobby.viewMap")}
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="mt-3 min-h-6 text-sm text-ink/75">
        {note}
      </p>
      {view === "map" ? (
        <div className="mt-4 aspect-2/1 w-full">
          <Suspense fallback={null}>
            <WorldMap counts={counts} selected={picked} onSelect={setCountry} />
          </Suspense>
        </div>
      ) : null}
      {state.status === "ready" && rooms.length === 0 ? (
        <div className="bubble mt-6 bg-ink p-6 text-paper">
          <p className="font-semibold">{t("lobby.emptyTitle")}</p>
          <p className="mt-2 text-paper/70">{t("lobby.emptyBody")}</p>
        </div>
      ) : view === "list" || picked ? (
        <ul className={`mt-6 flex flex-col gap-3 overflow-y-auto pr-1 ${view === "map" ? "max-h-40" : "max-h-[26rem]"}`}>
          {shown.map((room) => (
            <RoomRow key={room.slug} room={room} />
          ))}
        </ul>
      ) : null}
      <AppLink href="/" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold underline decoration-ink/40 underline-offset-4 transition-colors hover:decoration-ink">
        <Arrow back />
        {t("lobby.back")}
      </AppLink>
    </section>
  );
}
