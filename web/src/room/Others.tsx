import type { ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import { Icon } from "../ui/icons";
import { FOCUS_RING, PRESS } from "../ui/styles";

type OthersProps = {
  hidden: boolean;
  count: number;
  onToggle(): void;
  children: ReactNode;
};

/** The strip of everyone beside the one in front: open, a handle on its inner edge folds it; folded, it is a thin rail with an arrow and how many are there, which opens it again. */
export function Others({ hidden, count, onToggle, children }: OthersProps) {
  const t = useT();
  const label = t(hidden ? "stage.showOthers" : "stage.hideOthers", { count });
  const toggle = { type: "button" as const, "aria-expanded": !hidden, "aria-controls": "stage-others", "aria-keyshortcuts": "Control+Alt+O", title: `${label} (Ctrl+Alt+O)`, onClick: onToggle };
  const fade = "absolute inset-0 transition-opacity duration-300 ease-(--ease-glide) motion-reduce:transition-none";
  return (
    <div className={`relative flex min-h-0 min-w-0 shrink-0 transition-[width,height] duration-500 ease-(--ease-glide) motion-reduce:transition-none ${hidden ? "max-lg:h-9 lg:w-9" : "max-lg:h-28 lg:w-52"}`}>
      {hidden ? null : (
        <button
          {...toggle}
          className={`bubble absolute z-10 grid place-items-center border border-line-strong bg-card text-muted hover:text-fg max-lg:-top-2.5 max-lg:left-1/2 max-lg:h-5 max-lg:w-14 max-lg:-translate-x-1/2 lg:top-1/2 lg:-left-2.5 lg:h-14 lg:w-5 lg:-translate-y-1/2 ${PRESS} ${FOCUS_RING}`}
        >
          <span className="sr-only">{label}</span>
          <Icon name="chevron" className="size-4 max-lg:rotate-90" />
        </button>
      )}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <ul
          id="stage-others"
          aria-label={t("stage.others")}
          aria-hidden={hidden}
          inert={hidden}
          className={`no-scrollbar flex gap-3 overflow-auto max-lg:top-auto max-lg:h-28 max-lg:[&>li]:h-full max-lg:[&>li]:w-auto lg:right-0 lg:left-auto lg:w-52 lg:flex-col ${fade} ${hidden ? "opacity-0" : "opacity-100"}`}
        >
          {children}
        </ul>
        <button
          {...toggle}
          inert={!hidden}
          aria-hidden={!hidden}
          className={`bubble flex items-center justify-center gap-1.5 border border-line-strong bg-card text-muted hover:text-fg lg:flex-col ${PRESS} ${FOCUS_RING} ${fade} ${hidden ? "opacity-100 delay-200" : "opacity-0"}`}
        >
          <span className="sr-only">{label}</span>
          <Icon name="chevron" className="size-4 rotate-180 max-lg:rotate-90" />
          <span aria-hidden="true" className="font-mono text-xs font-bold">
            {count}
          </span>
        </button>
      </div>
    </div>
  );
}
