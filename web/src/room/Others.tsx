import type { ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import type { Person } from "../signal/protocol";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/icons";
import { AVATAR_BUTTON, FOCUS_RING, PRESS } from "../ui/styles";

type OthersProps = {
  hidden: boolean;
  count: number;
  /** The people the rail shows as dots while the strip is collapsed. */
  people: readonly Person[];
  photos: Readonly<Record<number, string>>;
  onToggle(): void;
  children: ReactNode;
};

/** The strip of everyone beside the one in front, with a handle on its inner edge that collapses it into a rail of small avatars. */
export function Others({ hidden, count, people, photos, onToggle, children }: OthersProps) {
  const t = useT();
  const label = t(hidden ? "stage.showOthers" : "stage.hideOthers", { count });
  return (
    <div className={`relative flex min-h-0 min-w-0 shrink-0 flex-col ${hidden ? "max-lg:h-9 lg:w-9" : "max-lg:h-28 lg:w-52"}`}>
      <button
        type="button"
        aria-expanded={!hidden}
        aria-controls="stage-others"
        aria-keyshortcuts="Control+Alt+O"
        title={`${label} (Ctrl+Alt+O)`}
        className={`bubble absolute z-10 grid place-items-center border border-line-strong bg-card text-muted hover:text-fg max-lg:-top-2.5 max-lg:left-1/2 max-lg:h-5 max-lg:w-14 max-lg:-translate-x-1/2 lg:top-1/2 lg:-left-2.5 lg:h-14 lg:w-5 lg:-translate-y-1/2 ${PRESS} ${FOCUS_RING}`}
        onClick={onToggle}
      >
        <span className="sr-only">{label}</span>
        <Icon name="chevron" className={`size-4 transition-transform duration-200 ${hidden ? "rotate-180 max-lg:-rotate-90" : "max-lg:rotate-90"}`} />
      </button>
      <ul id="stage-others" aria-label={t("stage.others")} hidden={hidden} className="no-scrollbar flex min-h-0 flex-1 gap-3 overflow-auto max-lg:[&>li]:h-full max-lg:[&>li]:w-auto lg:flex-col">
        {children}
      </ul>
      {hidden ? (
        <ul className="no-scrollbar flex min-h-0 flex-1 items-center gap-1.5 overflow-auto max-lg:justify-center max-lg:pt-3 lg:flex-col lg:py-1 lg:pl-3">
          {people.map((person) => (
            <li key={person.pid} className="shrink-0">
              <button type="button" aria-label={t("stage.dot", { name: person.name })} title={person.name} className={AVATAR_BUTTON} onClick={onToggle}>
                <Avatar look={person.look} face={person.face} name={person.name} photo={photos[person.pid]} className="text-[1.5rem]" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
