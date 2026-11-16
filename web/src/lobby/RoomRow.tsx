import type { RoomSummary } from "../api/rooms";
import { useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import { Arrow } from "../ui/Arrow";

const TONE = {
  ink: { card: "bg-ink text-paper", soft: "text-paper/70", on: "bg-bubble", off: "bg-paper/25", tag: "bg-paper text-ink", arrow: "text-paper/60 group-hover/row:text-bubble" },
  raised: { card: "border border-paper/10 bg-ink-raised text-paper", soft: "text-paper/70", on: "bg-bubble", off: "bg-paper/25", tag: "bg-paper text-ink", arrow: "text-paper/60 group-hover/row:text-bubble" },
} as const;

/** One open room as a bubble that leads into it: its name, where it is, and how many seats are taken. */
export function RoomRow({ room, tone = "ink", compact = false }: { room: RoomSummary; tone?: keyof typeof TONE; compact?: boolean }) {
  const t = useT();
  const colours = TONE[tone];
  const full = room.count >= room.capacity;
  return (
    <li>
      <AppLink href={`/${room.slug}`} aria-label={t("lobby.roomEnter", { slug: room.slug })} className={`bubble group/row flex items-center gap-4 px-5 ${compact ? "h-14" : "h-16"} transition-transform duration-200 hover:translate-x-1 ${colours.card}`}>
        <span className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-[-0.03em]" translate="no">
          {room.slug}
        </span>
        {full ? <span className={`bubble-word px-2 py-0.5 font-mono text-xs ${colours.tag}`}>{t("lobby.roomFull")}</span> : null}
        {room.country ? (
          <span className={`font-mono text-xs ${colours.soft}`}>
            <span translate="no">{room.country}</span>
            <span className="sr-only">{t("lobby.country", { code: room.country })}</span>
          </span>
        ) : null}
        <span aria-hidden="true" className={`hidden gap-1 ${compact ? "" : "xl:flex"}`}>
          {Array.from({ length: room.capacity }, (_, seat) => (
            <span key={seat} className={`size-1.5 rounded-full ${seat < room.count ? colours.on : colours.off}`} />
          ))}
        </span>
        <span className={`shrink-0 text-right font-mono text-xs tabular-nums ${compact ? "" : "w-24"} ${colours.soft}`}>{t("lobby.roomPeople", { count: room.count, capacity: room.capacity })}</span>
        <span className={`transition-colors duration-200 ${colours.arrow}`}>
          <Arrow />
        </span>
      </AppLink>
    </li>
  );
}
