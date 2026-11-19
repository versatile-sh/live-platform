import { useState } from "react";

import { useT } from "../i18n/I18nProvider";
import { helperCommand, type SoundRoute } from "../media/desktop-sound";
import { button } from "../ui/styles";
import { useCopy } from "../ui/useCopy";

/** Shown while my screen goes without sound: on Linux the helper's command and a retry, elsewhere what to tick or which browser to use. */
export function ScreenSoundCard({ route, origin, onRetry, onClose }: { route: SoundRoute; origin: string; onRetry(): Promise<boolean>; onClose(): void }) {
  const t = useT();
  const { result, copy } = useCopy();
  const [missing, setMissing] = useState(false);
  const command = helperCommand(origin);
  return (
    <li className="swap-in bubble pointer-events-auto flex flex-col gap-2.5 border border-bubble bg-card px-4 py-3 text-sm">
      <strong className="font-semibold">{t("screenSound.title")}</strong>
      <span>{t(`screenSound.${route}`)}</span>
      {route === "helper" ? (
        <>
          <code className="bubble block border border-line-strong bg-canvas px-3 py-2 font-mono text-xs break-all select-all" translate="no">
            {command}
          </code>
          {missing ? <span role="alert" className="text-muted">{t("screenSound.missing")}</span> : null}
        </>
      ) : null}
      <span className="flex flex-wrap gap-2">
        {route === "helper" ? (
          <>
            <button type="button" className={button({ variant: "accent", size: "xs" })} onClick={() => void copy(command)}>
              {t(result === "copied" ? "screenSound.copied" : "screenSound.copy")}
            </button>
            <button type="button" className={button({ variant: "secondary", size: "xs" })} onClick={() => void onRetry().then((found) => setMissing(!found))}>
              {t("screenSound.retry")}
            </button>
          </>
        ) : null}
        <button type="button" className={button({ variant: "secondary", size: "xs" })} onClick={onClose}>
          {t("prompt.notNow")}
        </button>
      </span>
    </li>
  );
}
