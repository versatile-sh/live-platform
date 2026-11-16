import { useEffect, useState, type ReactNode } from "react";

import type { StatusResult } from "../api/rooms";
import { useT } from "../i18n/I18nProvider";
import { NotFoundPage } from "../NotFoundPage";
import { useServices } from "../services";
import { readSeat } from "../session/seat";
import { createSession, type JoinEntry, type Session } from "../session/session";
import { useSession } from "../session/useSession";
import { HomePage } from "../home/HomePage";
import { Shell } from "../ui/Shell";
import { SURFACE, button } from "../ui/styles";
import { EntryForm } from "./EntryForm";
import { RoomView } from "./RoomView";

type GateProps = { result: StatusResult; slug: string; onRetry: () => void; refusal?: Parameters<typeof EntryForm>[0]["refusal"]; expired?: boolean; onEnter: (entry: JoinEntry) => void };

function Gate({ result, slug, onRetry, refusal, expired, onEnter }: GateProps) {
  const t = useT();
  if (result.kind === "invalid") return <NotFoundPage kind="invalid-room" />;
  if (result.kind === "unreachable") {
    return (
      <div className="pt-6">
        <h1 className="font-display text-3xl font-bold tracking-[-0.044em]">{t("entry.unreachableTitle")}</h1>
        <p className="mt-4 mb-6 max-w-xl text-muted">{t("entry.unreachableBody")}</p>
        <button type="button" className={button({ variant: "secondary" })} onClick={onRetry}>
          {t("entry.retry")}
        </button>
      </div>
    );
  }
  return <EntryForm slug={slug} room={result.room} {...(refusal ? { refusal } : {})} {...(expired ? { expired } : {})} onEnter={onEnter} />;
}

type Held = { slug: string | undefined; status: Promise<StatusResult> | undefined; session: Session | undefined };

/** What a room route needs from the page around it: whether the visitor is in the room, the room itself, and what to show while they are not. */
export type RoomGate = { inRoom: boolean; view: ReactNode; panel: ReactNode };

/** Runs a room for the slug in the address, or nothing when the address is not a room. The page that calls it stays mounted while the slug comes and goes. */
export function useRoomGate(slug: string | undefined): RoomGate | undefined {
  const t = useT();
  const services = useServices();

  function open(next: string | undefined): Held {
    if (next === undefined) return { slug: next, status: undefined, session: undefined };
    const base = { slug: next, url: services.signalUrl, socket: services.socket, storage: services.seatStorage };
    const entry = services.entryIntent.read(next);
    const session = readSeat(services.seatStorage, next) ? createSession(base) : entry ? createSession({ ...base, entry }) : undefined;
    return { slug: next, status: services.roomsApi.status(next), session };
  }

  const [stored, setHeld] = useState(() => open(slug));
  let held = stored;
  if (held.slug !== slug) {
    held = open(slug);
    setHeld(held);
  }
  const { session, status } = held;
  const snapshot = useSession(session);
  const [answer, setAnswer] = useState<{ to: Promise<StatusResult>; result: StatusResult } | undefined>();
  useEffect(() => {
    if (!status) return;
    let current = true;
    void status.then((result) => {
      if (current) setAnswer({ to: status, result });
    });
    return () => {
      current = false;
    };
  }, [status]);
  const result = answer && answer.to === status ? answer.result : undefined;

  useEffect(() => {
    if (!session || slug === undefined) return;
    services.entryIntent.clear(slug);
    const starting = setTimeout(session.start, 0);
    const stopListening = services.pageLifecycle.onPageHide(session.leave);
    return () => {
      clearTimeout(starting);
      stopListening();
      session.dispose();
    };
  }, [session, slug, services.entryIntent, services.pageLifecycle]);

  if (slug === undefined || status === undefined) return undefined;

  const setSession = (next: Session | undefined) => setHeld((current) => (current.slug === slug ? { ...current, session: next } : current));
  const enter = (entry: JoinEntry) => setSession(createSession({ slug, url: services.signalUrl, socket: services.socket, storage: services.seatStorage, entry }));
  const retry = () => setHeld((current) => (current.slug === slug ? { ...current, status: services.roomsApi.status(slug) } : current));

  const connection = snapshot.connection;
  const refused = connection.phase === "ended" && connection.reason.kind === "refused" ? connection.reason.code : undefined;
  const expired = connection.phase === "ended" && connection.reason.kind === "expired" && !session?.canRejoin();
  const inRoom = session !== undefined && connection.phase !== "idle" && refused === undefined && !expired;

  const waiting = (text: string) => (
    <p role="status" className={`${SURFACE} inline-block px-4 py-3`}>
      {text}
    </p>
  );
  const title = <title>{`> ~/versatile.sh/live/${slug}`}</title>;

  return {
    inRoom,
    view:
      session && inRoom ? (
        <>
          {title}
          <RoomView slug={slug} session={session} snapshot={snapshot} onEnterAgain={() => setSession(undefined)} />
        </>
      ) : null,
    panel: (
      <>
        {title}
        {session && connection.phase === "idle" ? (
          waiting(t("connection.joining"))
        ) : result ? (
          <Gate result={result} slug={slug} onRetry={retry} {...(refused ? { refusal: refused } : {})} {...(expired ? { expired } : {})} onEnter={enter} />
        ) : (
          waiting(t("entry.checking"))
        )}
      </>
    ),
  };
}

/** The first thing anyone sees, and everything before being in a room: the home, the open rooms and a room's doorway share one page that slides between them; being in a room replaces it. */
export function FrontPage({ view, slug }: { view: "home" | "lobby" | "entry"; slug?: string }) {
  const room = useRoomGate(slug);
  if (room?.inRoom) return <Shell bare>{room.view}</Shell>;
  return (
    <Shell bare>
      <HomePage view={view} panel={room?.panel} />
    </Shell>
  );
}

/** A room's page on its own: its doorway inside the front page, then the room. */
export function RoomPage({ slug }: { slug: string }) {
  return <FrontPage view="entry" slug={slug} />;
}
