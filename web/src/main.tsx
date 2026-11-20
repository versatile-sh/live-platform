import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createBrowserServices } from "./browser-services";
import { I18nProvider } from "./i18n/I18nProvider";
import { chosenLocale, type Locale } from "./i18n";
import { NavigationProvider } from "./routing/Navigation";
import { createPathnameStore } from "./routing/pathname-store";
import { ServicesProvider } from "./services";

import "./styles.css";

document.addEventListener("contextmenu", (event) => {
  if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
});

document.addEventListener("dragstart", (event) => event.preventDefault());

/** How long the first-load entrance (styles.css, html[data-enter]) lasts before the page is left to its own transitions. */
const ENTRANCE_MS = 2400;

const container = document.getElementById("root");

if (container) {
  const LOCALE_KEY = "live.locale";
  const read = () => {
    try {
      return window.localStorage.getItem(LOCALE_KEY);
    } catch {
      return null;
    }
  };
  const keep = (next: Locale) => {
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LOCALE_KEY, next);
    } catch {
      return;
    }
  };
  const root = document.documentElement;
  root.dataset.enter = "";
  window.setTimeout(() => delete root.dataset.enter, ENTRANCE_MS);
  const locale = chosenLocale(read(), navigator.languages ?? [navigator.language]);
  document.documentElement.lang = locale;
  createRoot(container).render(
    <StrictMode>
      <I18nProvider locale={locale} onChoose={keep}>
        <ServicesProvider services={createBrowserServices()}>
          <NavigationProvider store={createPathnameStore(window)}>
            <App />
          </NavigationProvider>
        </ServicesProvider>
      </I18nProvider>
    </StrictMode>,
  );
}
