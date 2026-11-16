import { useT } from "./i18n/I18nProvider";
import { AppLink } from "./routing/Navigation";
import { button } from "./ui/styles";

/** A page for an address that is not a room: a malformed room name or a path that leads nowhere. */
export function NotFoundPage({ kind }: { kind: "invalid-room" | "not-found" }) {
  const t = useT();
  const key = kind === "invalid-room" ? "invalidRoom" : "notFound";
  return (
    <div className="pt-6">
      <h1 className="font-display text-3xl font-bold tracking-[-0.044em] sm:text-4xl">{t(`${key}.title`)}</h1>
      <p className="mt-4 mb-8 max-w-xl text-lg text-muted">{t(`${key}.body`)}</p>
      <AppLink href="/" className={button({ variant: "secondary" })}>
        {t("common.lobby")}
      </AppLink>
    </div>
  );
}
