import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

import { useLocale, useT } from "../i18n/I18nProvider";
import type { ChatLine } from "../session/session";
import { Icon } from "../ui/icons";

type ChatPanelProps = { lines: readonly ChatLine[]; me: number | undefined; canSend: boolean; onSay(text: string): boolean };

const MAX = 500;

function intoView(element: HTMLLIElement | null) {
  element?.scrollIntoView?.({ block: "end" });
}

/** The room's conversation as bubbles: mine on the right in lime, the others on the left, newest at the bottom and kept in view. */
export function ChatPanel({ lines, me, canSend, onSay }: ChatPanelProps) {
  const t = useT();
  const id = useId();
  const clock = new Intl.DateTimeFormat(useLocale(), { hour: "2-digit", minute: "2-digit" });
  const [draft, setDraft] = useState("");

  function send() {
    const text = draft.trim();
    if (text && onSay(text)) setDraft("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {lines.length === 0 ? (
        <p className="m-auto max-w-56 text-center text-sm text-muted">{t("chat.empty")}</p>
      ) : (
        <ol aria-label={t("chat.log")} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3">
          {lines.map((line, index) => {
            const mine = line.pid === me;
            const follows = lines[index - 1]?.pid === line.pid;
            return (
              <li key={line.id} ref={index === lines.length - 1 ? intoView : undefined} className={`flex flex-col ${mine ? "items-end" : "items-start"} ${follows ? "" : "mt-2.5"}`}>
                {follows ? null : (
                  <span className="mb-1 px-1 text-xs text-muted">
                    <span className="font-semibold text-fg" translate="no">
                      {mine ? t("room.you") : line.name}
                    </span>{" "}
                    <time dateTime={new Date(line.at).toISOString()} className="font-mono">
                      {clock.format(line.at)}
                    </time>
                  </span>
                )}
                <span
                  className={`max-w-[85%] px-3.5 py-2 text-[0.9375rem] leading-snug break-words whitespace-pre-wrap ${
                    mine ? "rounded-[1.1rem] rounded-br-[0.3rem] bg-bubble text-on-bubble" : "rounded-[1.1rem] rounded-bl-[0.3rem] border border-line-strong bg-canvas"
                  }`}
                >
                  {line.text}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <form onSubmit={submit} className="shrink-0 p-3">
        <label htmlFor={id} className="sr-only">
          {t("chat.label")}
        </label>
        <div className="flex items-end gap-2 rounded-[1.25rem] border border-line-strong bg-canvas py-1.5 pr-1.5 pl-4 transition-colors duration-200 focus-within:border-fg/50">
          <textarea
            id={id}
            rows={1}
            value={draft}
            maxLength={MAX}
            disabled={!canSend}
            placeholder={t("chat.placeholder")}
            className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[0.9375rem] leading-snug text-fg placeholder:text-muted-light focus-visible:outline-none disabled:opacity-50 [field-sizing:content]"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
          />
          <button type="submit" disabled={!canSend || draft.trim() === ""} aria-label={t("chat.send")} className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-canvas transition-opacity duration-200 hover:opacity-85 disabled:opacity-30">
            <Icon name="send" className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
