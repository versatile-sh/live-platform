import { useId } from "react";

import { useT } from "../i18n/I18nProvider";
import { button } from "../ui/styles";
import type { CopyResult } from "../ui/useCopy";

/** What the stage shows beside me while nobody else is in the room: the link to send, and a button that copies it and says so. */
export function InviteCard({ link, copied, onCopy }: { link: string; copied: CopyResult; onCopy(): void }) {
  const t = useT();
  const id = useId();
  return (
    <li aria-labelledby={id} className="arrive bubble flex min-w-0 flex-col justify-center gap-3 border border-dashed border-line-strong bg-card size-full overflow-auto p-5 sm:p-8">
      <h2 id={id} className="font-display text-2xl leading-tight font-bold tracking-[-0.03em]">
        {t("invite.aloneTitle")}
      </h2>
      <p className="text-muted">{t("invite.aloneBody")}</p>
      <p className="bubble truncate border border-line-strong bg-canvas px-3.5 py-2.5 font-mono text-sm" translate="no">
        {link}
      </p>
      <button type="button" className={`${button({ variant: "accent" })} w-40 self-start`} onClick={onCopy}>
        {copied === "copied" ? t("invite.copied") : t("invite.copy")}
      </button>
    </li>
  );
}
