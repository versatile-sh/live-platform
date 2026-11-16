import { useState, useSyncExternalStore, type FormEvent } from "react";

import { flagEmoji, type RoomSummary } from "../api/rooms";
import { checkSlug, normalizeSlug } from "../domain/slug";
import { useT } from "../i18n/I18nProvider";
import { AppLink, useNavigate } from "../routing/Navigation";
import { useServices } from "../services";
import { Bubble } from "../ui/Bubble";
import { CAPTION, SURFACE, button } from "../ui/styles";
import { TextField } from "../ui/TextField";

function GoToRoom() {
  const t = useT();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const check = checkSlug(normalizeSlug(value));
    if (check.ok) navigate(`/${check.slug}`);
    else setProblem(t(`slug.${check.problem}`));
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-xl">
      <TextField
        label={t("lobby.goLabel")}
        hint={t("lobby.goHint")}
        error={problem}
        value={value}
        placeholder={t("lobby.goPlaceholder")}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value);
          setProblem(undefined);
        }}
        trailing={
          <button type="submit" className={button()}>
            {t("lobby.goButton")}
          </button>
        }
      />
    </form>
  );
}

function RoomCard({ room }: { room: RoomSummary }) {
  const t = useT();
  const full = room.count >= room.capacity;
  return (
    <li>
      <AppLink href={`/${room.slug}`} aria-label={t("lobby.roomEnter", { slug: room.slug })} className={`${SURFACE} flex h-28 flex-col justify-between p-4 transition-colors hover:border-accent`}>
        <span className="truncate font-mono text-base font-medium" translate="no">
          {room.slug}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={CAPTION}>
            {room.country ? (
              <>
                <span aria-hidden="true">{flagEmoji(room.country)} </span>
                <span translate="no">{room.country}</span>
                <span className="sr-only">{t("lobby.country", { code: room.country })}</span>
              </>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            {full ? <Bubble tone="amber">{t("lobby.roomFull")}</Bubble> : null}
            <span className={CAPTION}>{t("lobby.roomPeople", { count: room.count, capacity: room.capacity })}</span>
          </span>
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
    <section aria-labelledby="listed" className="mt-12">
      <h2 id="listed" className="font-display text-xl font-bold tracking-[-0.03em]">
        {t("lobby.listHeading")}
      </h2>
      <p role="status" className={`mt-2 min-h-6 text-sm ${state.status === "failed" ? "text-amber" : "text-muted"}`}>
        {state.status === "loading" ? t("lobby.loading") : state.status === "failed" ? t("lobby.error") : ""}
      </p>
      {state.status !== "loading" && rooms.length === 0 && state.status === "ready" ? (
        <div className={`${SURFACE} mt-4 max-w-xl p-5`}>
          <p className="font-semibold">{t("lobby.emptyTitle")}</p>
          <p className="mt-2 text-muted">{t("lobby.emptyBody")}</p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard key={room.slug} room={room} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The lobby: a way to go to any room by name, and the rooms their owners chose to list. */
export function LobbyPage() {
  const t = useT();
  return (
    <div className="pt-6">
      <h1 className="font-display text-4xl font-bold tracking-[-0.044em] sm:text-5xl">{t("lobby.heading")}</h1>
      <p className="mt-4 mb-8 max-w-xl text-lg text-muted">{t("lobby.intro")}</p>
      <GoToRoom />
      <ListedRooms />
    </div>
  );
}
