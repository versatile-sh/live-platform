import { useT } from "../i18n/I18nProvider";
import type { Connection } from "../session/connection";
import { Bubble } from "../ui/Bubble";

/**
 * My connection in words, always mounted so that a change is announced. A dropped connection is stated at once in an outlined box, not just a colour change.
 * On a phone the sentence is left to screen readers: joining shows a pulsing dot, trouble keeps its one word, and the room's name keeps the room.
 */
export function ConnectionStatus({ connection }: { connection: Connection }) {
  const t = useT();
  const trouble = connection.phase === "reconnecting";
  const text =
    connection.phase === "joining"
      ? t(connection.resuming ? "connection.resuming" : "connection.joining")
      : connection.phase === "joined"
        ? t("connection.joined")
        : connection.phase === "reconnecting"
          ? `${t("connection.reconnecting")} ${t(`connection.cause.${connection.cause}`)}`
          : "";
  return (
    <p role="status" aria-label={t("connection.label")} className={`min-h-9 max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm max-sm:shrink-0 max-sm:border-0 max-sm:px-0 ${connection.phase === "joined" ? "sr-only" : "flex"} ${trouble ? "border-fg/40" : "border-transparent text-muted"}`}>
      {trouble ? <Bubble>{t("person.reconnecting")}</Bubble> : <span aria-hidden="true" className="pulse size-2 shrink-0 rounded-full bg-muted sm:hidden" />}
      <span className="max-sm:sr-only">{text}</span>
    </p>
  );
}
