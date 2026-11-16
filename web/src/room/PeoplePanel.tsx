import type { Person } from "../signal/protocol";
import { useT } from "../i18n/I18nProvider";
import { Icon } from "../ui/icons";
import { describePerson } from "./person";

type PeoplePanelProps = { people: readonly Person[]; me: number | undefined; canModerate: boolean; onRemove(pid: number): void; onTransfer(pid: number): void };

/** Everyone in the room as a list: who they are, what they are doing, and, for the owner, what can be done about them. */
export function PeoplePanel({ people, me, canModerate, onRemove, onTransfer }: PeoplePanelProps) {
  const t = useT();
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      {people.map((person) => {
        const view = describePerson(person);
        const mine = person.pid === me;
        return (
          <li key={person.pid} className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-200 hover:bg-fg/5">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-line-strong font-display text-sm font-bold">
              {[...person.name][0]?.toLocaleUpperCase() ?? "?"}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold" translate="no">
                {person.name}
                {mine ? <span className="font-normal text-muted"> ({t("room.you")})</span> : null}
              </span>
              <span className={`truncate font-mono text-xs ${view.trouble ? "text-amber" : "text-muted"}`}>{[view.isOwner ? t("room.owner") : undefined, view.trouble || view.tone === "dashed" ? t(view.stateKey) : undefined].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-muted">
              {view.flags.includes("hand") ? <Icon name="hand" className="size-4 text-accent" /> : null}
              <Icon name={view.flags.includes("microphone") ? "mic" : "micOff"} className="size-4" />
              {canModerate && !mine ? (
                <>
                  <button type="button" className="ml-1 h-8 rounded-full border border-line-strong px-2.5 text-xs font-semibold text-fg transition-colors duration-200 hover:border-fg/50" onClick={() => onTransfer(person.pid)} aria-label={t("owner.transfer", { name: person.name })}>
                    {t("owner.transferShort")}
                  </button>
                  <button type="button" className="h-8 rounded-full border border-line-strong px-2.5 text-xs font-semibold text-amber transition-colors duration-200 hover:border-amber" onClick={() => onRemove(person.pid)} aria-label={t("owner.remove", { name: person.name })}>
                    {t("owner.removeShort")}
                  </button>
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
