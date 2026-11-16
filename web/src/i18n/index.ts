import { en, type MessageKey } from "./en";
import { ptBR } from "./pt-br";

export type { MessageKey } from "./en";

/** The languages the interface speaks. */
export type Locale = "en" | "pt-BR";

export const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, "pt-BR": ptBR };

/** Values that fill the `{placeholders}` of a message. */
export type Params = Record<string, string | number>;

/** Looks up a message and fills its placeholders. */
export type Translate = (key: MessageKey, params?: Params) => string;

/** Picks the first language in the browser's preference list that the interface speaks, falling back to English. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "pt") return "pt-BR";
    if (base === "en") return "en";
  }
  return "en";
}

/** Builds the translate function of a locale. */
export function createTranslate(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale];
  return (key, params) => dictionary[key].replace(/\{(\w+)\}/g, (whole, name: string) => String(params?.[name] ?? whole));
}
