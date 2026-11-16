import type { ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import { Wordmark } from "./Wordmark";

/** The frame of every page: skip link, the logotype that leads home, and the main landmark. */
export function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 sm:px-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        {t("app.skip")}
      </a>
      <header className="flex h-16 shrink-0 items-center">
        <AppLink href="/" aria-label={t("app.home")} className="inline-block">
          <Wordmark />
        </AppLink>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 pb-16">
        {children}
      </main>
    </div>
  );
}
