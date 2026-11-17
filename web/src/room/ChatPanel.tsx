import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

import { useLocale, useT } from "../i18n/I18nProvider";
import { EMOJI, linkify } from "../domain/links";
import type { ChatLine } from "../session/session";
import type { Person } from "../signal/protocol";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/icons";
import { Segmented } from "../ui/Segmented";
import { ICON_BUTTON, ICON_BUTTON_SOLID } from "../ui/styles";

type ChatPanelProps = {
  lines: readonly ChatLine[];
  me: number | undefined;
  people: readonly Person[];
  photos: Readonly<Record<number, string>>;
  canSend: boolean;
  peer: number | undefined;
  onPeer(pid: number | undefined): void;
  privately: boolean;
  onPrivately(privately: boolean): void;
  /** How many private lines from each person I have not read yet, by participant id. */
  unread: Readonly<Record<number, number>>;
  onSay(text: string, to?: number, image?: string): boolean;
};

const MAX = 500;

function intoView(element: HTMLLIElement | null) {
  element?.scrollIntoView?.({ block: "end" });
}

/** The room's conversation as bubbles: mine on the right in lime, the others on the left, newest at the bottom and kept in view. */
export function ChatPanel({
  lines: all,
  me,
  people,
  photos,
  canSend,
  peer,
  onPeer,
  privately,
  onPrivately,
  unread,
  onSay,
}: ChatPanelProps) {
  const t = useT();
  const id = useId();
  const clock = new Intl.DateTimeFormat(useLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
  const [draft, setDraft] = useState("");
  const waiting = Object.values(unread).reduce((sum, count) => sum + count, 0);
  const [pickingEmoji, setPickingEmoji] = useState(false);
  const others = people.filter((person) => person.pid !== me);
  const target = privately
    ? others.find((person) => person.pid === peer)
    : undefined;
  const lines = privately
    ? all.filter(
        (line) =>
          line.to !== undefined &&
          target !== undefined &&
          (line.pid === target.pid || line.to === target.pid),
      )
    : all.filter((line) => line.to === undefined);
  const picking = privately && target === undefined;
  const ready = canSend && !picking;

  function send() {
    const text = draft.trim();
    if (text && ready && onSay(text, target?.pid)) setDraft("");
  }


  function submit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function onKey(event: KeyboardEvent) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    send();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <Segmented<"room" | "private">
          label={t("chat.audience")}
          value={privately ? "private" : "room"}
          onChange={(next) => onPrivately(next === "private")}
          options={[
            { value: "room", text: t("chat.room") },
            { value: "private", text: waiting > 0 ? `${t("chat.private")} · ${waiting}` : t("chat.private") },
          ]}
        />
        {target ? (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label={t("chat.others")}
              className={ICON_BUTTON}
              onClick={() => onPeer(undefined)}
            >
              <Icon name="back" className="size-4" />
            </button>
            <Avatar
              look={target.look}
              face={target.face}
              name={target.name}
              photo={photos[target.pid]}
              className="text-[1.75rem]"
            />
            <span
              className="min-w-0 truncate text-sm font-semibold"
              translate="no"
            >
              {target.name}
            </span>
          </div>
        ) : null}
      </div>
      <div key={privately ? "private" : "room"} className={`flex min-h-0 flex-1 flex-col ${privately ? "swap-from-right" : "swap-from-left"}`}>
      <div key={target ? `to-${target.pid}` : "all"} className="arrive flex min-h-0 flex-1 flex-col">
      {picking ? (
        others.length === 0 ? (
          <p className="m-auto max-w-56 text-center text-sm text-muted">
            {t("chat.nobody")}
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-3">
            <p className="px-1 pb-2 text-sm text-muted">{t("chat.pick")}</p>
            <ul
              aria-label={t("chat.with")}
              className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
            >
              {others.map((person) => (
                <li key={person.pid}>
                  <button
                    type="button"
                    className="bubble flex h-14 w-full items-center gap-3 border border-line-strong bg-canvas px-3 text-left text-sm font-semibold transition-colors duration-200 hover:border-accent"
                    onClick={() => onPeer(person.pid)}
                  >
                    <Avatar
                      look={person.look}
                      face={person.face}
                      name={person.name}
                      photo={photos[person.pid]}
                      className="text-[2rem]"
                    />
                    <span className="min-w-0 flex-1 truncate" translate="no">
                      {person.name}
                    </span>
                    {(unread[person.pid] ?? 0) > 0 ? (
                      <span className="grid min-w-5 place-items-center rounded-full bg-bubble px-1 font-mono text-[0.6875rem] leading-5 font-bold text-on-bubble">
                        {(unread[person.pid] ?? 0)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <>
          {lines.length === 0 ? (
            <p className="m-auto max-w-56 text-center text-sm text-muted">
              {t(target ? "chat.emptyPrivate" : "chat.empty")}
            </p>
          ) : (
            <ol
              aria-label={t("chat.log")}
              aria-live="polite"
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3"
            >
              {lines.map((line, index) => {
                const mine = line.pid === me;
                const follows = lines[index - 1]?.pid === line.pid;
                return (
                  <li
                    key={line.id}
                    ref={index === lines.length - 1 ? intoView : undefined}
                    className={`arrive flex flex-col ${mine ? "items-end" : "items-start"} ${follows ? "" : "mt-2.5"}`}
                  >
                    {follows ? null : (
                      <span className="mb-1 px-1 text-xs text-muted">
                        <span className="font-semibold text-fg" translate="no">
                          {mine ? t("room.you") : line.name}
                        </span>{" "}
                        <time
                          dateTime={new Date(line.at).toISOString()}
                          className="font-mono"
                        >
                          {clock.format(line.at)}
                        </time>
                      </span>
                    )}
                    <span
                      className={`selectable max-w-[85%] px-3.5 py-2 text-[0.9375rem] leading-snug break-words whitespace-pre-wrap ${
                        mine
                          ? "bubble-sent bg-bubble text-on-bubble"
                          : "bubble border border-line-strong bg-canvas"
                      }`}
                    >
                      {line.image ? <img src={line.image} alt={t("chat.picture", { name: line.name })} className={`block max-h-44 max-w-full rounded-md ${line.text ? "mb-1.5" : ""}`} /> : null}
                      {linkify(line.text).map((piece, at) =>
                        piece.href ? (
                          <a key={at} href={piece.href} target="_blank" rel="noreferrer noopener" className="underline decoration-current/50 underline-offset-2 hover:decoration-current">
                            {piece.text}
                          </a>
                        ) : (
                          piece.text
                        ),
                      )}
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
            {pickingEmoji ? (
              <div role="group" aria-label={t("chat.emoji")} className="swap-in bubble mb-2 grid grid-cols-8 gap-0.5 border border-line-strong bg-canvas p-2">
                {EMOJI.map((emoji) => (
                  <button key={emoji} type="button" aria-label={emoji} className="grid aspect-square place-items-center rounded-md text-lg transition-colors duration-150 hover:bg-fg/10" onClick={() => setDraft((text) => (text + emoji).slice(0, MAX))}>
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-1 bubble border border-line-strong bg-canvas py-1.5 pr-1.5 pl-4 transition-colors duration-200 focus-within:border-fg/50">
              <textarea
                id={id}
                rows={1}
                value={draft}
                maxLength={MAX}
                disabled={!ready}
                placeholder={
                  target
                    ? t("chat.placeholderTo", { name: target.name })
                    : t("chat.placeholder")
                }
                className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[0.9375rem] leading-snug text-fg placeholder:text-muted-light focus-visible:outline-none disabled:opacity-50 [field-sizing:content]"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKey}
              />
              <button type="button" aria-expanded={pickingEmoji} aria-label={t("chat.emoji")} title={t("chat.emoji")} disabled={!ready} className={ICON_BUTTON} onClick={() => setPickingEmoji((open) => !open)}>
                <span aria-hidden="true" className="text-base leading-none">☺</span>
              </button>
              <button
                type="submit"
                disabled={!ready || draft.trim() === ""}
                aria-label={t("chat.send")}
                className={ICON_BUTTON_SOLID}
              >
                <Icon name="send" className="size-4" />
              </button>
            </div>
          </form>
        </>
      )}
      </div>
      </div>
    </div>
  );
}
