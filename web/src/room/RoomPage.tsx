import { Suspense, use, useEffect, useState } from "react";

import type { StatusResult } from "../api/rooms";
import { useT } from "../i18n/I18nProvider";
import { NotFoundPage } from "../NotFoundPage";
import { useServices } from "../services";
import { readSeat } from "../session/seat";
import { createSession, type JoinEntry, type Session } from "../session/session";
import { useSession } from "../session/useSession";
import { SURFACE, button } from "../ui/styles";
import { EntryForm } from "./EntryForm";
import { RoomView } from "./RoomView";

type GateProps = { promise: Promise<StatusResult>; slug: string; onRetry: () => void; refusal?: Parameters<typeof EntryForm>[0]["refusal"]; expired?: boolean; onEnter: (entry: JoinEntry) => void };

function Gate({ promise, slug, onRetry, refusal, expired, onEnter }: GateProps) {
  const t = useT();
  const result = use(promise);
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

/** A room's page: asks what the room is, lets the visitor in, and then shows the room for as long as they are in it. */
export function RoomPage({ slug }: { slug: string }) {
  const t = useT();
  const services = useServices();
  const [statusPromise, setStatusPromise] = useState(() => services.roomsApi.status(slug));
  const [session, setSession] = useState<Session | undefined>(() =>
    readSeat(services.seatStorage, slug) ? createSession({ slug, url: services.signalUrl, socket: services.socket, storage: services.seatStorage }) : undefined,
  );
  const snapshot = useSession(session);

  useEffect(() => {
    if (!session) return;
    const starting = setTimeout(session.start, 0);
    const stopListening = services.pageLifecycle.onPageHide(session.leave);
    return () => {
      clearTimeout(starting);
      stopListening();
      session.dispose();
    };
  }, [session, services.pageLifecycle]);

  function enter(entry: JoinEntry) {
    setSession(createSession({ slug, url: services.signalUrl, socket: services.socket, storage: services.seatStorage, entry }));
  }

  const connection = snapshot.connection;
  const refused = connection.phase === "ended" && connection.reason.kind === "refused" ? connection.reason.code : undefined;
  const expired = connection.phase === "ended" && connection.reason.kind === "expired" && !session?.canRejoin();
  const showRoom = session !== undefined && connection.phase !== "idle" && refused === undefined && !expired;

  return (
    <>
      <title>{`${slug} · live.versatile.sh`}</title>
      {session && showRoom ? (
        <RoomView slug={slug} session={session} snapshot={snapshot} onEnterAgain={() => setSession(undefined)} />
      ) : session && connection.phase === "idle" ? (
        <p role="status" className={`${SURFACE} mt-6 inline-block px-4 py-3`}>
          {t("connection.joining")}
        </p>
      ) : (
        <Suspense
          fallback={
            <p role="status" className={`${SURFACE} mt-6 inline-block px-4 py-3`}>
              {t("entry.checking")}
            </p>
          }
        >
          <Gate promise={statusPromise} slug={slug} onRetry={() => setStatusPromise(services.roomsApi.status(slug))} {...(refused ? { refusal: refused } : {})} {...(expired ? { expired } : {})} onEnter={enter} />
        </Suspense>
      )}
    </>
  );
}
