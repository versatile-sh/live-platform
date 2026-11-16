import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "../i18n/I18nProvider";
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
export function ConnectionCard({ snapshot, onClose }: { snapshot: SessionSnapshot; onClose(): void }) {
  const t = useT();
  const [spot, setSpot] = useState<Spot>({ x: 16, y: 72 });
  const [grip, setGrip] = useState<Spot | undefined>();
  const { connection, rtt } = snapshot;
  const steady = connection.phase === "joined";

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
      className={`swap-in bubble fixed z-20 flex w-60 touch-none items-start gap-3 bg-bubble py-2.5 pr-2 pl-4 text-ink select-none ${grip ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => setGrip(undefined)}
      onPointerCancel={() => setGrip(undefined)}
      onKeyDown={key}
    >
      <dl className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink/65">{t("connection.rttShort")}</dt>
          <dd className="text-base font-bold tabular-nums">{rtt === undefined ? t("connection.measuring") : t("connection.ms", { ms: rtt })}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink/65">{t("connection.state")}</dt>
          <dd className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-1.5 rounded-full bg-ink ${steady ? "" : "pulse"}`} />
            {t(steady ? "connection.joined" : "person.reconnecting")}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink/65">{t("connection.mediaState")}</dt>
          <dd>{t("connection.mediaShort")}</dd>
        </div>
      </dl>
      <button type="button" aria-label={t("connection.hide")} title={t("connection.hide")} className={ICON_BUTTON_PLAIN} onClick={onClose}>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M4 8h8" />
        </svg>
      </button>
    </div>
  );
}
