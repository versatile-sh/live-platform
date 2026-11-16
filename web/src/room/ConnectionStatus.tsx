import { useT } from "../i18n/I18nProvider";
import type { Connection } from "../session/connection";
import { Bubble } from "../ui/Bubble";

/**
 * My connection in words, always mounted so that a change is announced. A dropped connection is stated at once
 * in an outlined box, not just a colour change.
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
    <p role="status" aria-label={t("connection.label")} className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${trouble ? "border-amber" : "border-transparent text-muted"}`}>
      {trouble ? <Bubble tone="amber">{t("person.reconnecting")}</Bubble> : null}
      <span>{text}</span>
    </p>
  );
}
