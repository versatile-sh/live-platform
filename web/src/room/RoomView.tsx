import { hasFlag } from "../domain/flags";
import { useT } from "../i18n/I18nProvider";
import { useNavigate } from "../routing/Navigation";
import type { Notice } from "../session/connection";
import type { Session, SessionSnapshot } from "../session/session";
import { CAPTION, button } from "../ui/styles";
import { ConnectionStatus } from "./ConnectionStatus";
import { EndedPanel } from "./EndedPanel";
import { OwnerPanel } from "./OwnerPanel";
import { Tile } from "./Tile";

type RoomViewProps = { slug: string; session: Session; snapshot: SessionSnapshot; onEnterAgain: () => void };

function NoticeLine({ notice }: { notice: Notice }) {
  const t = useT();
  const text =
    notice.kind === "arrived"
      ? t("notice.arrived", { name: notice.name })
      : notice.kind === "left"
        ? t(`notice.left.${notice.reason}`, { name: notice.name })
        : t(`notice.refused.${notice.code}`);
  return <li className="arrive bubble border border-line-strong bg-card px-3 py-1.5 text-sm">{text}</li>;
}

/** The room as its participants see it: who is here, what just changed, and the owner's controls. */
export function RoomView({ slug, session, snapshot, onEnterAgain }: RoomViewProps) {
  const t = useT();
  const navigate = useNavigate();
  const { connection } = snapshot;
  const inRoom = connection.phase === "joined" || connection.phase === "reconnecting";
  const people = inRoom ? connection.roster.people : [];
  const myPid = inRoom ? connection.me : undefined;
  const me = people.find((person) => person.pid === myPid);
  const iAmOwner = me !== undefined && hasFlag(me.flags, "owner") && connection.phase === "joined";

  function leave() {
    session.leave();
    navigate("/");
  }

  return (
    <div className="pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 font-display text-3xl font-bold tracking-[-0.044em] sm:text-4xl">
          <span className="block truncate" translate="no">
            {slug}
          </span>
        </h1>
        {connection.phase === "ended" ? null : (
          <button type="button" className={button({ variant: "secondary" })} onClick={leave}>
            {t("room.leave")}
          </button>
        )}
      </div>
      <p className={`${CAPTION} mt-2`}>{inRoom ? t("room.peopleCount", { count: people.length }) : ""}</p>

      <div className="mt-4">
        <ConnectionStatus connection={connection} />
      </div>

      {connection.phase === "ended" ? (
        <div className="mt-6">
          <EndedPanel reason={connection.reason} canRejoin={session.canRejoin()} onRejoin={session.rejoin} onEnterAgain={onEnterAgain} />
        </div>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t("room.mediaNote")}</p>
          <div role="status" className="mt-4 min-h-24">
            <ul className="flex flex-col items-start gap-2">
              {inRoom ? connection.notices.map((notice) => <NoticeLine key={notice.id} notice={notice} />) : null}
            </ul>
          </div>
          <div className={`mt-2 grid items-start gap-8 ${iAmOwner ? "lg:grid-cols-[1fr_20rem]" : ""}`}>
            <section aria-label={t("room.peopleHeading", { slug })}>
              {people.length === 0 ? (
                <p className="text-muted">{t("room.gettingReady")}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-4 min-[30rem]:grid-cols-2 xl:grid-cols-3">
                  {people.map((person) => (
                    <Tile
                      key={person.pid}
                      person={person}
                      isMe={person.pid === myPid}
                      canModerate={iAmOwner}
                      onRemove={(pid) => session.owner({ op: "remove", pid })}
                      onTransfer={(pid) => session.owner({ op: "transfer", pid })}
                    />
                  ))}
                </ul>
              )}
            </section>
            {iAmOwner ? <OwnerPanel slug={slug} session={session} snapshot={snapshot} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
