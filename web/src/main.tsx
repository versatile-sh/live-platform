import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createBrowserServices } from "./browser-services";
import { I18nProvider } from "./i18n/I18nProvider";
import { detectLocale } from "./i18n";
import { NavigationProvider } from "./routing/Navigation";
import { createPathnameStore } from "./routing/pathname-store";
import { ServicesProvider } from "./services";

import "./styles.css";

const container = document.getElementById("root");

if (container) {
  const locale = detectLocale(navigator.languages);
  document.documentElement.lang = locale;
  createRoot(container).render(
    <StrictMode>
      <I18nProvider locale={locale}>
        <ServicesProvider services={createBrowserServices()}>
          <NavigationProvider store={createPathnameStore(window)}>
            <App />
          </NavigationProvider>
        </ServicesProvider>
      </I18nProvider>
    </StrictMode>,
  );
}
