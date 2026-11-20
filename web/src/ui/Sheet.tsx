import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "./icons";
import { ICON_BUTTON } from "./styles";

/**
 * The one modal window, in the shape of a message sent; on a phone it fills the screen. It closes on its button, Escape or a click outside, and gives focus back to what opened it.
 * A `bare` sheet leaves padding and scrolling to its content, for a panel that brings its own.
 */
export function Sheet({ title, icon, closeLabel, onClose, children, wide = false, bare = false }: { title: string; icon?: IconName; closeLabel: string; onClose(): void; children: ReactNode; wide?: boolean; bare?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [opener]);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={`sheet swap-in m-auto max-h-[calc(100dvh-2rem)] max-w-none flex-col overflow-hidden bubble-sent border border-line-strong bg-card p-0 text-fg backdrop:bg-ink/60 open:flex max-md:size-full max-md:max-h-none max-md:border-0 ${wide ? "w-[min(58rem,calc(100vw-2rem))]" : "w-[min(26rem,calc(100vw-2rem))]"}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 py-3 pr-3 pl-5">
        <h2 className="flex items-center gap-2.5 font-display text-xl font-bold tracking-[-0.03em]">
          {icon ? <Icon name={icon} className="size-6 shrink-0 text-accent" /> : null}
          {title}
        </h2>
        <button type="button" aria-label={closeLabel} className={ICON_BUTTON} onClick={onClose}>
          <Icon name="close" className="size-4" />
        </button>
      </div>
      <div className={bare ? "flex min-h-0 flex-1 flex-col" : "no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-5"}>{children}</div>
    </dialog>
  );
}
