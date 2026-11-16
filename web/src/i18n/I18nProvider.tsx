import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { withMotion } from "../ui/motion";

import { createTranslate, type Locale, type Translate } from "./index";

type I18n = { locale: Locale; t: Translate; choose(locale: Locale): void };

const I18nContext = createContext<I18n | undefined>(undefined);

/** Makes `useT` available below it, starting in the given locale; `onChoose` hears the visitor's choice so it can be kept. Where the browser can, the old words dissolve into the new ones instead of jumping. */
export function I18nProvider({ locale: initial, onChoose, children }: { locale: Locale; onChoose?: (locale: Locale) => void; children: ReactNode }) {
  const [locale, setLocale] = useState(initial);
  const value = useMemo(
    () => ({
      locale,
      t: createTranslate(locale),
      choose(next: Locale) {
        const apply = () => {
          setLocale(next);
          onChoose?.(next);
        };
        withMotion("words", apply);
      },
    }),
    [locale, onChoose],
  );
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

/** Changes the language of the interface. */
export function useChooseLocale(): (locale: Locale) => void {
  return useI18n().choose;
}
