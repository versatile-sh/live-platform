import type { MessageKey } from "../i18n";
import { useT } from "../i18n/I18nProvider";
import { AppLink } from "../routing/Navigation";
import type { EndReason } from "../session/connection";
import { SURFACE, button } from "../ui/styles";

/** The title and body that explain why I am no longer in the room. */
export function endedCopy(reason: EndReason): {
  title: MessageKey;
  body?: MessageKey;
} {
  switch (reason.kind) {
    case "left":
      return { title: "ended.left.title" };
    case "superseded":
      return { title: "ended.superseded.title", body: "ended.superseded.body" };
    case "removed":
      return { title: "ended.removed.title", body: "ended.removed.body" };
    case "banned":
      return { title: "ended.banned.title", body: "ended.banned.body" };
    case "dropped-by-server":
      return {
        title: "ended.dropped.title",
        body: `ended.dropped.${reason.reason}`,
      };
    case "server-closed":
      return {
        title: "ended.serverClosed.title",
        body: "ended.serverClosed.body",
      };
    case "expired":
      return { title: "ended.expired.title", body: "ended.expired.body" };
    case "disconnected":
      return {
        title: "ended.disconnected.title",
        body: "ended.disconnected.body",
      };
    case "unreachable":
    case "refused":
      return {
        title: "ended.unreachable.title",
        body: "ended.unreachable.body",
      };
    case "flood":
      return { title: "ended.flood.title", body: "ended.flood.body" };
    case "bad-frame":
      return { title: "ended.badFrame.title", body: "ended.badFrame.body" };
  }
}

type EndedPanelProps = {
  reason: EndReason;
  canRejoin: boolean;
  onRejoin: () => void;
  onEnterAgain: () => void;
  onHome: () => void;
};

/** What replaces the room when my connection has ended: the reason in plain words and the way back. */
export function EndedPanel({
  reason,
  canRejoin,
  onRejoin,
  onEnterAgain,
  onHome,
}: EndedPanelProps) {
  const t = useT();
  const copy = endedCopy(reason);
  return (
    <section
      aria-labelledby="ended-title"
      className={`swap-in ${SURFACE} max-w-xl p-6`}
    >
      <h2
        id="ended-title"
        tabIndex={-1}
        ref={(heading) => heading?.focus()}
        className="font-display text-2xl font-bold tracking-[-0.03em]"
      >
        {t(copy.title)}
      </h2>
      {copy.body ? <p className="mt-3 text-muted">{t(copy.body)}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {reason.kind === "left" ? null : canRejoin ? (
          <button type="button" className={button()} onClick={onRejoin}>
            {t("ended.rejoin")}
          </button>
        ) : (
          <button type="button" className={button()} onClick={onEnterAgain}>
            {t("ended.enterAgain")}
          </button>
        )}
        <AppLink
          href="/"
          className={button({ variant: "secondary" })}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onHome();
          }}
        >
          {t("common.lobby")}
        </AppLink>
      </div>
    </section>
  );
}
