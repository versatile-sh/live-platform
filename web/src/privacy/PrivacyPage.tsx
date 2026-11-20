import { useT } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n";

const SECTIONS = ["record", "public", "private", "why", "keep", "access", "rights"] as const;

/** The privacy policy: what the audit log holds, why, for how long and who can read it. */
export function PrivacyPage() {
  const t = useT();
  return (
    <article className="swap-in max-w-2xl pt-6">
      <h1 className="font-display text-3xl font-bold tracking-[-0.044em] sm:text-4xl">{t("privacy.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("privacy.updated")}</p>
      <p className="mt-6 text-lg text-muted">{t("privacy.intro")}</p>
      {SECTIONS.map((section) => (
        <section key={section} className="mt-8">
          <h2 className="font-display text-xl font-bold tracking-[-0.03em]">{t(`privacy.${section}.title` satisfies MessageKey)}</h2>
          <p className="mt-2 leading-relaxed text-muted">{t(`privacy.${section}.body` satisfies MessageKey)}</p>
        </section>
      ))}
    </article>
  );
}
