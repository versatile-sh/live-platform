import { useId, useState, type KeyboardEvent } from "react";

import { useT } from "../i18n/I18nProvider";

/** One thing the palette can do: where it belongs, what it is called, the keys that do the same, and what happens. */
export type Command = { id: string; group: string; label: string; keys?: string; run(): void };

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Keeps the commands whose group and label hold every word typed, in any order, ignoring case and accents. */
export function searchCommands(commands: readonly Command[], query: string): Command[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    const text = fold(`${command.group} ${command.label}`);
    return words.every((word) => text.includes(word));
  });
}

function intoView(element: HTMLLIElement | null) {
  element?.scrollIntoView?.({ block: "nearest" });
}

/** Everything that can be done here, found by typing: a window in the shape of a message sent, worked entirely from the keyboard. */
export function CommandPalette({ commands, onClose }: { commands: readonly Command[]; onClose(): void }) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const found = searchCommands(commands, query);
  const groups = [...new Set(found.map((command) => command.group))];
  const ordered = groups.flatMap((group) => found.filter((command) => command.group === group));
  const at = Math.min(active, Math.max(ordered.length - 1, 0));

  function run(command: Command | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  function key(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (ordered.length > 0) setActive((at + (event.key === "ArrowDown" ? 1 : ordered.length - 1)) % ordered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(ordered[at]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <>
      <button type="button" aria-label={t("palette.close")} tabIndex={-1} className="fixed inset-0 z-40 cursor-default bg-ink/60" onClick={onClose} />
      <section role="dialog" aria-label={t("palette.label")} className="swap-in fixed top-[12vh] left-1/2 z-50 flex max-h-[min(34rem,76vh)] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 flex-col bubble-sent border border-line-strong bg-card">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={ordered[at] ? `${id}-${ordered[at].id}` : undefined}
            aria-label={t("palette.label")}
            autoFocus
            value={query}
            placeholder={t("palette.placeholder")}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-fg placeholder:text-muted-light focus-visible:outline-none"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={key}
          />
        </div>
        <ul id={`${id}-list`} role="listbox" aria-label={t("palette.results")} className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {found.length === 0 ? (
            <li role="option" aria-selected="false" aria-disabled="true" className="px-3 py-8 text-center text-sm text-muted">
              {t("palette.nothing")}
            </li>
          ) : null}
          {groups.map((group) => (
            <li key={group} role="presentation" className="pb-1">
              <p className="px-3 pt-2 pb-1 font-mono text-xs text-accent">{group}</p>
              <ul role="group" aria-label={group} className="flex flex-col gap-0.5">
                {ordered
                  .filter((command) => command.group === group)
                  .map((command) => {
                    const selected = ordered[at] === command;
                    return (
                      <li
                        key={command.id}
                        id={`${id}-${command.id}`}
                        role="option"
                        aria-selected={selected}
                        ref={selected ? intoView : undefined}
                        className="flex h-11 cursor-pointer items-center justify-between gap-3 bubble px-3.5 text-sm transition-colors duration-150 aria-selected:bg-bubble aria-selected:font-semibold aria-selected:text-on-bubble"
                        onPointerMove={() => setActive(ordered.indexOf(command))}
                        onClick={() => run(command)}
                      >
                        <span className="min-w-0 truncate">{command.label}</span>
                        {command.keys ? <kbd className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.6875rem] ${selected ? "border-ink/30" : "border-line-strong text-muted"}`}>{command.keys}</kbd> : null}
                      </li>
                    );
                  })}
              </ul>
            </li>
          ))}
        </ul>
        <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-t border-line px-5 text-xs text-muted">
          <span className="tabular-nums">{t("palette.count", { count: found.length })}</span>
          <span aria-hidden="true" className="hidden items-center gap-4 sm:flex">
            {(
              [
                ["↑↓", "palette.move"],
                ["Enter", "palette.open"],
                ["Esc", "palette.shut"],
              ] as const
            ).map(([keys, word]) => (
              <span key={word} className="flex items-center gap-1.5">
                <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[0.6875rem]">{keys}</kbd>
                {t(word)}
              </span>
            ))}
          </span>
        </div>
      </section>
    </>
  );
}
