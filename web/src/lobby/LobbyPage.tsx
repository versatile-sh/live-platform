import { useSyncExternalStore } from "react";

import type { RoomSummary } from "../api/rooms";
import { useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";

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

  return (
    <section aria-labelledby="listed" className="w-full max-w-xl text-ink">
      <h2 id="listed" className="font-display text-4xl leading-[1.04] font-bold tracking-[-0.04em] sm:text-5xl">
        {t("lobby.heading")}
      </h2>
      <p role="status" className="mt-3 min-h-6 text-sm text-ink/75">
        {state.status === "loading" ? t("lobby.loading") : state.status === "failed" ? t("lobby.error") : rooms.length > 0 ? t("lobby.intro") : ""}
      </p>
      {state.status === "ready" && rooms.length === 0 ? (
        <div className="bubble mt-6 bg-ink p-6 text-paper">
          <p className="font-semibold">{t("lobby.emptyTitle")}</p>
          <p className="mt-2 text-paper/70">{t("lobby.emptyBody")}</p>
        </div>
      ) : (
        <ul className="mt-6 flex max-h-[26rem] flex-col gap-3 overflow-y-auto pr-1">
          {rooms.map((room) => (
            <RoomRow key={room.slug} room={room} />
          ))}
        </ul>
      )}
      <AppLink href="/" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold underline decoration-ink/40 underline-offset-4 transition-colors hover:decoration-ink">
        <Arrow back />
        {t("lobby.back")}
      </AppLink>
    </section>
  );
}
