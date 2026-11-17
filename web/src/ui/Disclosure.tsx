import { useId, type ReactNode } from "react";

import { Icon } from "./icons";
import { button } from "./styles";

type DisclosureProps = { label: string; open: boolean; onOpen(open: boolean): void; children: ReactNode; className?: string };

/** Options kept one click away: a quiet button that says whether they are shown, and below it what it shows, sliding open. Closed, nothing inside can be reached. */
export function Disclosure({ label, open, onOpen, children, className = "" }: DisclosureProps) {
  const id = useId();
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} aria-controls={id} className={`${button({ variant: "quiet", size: "sm" })} -ml-4`} onClick={() => onOpen(!open)}>
        {label}
        <Icon name="back" className={`size-4 transition-transform duration-300 ${open ? "rotate-90" : "-rotate-90"}`} />
      </button>
      <div id={id} className={`grid transition-[grid-template-rows,opacity] duration-500 ease-(--ease-glide) ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div inert={!open} className="min-w-0 overflow-hidden">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
