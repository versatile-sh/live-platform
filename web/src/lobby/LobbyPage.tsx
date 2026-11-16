import { Suspense, lazy, useState, useSyncExternalStore } from "react";

import { useLocale, useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";
import { Segmented } from "../ui/Segmented";
import { RoomRow } from "./RoomRow";
import { RoomsDialog } from "./RoomsDialog";

const WorldMap = lazy(() => import("../map/WorldMap"));

const PREVIEW = 4;
const MORE = "inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-paper transition-opacity duration-200 hover:opacity-85";

function Expand() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-5 5M2.5 13.5l5-5" />
    </svg>
  );
}

function Nobody({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <div className={`bubble bg-ink p-6 text-paper ${className}`}>
      <p className="font-display text-xl font-bold tracking-[-0.03em]">{t("lobby.emptyTitle")}</p>
      <p className="mt-2 text-paper/70">{t("lobby.emptyBody")}</p>
      <AppLink href="/" className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-bubble px-5 text-sm font-semibold text-ink transition-opacity duration-200 hover:opacity-85">
        {t("lobby.emptyAction")}
        <Arrow />
      </AppLink>
    </div>
  );
}

/** The open rooms, drawn for the lime panel: a short list or the map, each of which opens into a window with every room. They are asked of the server only when someone comes to see them. */
export function LobbyPage() {
  const t = useT();
  const { lobby } = useServices();
  const state = useSyncExternalStore(lobby.subscribe, lobby.getSnapshot);
  const rooms = state.status === "loading" ? [] : state.rooms;
  const [view, setView] = useState<"list" | "map">("list");
  const [seenMap, setSeenMap] = useState(false);
  const [country, setCountry] = useState<string | undefined>();
  const [dialog, setDialog] = useState<"list" | "map" | undefined>();
  const names = new Intl.DisplayNames([useLocale()], { type: "region" });

  const counts = new Map<string, number>();
  for (const room of rooms) if (room.country) counts.set(room.country, (counts.get(room.country) ?? 0) + 1);
  const picked = country && counts.has(country) ? country : undefined;
  const note =
    state.status === "loading"
      ? t("lobby.loading")
      : state.status === "failed"
        ? t("lobby.error")
        : view === "map"
          ? counts.size > 0
            ? t("lobby.mapHint")
            : rooms.length > 0
              ? t("lobby.mapNone")
              : ""
          : rooms.length > 0
            ? t("lobby.intro")
            : "";

  return (
    <section aria-labelledby="listed" className="w-full max-w-2xl text-ink">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="listed" className="font-display text-4xl leading-[1.04] font-bold tracking-[-0.04em] sm:text-5xl">
          {t("lobby.heading")}
        </h2>
        <Segmented<"list" | "map">
          label={t("lobby.viewLabel")}
          tone="ink"
          value={view}
          onChange={(next) => {
            setView(next);
            if (next === "map") setSeenMap(true);
          }}
          options={[
            { value: "list", text: t("lobby.viewList") },
            { value: "map", text: t("lobby.viewMap") },
          ]}
        />
      </div>
      <p role="status" className="mt-3 min-h-6 text-sm text-ink/75">
        {note}
      </p>

      <div className="-mx-1 mt-5 overflow-hidden px-1">
        <div data-view={view} className="flex w-[200%] items-start transition-transform duration-500 ease-(--ease-glide) data-[view=map]:-translate-x-1/2">
          <div role="group" aria-label={t("lobby.viewList")} inert={view !== "list"} className="w-1/2 pr-4 transition-opacity duration-300 inert:opacity-0">
          {state.status === "ready" && rooms.length === 0 ? (
            <Nobody />
          ) : (
            <>
              <ul className="flex flex-col gap-3 p-1">
                {rooms.slice(0, PREVIEW).map((room) => (
                  <RoomRow key={room.slug} room={room} />
                ))}
              </ul>
              {rooms.length > 0 ? (
                <button type="button" className={`${MORE} mt-4`} onClick={() => setDialog("list")}>
                  <Expand />
                  {t("lobby.viewAll", { count: rooms.length })}
                </button>
              ) : null}
            </>
          )}
          </div>
          <div role="group" aria-label={t("lobby.viewMap")} inert={view !== "map"} className="w-1/2 pl-4 transition-opacity duration-300 inert:opacity-0">
            {seenMap ? (
              <>
              <div className="relative aspect-2/1 w-full">
                <Suspense fallback={null}>
                  <WorldMap counts={counts} selected={picked} onSelect={setCountry} />
                </Suspense>
                {state.status === "ready" && rooms.length === 0 ? <Nobody className="arrive absolute inset-x-0 top-1/2 mx-auto w-full max-w-md -translate-y-1/2" /> : null}
                {picked ? (
                  <div role="dialog" aria-label={t("lobby.mapPicked", { country: names.of(picked) ?? picked })} className="arrive bubble absolute inset-x-0 bottom-0 mx-auto flex max-h-full w-full max-w-md flex-col bg-ink p-3 text-paper">
                    <div className="flex items-center justify-between gap-3 px-2 pb-2">
                      <p className="font-display text-lg font-bold tracking-[-0.03em]">{names.of(picked) ?? picked}</p>
                      <button type="button" aria-label={t("lobby.mapClose")} className="grid size-8 place-items-center rounded-full transition-colors duration-200 hover:bg-paper/15" onClick={() => setCountry(undefined)}>
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </div>
                    <ul className="flex flex-col gap-2 overflow-x-hidden overflow-y-auto p-1">
                      {rooms
                        .filter((room) => room.country === picked)
                        .map((room) => (
                          <RoomRow key={room.slug} room={room} tone="raised" compact />
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              {rooms.length > 0 ? (
                <button type="button" className={`${MORE} mt-4`} onClick={() => setDialog("map")}>
                  <Expand />
                  {t("lobby.expandMap")}
                </button>
              ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {dialog ? <RoomsDialog rooms={rooms} start={dialog} onClose={() => setDialog(undefined)} /> : null}
    </section>
  );
}
