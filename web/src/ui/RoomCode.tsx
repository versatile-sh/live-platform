import { useState } from "react";

import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import { button } from "./styles";

const SMALL = button({ variant: "onInk", size: "xs" });

/** A room code shown large in an ink bubble, to be read aloud or copied, with a way to draw another. */
export function RoomCode({ code, onRenew }: { code: string; onRenew(): void }) {
  const t = useT();
  const { clipboard } = useServices();
  const [copied, setCopied] = useState(false);
  return (
    <div className="bubble flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border border-line-strong bg-ink py-3 pr-3 pl-5 text-paper">
      <output aria-label={t("entry.passwordLabel")} className="font-mono text-xl font-bold tracking-[0.1em] whitespace-nowrap" translate="no">
        {code}
      </output>
      <span className="flex gap-1.5">
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
        <button type="button" className={`${SMALL} w-[4.5rem]`} onClick={() => void clipboard.write(code).then((done) => setCopied(done))}>
          {copied ? t("entry.copied") : t("entry.copy")}
        </button>
      </span>
    </div>
  );
}
