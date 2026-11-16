import type { ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import { Social } from "./Social";
import { QUIET_LINK } from "./styles";
import { Wordmark } from "./Wordmark";

/** The frame of a page: the lit backdrop, the logotype that leads home, the way to the open rooms, and the main landmark. A bare shell is the landmark alone. */
export function Shell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const t = useT();
  if (bare) {
    return (
      <main id="main" tabIndex={-1} className="flex min-h-dvh flex-col lg:h-dvh">
        {children}
      </main>
    );
  }
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
      <div aria-hidden="true" className="backdrop-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[44rem]" />
      <div aria-hidden="true" className="backdrop-beam pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem]" />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:bubble-word focus:bg-card focus:px-3 focus:py-2">
        {t("app.skip")}
      </a>
      <header className="mx-auto flex h-20 w-full max-w-6xl shrink-0 items-center justify-between px-5 sm:px-8">
        <AppLink href="/" aria-label={t("app.home")} className="inline-block">
          <Wordmark />
        </AppLink>
        <div className="flex items-center gap-5">
          <AppLink href="/lobby" className={`${QUIET_LINK} text-sm text-muted`}>
            {t("app.rooms")}
          </AppLink>
          <Social className="hidden sm:flex" />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 sm:px-8">
        {children}
      </main>
    </div>
  );
}
