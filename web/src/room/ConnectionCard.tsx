import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "../i18n/I18nProvider";
import type { RoomMedia } from "../media/room-media";
import { formatRate, grade, readStats, type MediaStats, type StatsMark } from "../media/stats";
import type { SessionSnapshot } from "../session/session";
import { ICON_BUTTON_PLAIN } from "../ui/styles";

type Spot = { x: number; y: number };

const STEP = 16;
const EDGE = 8;

function clamp(spot: Spot, box: { width: number; height: number }): Spot {
  return {
    x: Math.min(Math.max(spot.x, EDGE), Math.max(EDGE, window.innerWidth - box.width - EDGE)),
    y: Math.min(Math.max(spot.y, EDGE), Math.max(EDGE, window.innerHeight - box.height - EDGE)),
  };
}

/** The connection at a glance, as a small bubble the person parks wherever it does not bother them: it is dragged by its body, moved with the arrow keys, and put away with the minus. */
export function ConnectionCard({ snapshot, slug, report, onClose }: { snapshot: SessionSnapshot; slug: string; report: RoomMedia["report"]; onClose(): void }) {
  const t = useT();
  const [spot, setSpot] = useState<Spot>({ x: 16, y: 72 });
  const [grip, setGrip] = useState<Spot | undefined>();
  const { connection, rtt } = snapshot;
  const steady = connection.phase === "joined";
  const [stats, setStats] = useState<MediaStats | undefined>();
  useEffect(() => {
    let mark: StatsMark | undefined;
    let live = true;
    const read = async () => {
      const { sending, receiving } = await report();
      if (!live) return;
      const next = readStats(sending, receiving, Date.now(), mark);
      mark = next.mark;
      setStats(next.stats);
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [report]);
  const delay = stats?.rtt ?? rtt;
  const judged = grade({ rtt: delay, loss: stats?.loss });
  const none = "—";
  const figures: readonly (readonly [string, string])[] = [
    [t("connection.route"), stats?.route ? t(`connection.route.${stats.route}`) : none],
    [t("connection.rttShort"), delay === undefined ? t("connection.measuring") : t("connection.ms", { ms: delay })],
    [t("connection.loss"), stats?.loss === undefined ? none : `${stats.loss}%`],
    [t("connection.jitter"), stats?.jitter === undefined ? none : t("connection.ms", { ms: stats.jitter })],
    [t("connection.receiving"), formatRate(stats?.receiving) ?? none],
    [t("connection.sending"), formatRate(stats?.sending) ?? none],
    [t("connection.videoCodec"), stats?.videoCodec ?? none],
    [t("connection.audioCodec"), stats?.audioCodec ?? none],
  ];

  function down(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGrip({ x: event.clientX - spot.x, y: event.clientY - spot.y });
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (grip) setSpot(clamp({ x: event.clientX - grip.x, y: event.clientY - grip.y }, event.currentTarget.getBoundingClientRect()));
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const by: Record<string, Spot> = { ArrowLeft: { x: -STEP, y: 0 }, ArrowRight: { x: STEP, y: 0 }, ArrowUp: { x: 0, y: -STEP }, ArrowDown: { x: 0, y: STEP } };
    const delta = by[event.key];
    if (!delta) return;
    event.preventDefault();
    setSpot(clamp({ x: spot.x + delta.x, y: spot.y + delta.y }, event.currentTarget.getBoundingClientRect()));
  }

  return (
    <div
      role="group"
      aria-label={t("more.connection")}
      tabIndex={0}
      style={{ left: spot.x, top: spot.y }}
      className={`swap-in bubble fixed z-20 flex w-72 touch-none items-start gap-3 bg-bubble py-2.5 pr-2 pl-4 text-ink select-none ${grip ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => setGrip(undefined)}
      onPointerCancel={() => setGrip(undefined)}
      onKeyDown={key}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="flex items-center justify-between gap-3 text-sm font-bold">
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full bg-ink ${steady ? "" : "pulse"}`} />
            <span className="truncate" translate="no">
              {slug}
            </span>
          </span>
          <span className="shrink-0 font-mono text-xs font-normal">{steady ? (judged ? t(`connection.grade.${judged}`) : t("connection.measuring")) : t("person.reconnecting")}</span>
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
          {figures.map(([name, value]) => (
            <div key={name} className="flex min-w-0 flex-col">
              <dt className="truncate text-[0.625rem] tracking-wide text-ink/65 uppercase">{name}</dt>
              <dd className="truncate text-sm font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <button type="button" aria-label={t("connection.hide")} title={t("connection.hide")} className={ICON_BUTTON_PLAIN} onClick={onClose}>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M4 8h8" />
        </svg>
      </button>
    </div>
  );
}
