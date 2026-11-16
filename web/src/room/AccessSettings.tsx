import { useId, useState } from "react";

import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";

export type Access = "public" | "private";

type AccessSettingsProps = {
  access: Access;
  onAccess(access: Access): void;
  locked: boolean;
  onLocked(locked: boolean): void;
  code: string;
  onRenew(): void;
};

const CHOICE =
  "relative z-10 flex cursor-pointer flex-col gap-1 rounded-[1.25rem] px-4 py-3.5 text-left text-fg transition-colors duration-300 has-checked:text-on-bubble has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg/55";
const SMALL = "h-8 rounded-full border border-paper/25 px-3 text-xs font-semibold transition-colors duration-200 hover:border-paper/60";

function RoomCode({ code, onRenew }: { code: string; onRenew: () => void }) {
  const t = useT();
  const { clipboard } = useServices();
  const [copied, setCopied] = useState(false);
  return (
    <div className="bubble flex items-center justify-between gap-3 bg-ink py-3 pr-3 pl-5 text-paper">
      <output aria-label={t("entry.passwordLabel")} className="font-mono text-2xl font-bold tracking-[0.12em]" translate="no">
        {code}
      </output>
      <span className="flex gap-1.5">
        <button type="button" className={SMALL} onClick={() => void clipboard.write(code).then((done) => setCopied(done))}>
          {copied ? t("entry.copied") : t("entry.copy")}
        </button>
        <button
          type="button"
          className={SMALL}
          onClick={() => {
            setCopied(false);
            onRenew();
          }}
        >
          {t("home.newCode")}
        </button>
      </span>
    </div>
  );
}

/** Who may enter a room, as one sliding choice: public (in the open rooms, no password) or private (never listed, with a room code unless the owner turns it off). */
export function AccessSettings({ access, onAccess, locked, onLocked, code, onRenew }: AccessSettingsProps) {
  const t = useT();
  const id = useId();
  return (
    <>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">{t("entry.accessLegend")}</legend>
        <div data-access={access} className="group/access relative grid grid-cols-2 rounded-[1.5rem] border border-fg/30 bg-card p-1">
          <span aria-hidden="true" className="bubble absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] bg-bubble transition-transform duration-500 ease-(--ease-glide) group-data-[access=private]/access:translate-x-full" />
          {(["public", "private"] as const).map((option) => (
            <label key={option} className={CHOICE}>
              <input type="radio" name={`${id}-access`} className="sr-only" checked={access === option} onChange={() => onAccess(option)} />
              <span className="font-display text-lg leading-none font-bold tracking-[-0.03em]">{t(option === "public" ? "entry.accessPublic" : "entry.accessPrivate")}</span>
              <span className="text-[0.8125rem] leading-snug opacity-75">{t(option === "public" ? "home.publicHint" : "home.privateHint")}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div key={access} className="swap-in mt-5 flex h-[7.25rem] flex-col justify-start gap-3">
        {access === "private" ? (
          <>
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
              {t("home.lock")}
              <input type="checkbox" role="switch" checked={locked} onChange={(event) => onLocked(event.target.checked)} className="peer sr-only" />
              <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-line-strong transition-colors duration-300 peer-checked:bg-bubble peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-fg/55 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-paper after:transition-transform after:duration-300 peer-checked:after:translate-x-5 peer-checked:after:bg-ink" />
            </label>
            {locked ? <RoomCode code={code} onRenew={onRenew} /> : <p className="text-sm text-muted">{t("home.unlockedHint")}</p>}
          </>
        ) : (
          <p className="text-sm text-muted">{t("home.publicNote")}</p>
        )}
      </div>
    </>
  );
}
