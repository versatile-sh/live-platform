import { useSyncExternalStore } from "react";

import { useT } from "../i18n/I18nProvider";
import { compactCount } from "../project/project-store";
import { useServices } from "../services";

const GITHUB =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";
const X = "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z";
const STAR = "M8 1.5l1.9 4 4.4.6-3.2 3 .8 4.4L8 11.4 4.1 13.5l.8-4.4-3.2-3 4.4-.6z";

const LINK = "inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-3.5 text-sm text-muted transition-colors duration-200 hover:border-fg/50 hover:text-fg";

function Mark({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="currentColor">
      <path d={path} />
    </svg>
  );
}

/** The project in public: its repository with the star count, and the account to follow. */
export function Social({ className = "" }: { className?: string }) {
  const t = useT();
  const { project } = useServices();
  const { repo, x, stars } = useSyncExternalStore(project.subscribe, project.getSnapshot);
  return (
    <nav aria-label={t("social.label")} className={`flex items-center gap-2 ${className}`}>
      <a href={repo} target="_blank" rel="noreferrer" className={LINK} aria-label={stars === undefined ? t("social.github") : t("social.githubStars", { count: stars })}>
        <Mark path={GITHUB} />
        <span aria-hidden="true">GitHub</span>
        {stars === undefined ? null : (
          <span aria-hidden="true" className="inline-flex items-center gap-1 border-l border-line-strong pl-2 font-mono text-xs tabular-nums">
            <svg viewBox="0 0 16 16" className="size-3.5 text-accent" fill="currentColor">
              <path d={STAR} />
            </svg>
            {compactCount(stars)}
          </span>
        )}
      </a>
      <a href={x} target="_blank" rel="noreferrer" className={LINK} aria-label={t("social.x")}>
        <Mark path={X} />
        <span aria-hidden="true">{t("social.follow")}</span>
      </a>
    </nav>
  );
}
