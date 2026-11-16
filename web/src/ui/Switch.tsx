import type { ReactNode } from "react";

/** An on/off choice as a labelled switch: the whole row is the target, and the thumb slides. */
export function Switch({ checked, onChange, children, hint }: { checked: boolean; onChange(checked: boolean): void; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold">{children}</span>
        {hint ? <span className="text-[0.8125rem] leading-snug text-muted">{hint}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-line-strong transition-colors duration-300 peer-checked:bg-bubble peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-fg/55 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-paper after:transition-transform after:duration-300 peer-checked:after:translate-x-5 peer-checked:after:bg-ink"
      />
    </label>
  );
}
