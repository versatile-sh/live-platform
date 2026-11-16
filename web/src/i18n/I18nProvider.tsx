import { createContext, use, useMemo, type ReactNode } from "react";

import { createTranslate, type Locale, type Translate } from "./index";

type I18n = { locale: Locale; t: Translate };

const I18nContext = createContext<I18n | undefined>(undefined);

/** Makes `useT` available below it, in the given locale. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: createTranslate(locale) }), [locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

function useI18n(): I18n {
  const value = use(I18nContext);
  if (!value) throw new Error("useT needs an I18nProvider above it");
  return value;
}

/** The translate function of the current locale. */
export function useT(): Translate {
  return useI18n().t;
}

/** The current locale, for number and date formatting. */
export function useLocale(): Locale {
  return useI18n().locale;
}
