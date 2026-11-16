import { useSyncExternalStore } from "react";

import type { RoomSummary } from "../api/rooms";
import { useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import { useServices } from "../services";
import { Arrow } from "../ui/Arrow";
import { Bubble } from "../ui/Bubble";
import { CAPTION, SURFACE, button } from "../ui/styles";

function Presence({ count, capacity }: { count: number; capacity: number }) {
  return (
    <span aria-hidden="true" className="hidden gap-1 sm:flex">
      {Array.from({ length: capacity }, (_, seat) => (
        <span key={seat} className={`size-1.5 rounded-full ${seat < count ? "bg-accent" : "bg-line-strong"}`} />
      ))}
    </span>
  );
}

function RoomRow({ room }: { room: RoomSummary }) {
  const t = useT();
  const full = room.count >= room.capacity;
  return (
    <li>
      <AppLink href={`/${room.slug}`} aria-label={t("lobby.roomEnter", { slug: room.slug })} className={`${SURFACE} group flex h-16 items-center gap-4 px-5 transition-colors duration-200 hover:border-fg/50`}>
        <span className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-[-0.03em]" translate="no">
          {room.slug}
        </span>
        {full ? <Bubble tone="amber">{t("lobby.roomFull")}</Bubble> : null}
        {room.country ? (
          <span className={CAPTION}>
            <span translate="no">{room.country}</span>
            <span className="sr-only">{t("lobby.country", { code: room.country })}</span>
          </span>
        ) : null}
        <Presence count={room.count} capacity={room.capacity} />
        <span className={`${CAPTION} w-24 text-right tabular-nums`}>{t("lobby.roomPeople", { count: room.count, capacity: room.capacity })}</span>
        <span className="text-muted transition-colors duration-200 group-hover:text-fg">
          <Arrow />
        </span>
      </AppLink>
    </li>
  );
}

function ListedRooms() {
  const t = useT();
  const { lobby } = useServices();
  const state = useSyncExternalStore(lobby.subscribe, lobby.getSnapshot);
  const rooms = state.status === "loading" ? [] : state.rooms;

  return (
    <section aria-labelledby="listed" className="mx-auto w-full max-w-2xl pt-10">
      <h1 id="listed" className="font-display text-4xl leading-[1.04] font-bold tracking-[-0.04em] sm:text-5xl">
        {t("lobby.heading")}
      </h1>
      <p role="status" className={`mt-3 min-h-6 text-sm ${state.status === "failed" ? "text-amber" : "text-muted"}`}>
        {state.status === "loading" ? t("lobby.loading") : state.status === "failed" ? t("lobby.error") : rooms.length > 0 ? t("lobby.intro") : ""}
      </p>
      {state.status === "ready" && rooms.length === 0 ? (
        <div className={`${SURFACE} mt-6 p-6`}>
          <p className="font-semibold">{t("lobby.emptyTitle")}</p>
          <p className="mt-2 text-muted">{t("lobby.emptyBody")}</p>
          <AppLink href="/" className={`${button({ variant: "secondary", size: "sm" })} mt-5 gap-2`}>
            <Arrow back />
            {t("common.lobby")}
          </AppLink>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rooms.map((room) => (
            <RoomRow key={room.slug} room={room} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The open rooms: the ones their owners chose to list, asked for only when someone comes to see them. */
export function LobbyPage() {
  return <ListedRooms />;
}
