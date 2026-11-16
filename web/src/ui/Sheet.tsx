import type { ReactNode } from "react";

import { Icon } from "./icons";
import { ICON_BUTTON } from "./styles";

/** A small window in the shape of a message sent: round, with its tail at the bottom right. It closes on its button or on a click outside. */
export function Sheet({ title, closeLabel, onClose, children, wide = false }: { title: string; closeLabel: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <button type="button" aria-label={closeLabel} className="fixed inset-0 z-30 cursor-default bg-ink/60" onClick={onClose} />
      <section
        role="dialog"
        aria-label={title}
        className={`swap-in fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100dvh-2rem)] -translate-1/2 flex-col bubble-sent border border-line-strong bg-card ${wide ? "w-[min(58rem,calc(100vw-2rem))]" : "w-[min(26rem,calc(100vw-2rem))]"}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 py-3 pr-3 pl-5">
          <h2 className="font-display text-xl font-bold tracking-[-0.03em]">{title}</h2>
          <button type="button" aria-label={closeLabel} className={ICON_BUTTON} onClick={onClose}>
            <Icon name="close" className="size-4" />
          </button>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </section>
    </>
  );
}
