import { useT } from "../i18n/I18nProvider";
import { COMMUNITY_LINKS } from "../project/project-store";
import { QUIET_LINK } from "./styles";

const LINK = `${QUIET_LINK} text-muted group-data-[view=lobby]:text-ink group-data-[view=lobby]:decoration-ink/40`;

/** Two written invitations: into our Discord server, and to add the Live Versatile bot to one's own. */
export function Community({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <nav aria-label={t("community.label")} className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm ${className}`}>
      <a href={COMMUNITY_LINKS.discord} target="_blank" rel="noopener noreferrer" className={LINK}>
        {t("community.discord")}
      </a>
      <a href={COMMUNITY_LINKS.bot} target="_blank" rel="noopener noreferrer" className={LINK}>
        {t("community.bot")}
      </a>
    </nav>
  );
}
