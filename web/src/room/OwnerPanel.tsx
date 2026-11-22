import { useState } from "react";

import { shareLink } from "../domain/share-link";
import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import type { Session, SessionSnapshot } from "../session/session";
import { button } from "../ui/styles";
import { useCopy } from "../ui/useCopy";
import { AccessSettings, type Access } from "./AccessSettings";

type OwnerPanelProps = { slug: string; session: Session; snapshot: SessionSnapshot };

/** What the owner decides about the room while it is running: who may enter, the room code, and the link to hand out. Every change takes effect at once. */
export function OwnerPanel({ slug, session, snapshot }: OwnerPanelProps) {
  const t = useT();
  const services = useServices();
  const [code, setCode] = useState<string | undefined>(snapshot.password);
  const { result, copy } = useCopy();
  const access: Access = snapshot.private ? "private" : "public";
  const codeUnknown = snapshot.private && code === undefined;
  const link = shareLink(services.origin, slug, snapshot.private ? snapshot.password : undefined);

  async function lockWith(next: string) {
    const { verifier } = await services.derive(next, slug);
    session.owner({ op: "password", verifier }, { private: true, password: next });
  }

  function choose(next: Access) {
    if (next === access) return;
    if (next === "private") {
      const fresh = code ?? services.generatePassword();
      setCode(fresh);
      void lockWith(fresh);
    }
    else session.owner({ op: "password" }, { private: false, password: undefined });
  }

  return (
    <section aria-label={t("owner.heading")} className="flex flex-col">
      <AccessSettings
        access={access}
        onAccess={choose}
        listed={snapshot.listed ?? false}
        onListed={(listed) => session.owner({ op: "listed", listed }, { listed })}
        code={code}
        onRenew={() => {
          const next = services.generatePassword();
          setCode(next);
          void lockWith(next);
        }}
      />
      <p className="mt-6 mb-1.5 text-sm font-semibold">{t("owner.linkLabel")}</p>
      <p className="bubble truncate border border-line-strong bg-canvas px-3.5 py-2.5 font-mono text-sm text-muted" translate="no">
        {link}
      </p>
      <button type="button" className={`${button({ size: "sm" })} mt-3 self-start`} onClick={() => void copy(link)}>
        {result === "copied" ? t("invite.copied") : t("invite.copy")}
      </button>
      <p className="mt-2 text-sm text-muted">{codeUnknown ? t("owner.linkNoCode") : snapshot.private ? t("owner.linkPrivate") : t("owner.linkPublic")}</p>
    </section>
  );
}
