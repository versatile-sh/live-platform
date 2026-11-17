import { useRef, useState } from "react";

import { useT } from "../i18n/I18nProvider";
import { Icon, type IconName } from "../ui/icons";
import { DOCK } from "../ui/styles";

/** One thing the room's menu offers: its words, its icon, the keys that do the same, whether it is on, and what it does. */
export type MoreItem = { id: string; label: string; icon: IconName; keys?: string; checked?: boolean; run(): void };

function focusFirst(menu: HTMLUListElement | null) {
  menu?.querySelector<HTMLButtonElement>("button")?.focus();
}

/** Everything a call needs now and then, behind one round button: groups of things split by a line. It closes on a choice, a click outside or Escape. */
export function MoreMenu({ groups }: { groups: readonly (readonly MoreItem[])[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("more.label")}
        title={t("more.label")}
        className={`${DOCK.round} size-11 ${open ? DOCK.open : "text-fg hover:bg-fg/10"}`}
        onClick={() => setOpen(!open)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <circle cx="6" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="18" cy="12" r="1.6" />
        </svg>
      </button>
      {open ? (
        <>
          <button type="button" aria-label={t("menu.close")} className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <ul
            ref={focusFirst}
            role="menu"
            aria-label={t("more.label")}
            className="swap-in bubble-sent absolute top-[calc(100%+0.5rem)] right-0 z-30 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col border border-line-strong bg-card p-2 text-left"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            {groups.flatMap((group, index) => [
              ...(index > 0 ? [<li key={`line-${index}`} role="separator" className="my-1.5 h-px bg-line" />] : []),
              ...group.map((item) => (
                <li key={item.id} role="none">
                  <button
                    type="button"
                    role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={item.checked}
                    className="flex h-11 w-full items-center gap-3 bubble px-3 text-sm transition-colors duration-200 hover:bg-fg/8 focus-visible:bg-fg/8"
                    onClick={() => {
                      setOpen(false);
                      item.run();
                    }}
                  >
                    <Icon name={item.icon} className="size-4 text-accent" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.checked ? <span aria-hidden="true" className="size-2 rounded-full bg-bubble" /> : null}
                    {item.keys ? <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">{item.keys}</kbd> : null}
                  </button>
                </li>
              )),
            ])}
          </ul>
        </>
      ) : null}
    </div>
  );
}
