import { useState } from "react";

import { assessPassword } from "../domain/password";
import { shareLink } from "../domain/share-link";
import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import type { Session, SessionSnapshot } from "../session/session";
import { PasswordField } from "../ui/PasswordField";
import { CAPTION, SURFACE, button } from "../ui/styles";

type OwnerPanelProps = { slug: string; session: Session; snapshot: SessionSnapshot };

function ShareLink({ slug, snapshot }: { slug: string; snapshot: SessionSnapshot }) {
  const t = useT();
  const { origin, clipboard } = useServices();
  const [copied, setCopied] = useState(false);
  const password = snapshot.private ? snapshot.password : undefined;

  async function copy() {
    if (await clipboard.write(shareLink(origin, slug, password))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <div>
      <button type="button" className={button({ variant: "secondary", size: "sm" })} onClick={() => void copy()}>
        {copied ? t("owner.linkCopied") : t("owner.copyLink")}
      </button>
      <p role="status" className="sr-only">
        {copied ? t("owner.linkCopied") : ""}
      </p>
      <p className={`${CAPTION} mt-2`}>{snapshot.private ? (password ? t("owner.linkWithPassword") : t("owner.linkWithoutPassword")) : ""}</p>
    </div>
  );
}

function LobbyControl({ session, snapshot }: { session: Session; snapshot: SessionSnapshot }) {
  const t = useT();
  if (snapshot.private) return <p className={CAPTION}>{t("owner.lobbyPrivate")}</p>;
  const known = snapshot.listed;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={known === undefined ? undefined : known} className={button({ variant: known === true ? "primary" : "secondary", size: "sm" })} onClick={() => session.owner({ op: "listed", listed: true }, { listed: true })}>
          {t("owner.list")}
        </button>
        <button type="button" aria-pressed={known === undefined ? undefined : !known} className={button({ variant: known === false ? "primary" : "secondary", size: "sm" })} onClick={() => session.owner({ op: "listed", listed: false }, { listed: false })}>
          {t("owner.unlist")}
        </button>
      </div>
      <p className={`${CAPTION} mt-2 min-h-4`}>{known === undefined ? "" : known ? t("owner.lobbyListed") : t("owner.lobbyUnlisted")}</p>
    </div>
  );
}

function PasswordControl({ slug, session, snapshot }: OwnerPanelProps) {
  const t = useT();
  const services = useServices();
  const [draft, setDraft] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [working, setWorking] = useState(false);

  async function save() {
    if (draft === undefined) return;
    const assessment = assessPassword(draft);
    if (assessment.rating === "invalid") {
      setError(t(assessment.problem === "short" ? "password.short" : assessment.problem === "needs-letter" ? "password.needsLetter" : "password.needsDigit"));
      return;
    }
    setWorking(true);
    const derived = await services.derive(draft, slug);
    session.owner({ op: "password", verifier: derived.verifier }, { private: true, listed: false, password: draft });
    setDraft(undefined);
    setError(undefined);
    setWorking(false);
  }

  if (draft !== undefined) {
    const weak = assessPassword(draft).rating === "weak";
    return (
      <div>
        <PasswordField
          label={t("entry.passwordLabel")}
          value={draft}
          onChange={(value) => {
            setDraft(value);
            setError(undefined);
          }}
          generated
          onGenerate={() => setDraft(services.generatePassword())}
          hint={weak ? <span className="text-amber">{t("password.weak")}</span> : t("owner.passwordWarning")}
          {...(error ? { error } : {})}
        />
        <div className="flex gap-2">
          <button type="button" disabled={working} className={button({ size: "sm" })} onClick={() => void save()}>
            {t("owner.passwordSave")}
          </button>
          <button type="button" className={button({ variant: "quiet", size: "sm" })} onClick={() => setDraft(undefined)}>
            {t("owner.passwordCancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button({ variant: "secondary", size: "sm" })} onClick={() => setDraft(services.generatePassword())}>
        {snapshot.private ? t("owner.passwordChange") : t("owner.passwordAdd")}
      </button>
      {snapshot.private ? (
        <button type="button" className={button({ variant: "secondary", size: "sm" })} onClick={() => session.owner({ op: "password" }, { private: false, password: undefined })}>
          {t("owner.passwordRemove")}
        </button>
      ) : null}
    </div>
  );
}

/** What only the owner may do: share the link, list or hide the room, and change or remove its password. */
export function OwnerPanel({ slug, session, snapshot }: OwnerPanelProps) {
  const t = useT();
  return (
    <section aria-labelledby="owner-heading" className={`${SURFACE} flex flex-col gap-5 p-5`}>
      <h2 id="owner-heading" className="font-display text-lg font-bold tracking-[-0.03em]">
        {t("owner.heading")}
      </h2>
      <ShareLink slug={slug} snapshot={snapshot} />
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("owner.lobbyHeading")}</h3>
        <LobbyControl session={session} snapshot={snapshot} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("owner.passwordHeading")}</h3>
        <PasswordControl slug={slug} session={session} snapshot={snapshot} />
      </div>
    </section>
  );
}
