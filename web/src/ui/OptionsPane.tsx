import { createContext, use, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal, flushSync } from "react-dom";

import { Arrow } from "./Arrow";
import { Icon } from "./icons";
import { button } from "./styles";

/** Where a page keeps a form's options: whether they are shown, how to change that, and the element they are drawn into (none draws them in place). */
export type OptionsPlace = { open: boolean; onOpen(open: boolean): void; target: HTMLElement | null };

/** Gives the forms below a page the place for their options. */
export const OptionsPlaceContext = createContext<OptionsPlace | undefined>(undefined);

/** A form's options: their place, a way to show them that moves focus to their first field, and a way to hide them that moves it back to the toggle. */
export type OptionsPaneControl = OptionsPlace & { show(): void; hide(): void; toggle: RefObject<HTMLButtonElement | null>; panel: RefObject<HTMLDivElement | null> };

/** The options of one form, held by the page around it when the page offers a place, and by the form otherwise. */
export function useOptionsPane(): OptionsPaneControl {
  const place = use(OptionsPlaceContext);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const held = place ?? { open, onOpen: setOpen, target: null };
  return {
    ...held,
    toggle,
    panel,
    show() {
      flushSync(() => held.onOpen(true));
      panel.current?.querySelector("input")?.focus({ preventScroll: true });
    },
    hide() {
      flushSync(() => held.onOpen(false));
      toggle.current?.focus({ preventScroll: true });
    },
  };
}

type OptionsPaneProps = { control: OptionsPaneControl; label: string; back: string; children: ReactNode; className?: string };

/** Options one click away: a quiet toggle that says whether they are shown, and a pane with a way back, drawn in the page's place for it (beside the form, or over it on a phone). Hidden, nothing in the pane can be reached; Escape hides it. */
export function OptionsPane({ control, label, back, children, className = "" }: OptionsPaneProps) {
  const id = useId();
  const pane = (
    <div
      ref={control.panel}
      id={id}
      role="region"
      aria-label={label}
      inert={!control.open}
      className="no-scrollbar flex size-full overflow-y-auto px-6 py-5 sm:px-10 lg:px-14 lg:py-10"
      onKeyDown={(event) => {
        if (event.key === "Escape") control.hide();
      }}
    >
      <div className="m-auto w-full max-w-md">
        <button type="button" className={`${button({ variant: "quiet", size: "sm" })} mb-4 -ml-4`} onClick={control.hide}>
          <Arrow back />
          {back}
        </button>
        {children}
      </div>
    </div>
  );
  return (
    <>
      <button
        ref={control.toggle}
        type="button"
        aria-expanded={control.open}
        aria-controls={id}
        className={`${button({ variant: "quiet", size: "sm" })} -ml-4 aria-expanded:bg-fg/8 aria-expanded:text-fg ${className}`}
        onClick={control.open ? control.hide : control.show}
      >
        {label}
        <Icon name="back" className={`size-4 transition-transform duration-700 ease-(--ease-glide) ${control.open ? "" : "rotate-180"}`} />
      </button>
      {control.target ? createPortal(pane, control.target) : pane}
    </>
  );
}
