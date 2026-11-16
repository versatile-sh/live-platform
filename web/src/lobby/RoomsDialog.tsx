import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";

import type { RoomSummary } from "../api/rooms";
import { useLocale, useT } from "../i18n/I18nProvider";
import { Segmented } from "../ui/Segmented";
import { RoomRow } from "./RoomRow";

const WorldMap = lazy(() => import("../map/WorldMap"));

type RoomsDialogProps = { rooms: readonly RoomSummary[]; start: "list" | "map"; onClose(): void };

const CHIP = "h-8 rounded-full border border-paper/30 px-3.5 text-sm font-semibold text-paper/70 transition-colors duration-200 hover:text-paper aria-pressed:border-paper aria-pressed:bg-paper aria-pressed:text-ink";

/** Every open room in one window split the opposite way of the page behind it: lime on the left, ink on the right, with a search, and the map beside the rooms of the country picked on it. */
export function RoomsDialog({ rooms, start, onClose }: RoomsDialogProps) {
  const t = useT();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState(start);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState<string | undefined>();
  const names = new Intl.DisplayNames([useLocale()], { type: "region" });

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const counts = new Map<string, number>();
  for (const room of rooms) if (room.country) counts.set(room.country, (counts.get(room.country) ?? 0) + 1);
  const picked = country && counts.has(country) ? country : undefined;
  const needle = query.trim().toLowerCase();
  const found = rooms.filter((room) => room.slug.includes(needle) && (view === "list" || !picked || room.country === picked));

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="rooms-dialog m-auto h-[min(44rem,calc(100dvh-3rem))] w-[min(76rem,calc(100vw-3rem))] max-w-none overflow-hidden rounded-[1.5rem] bg-ink p-0 text-paper backdrop:bg-ink/70"
    >
      <div className="relative isolate flex h-full flex-col">
        <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 hidden w-1/2 bg-bubble lg:block" />
        <header className="grid shrink-0 gap-4 p-6 lg:grid-cols-2 lg:gap-0 lg:p-0">
          <div className="flex items-center justify-between gap-4 lg:p-8 lg:pb-6 lg:text-ink">
            <h2 id={`${id}-title`} className="font-display text-3xl leading-none font-bold tracking-[-0.04em] sm:text-4xl">
              {t("lobby.heading")}
            </h2>
            <Segmented<"list" | "map">
              label={t("lobby.viewLabel")}
              tone="ink"
              className="max-lg:border-paper/30"
              value={view}
              onChange={setView}
              options={[
                { value: "list", text: t("lobby.viewList") },
                { value: "map", text: t("lobby.viewMap") },
              ]}
            />
          </div>
          <div className="flex items-center gap-3 lg:p-8 lg:pb-6">
            <label htmlFor={`${id}-search`} className="sr-only">
              {t("lobby.search")}
            </label>
            <div className="flex h-11 flex-1 items-center gap-2.5 rounded-full border border-paper/30 px-4 transition-colors duration-200 focus-within:border-paper/70">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0 text-paper/60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
              <input
                id={`${id}-search`}
                type="search"
                value={query}
                placeholder={t("lobby.searchPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm text-paper placeholder:text-paper/45 focus-visible:outline-none"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button type="button" aria-label={t("lobby.close")} className="grid size-11 shrink-0 place-items-center rounded-full border border-paper/30 transition-colors duration-200 hover:border-paper/70" onClick={onClose}>
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </header>

        {view === "list" ? (
          <div key="list" className="swap-in min-h-0 flex-1 overflow-y-auto px-6 pb-6 lg:px-8 lg:pb-8">
            {found.length > 0 ? (
              <ul className="grid gap-3 lg:grid-cols-2 lg:gap-x-16">
                {found.map((room) => (
                  <RoomRow key={room.slug} room={room} tone="paper" />
                ))}
              </ul>
            ) : (
              <p role="status" className="lg:text-ink">
                {t(rooms.length === 0 ? "lobby.emptyTitle" : "lobby.noMatch")}
              </p>
            )}
          </div>
        ) : (
          <div key="map" className="swap-in grid min-h-0 flex-1 lg:grid-cols-2">
            <div className="flex items-center px-6 pb-6 max-lg:hidden lg:px-8 lg:pb-8">
              <Suspense fallback={null}>
                <WorldMap counts={counts} selected={picked} onSelect={setCountry} />
              </Suspense>
            </div>
            <div className="flex min-h-0 flex-col px-6 pb-6 lg:px-8 lg:pb-8">
              <div className="mb-4 flex shrink-0 flex-wrap gap-2">
                <button type="button" aria-pressed={!picked} className={CHIP} onClick={() => setCountry(undefined)}>
                  {t("lobby.all")}
                </button>
                {[...counts.keys()].sort().map((code) => (
                  <button key={code} type="button" aria-pressed={picked === code} className={CHIP} onClick={() => setCountry(code)}>
                    {names.of(code) ?? code}
                  </button>
                ))}
              </div>
              {found.length > 0 ? (
                <ul className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                  {found.map((room) => (
                    <RoomRow key={room.slug} room={room} tone="paper" />
                  ))}
                </ul>
              ) : (
                <p role="status">{t(rooms.length === 0 ? "lobby.emptyTitle" : "lobby.noMatch")}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
