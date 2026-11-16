import { useState } from "react";

import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";

const SMALL = "h-8 rounded-full border border-paper/25 px-3 text-xs font-semibold transition-colors duration-200 hover:border-paper/60";

/** A room code shown large in an ink bubble, to be read aloud or copied, with a way to draw another. */
export function RoomCode({ code, onRenew }: { code: string; onRenew(): void }) {
  const t = useT();
  const { clipboard } = useServices();
  const [copied, setCopied] = useState(false);
  return (
    <div className="bubble flex items-center justify-between gap-3 border border-line-strong bg-ink py-3 pr-3 pl-5 text-paper">
      <output aria-label={t("entry.passwordLabel")} className="font-mono text-2xl font-bold tracking-[0.12em]" translate="no">
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
