import { useId } from "react";

import { useT } from "../i18n/I18nProvider";
import { RoomCode } from "../ui/RoomCode";
import { Switch } from "../ui/Switch";

export type Access = "public" | "private";

type AccessSettingsProps = {
  access: Access;
  onAccess(access: Access): void;
  listed: boolean;
  onListed(listed: boolean): void;
  code: string;
  onRenew(): void;
};

const CHOICE =
  "relative z-10 flex cursor-pointer flex-col gap-1 rounded-[1.25rem] px-4 py-3.5 text-left text-fg transition-colors duration-300 has-checked:text-on-bubble has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg/55";

/** A room's two settings: who may enter, as one sliding choice (public, or private behind a room code), and whether it shows in the open rooms. */
export function AccessSettings({ access, onAccess, listed, onListed, code, onRenew }: AccessSettingsProps) {
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

      <div className="mt-4 h-[4.25rem]">{access === "private" ? <div className="swap-in">{<RoomCode code={code} onRenew={onRenew} />}</div> : <p className="swap-in pt-1 text-sm text-muted">{t("home.publicNote")}</p>}</div>

      <div className="mt-4">
        <Switch checked={listed} onChange={onListed} hint={t(access === "private" ? "home.listedPrivateHint" : "home.listedHint")}>
          {t("entry.listed")}
        </Switch>
      </div>
    </>
  );
}
