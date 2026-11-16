import { useId, type ReactNode } from "react";

type SliderProps = { label: ReactNode; hint?: ReactNode; value: number; min: number; max: number; step?: number; format(value: number): string; onChange(value: number): void; disabled?: boolean };

/** A number chosen along a line, with its name above, the value beside it in the mono face, and a word of explanation below. */
export function Slider({ label, hint, value, min, max, step = 1, format, onChange, disabled = false }: SliderProps) {
  const id = useId();
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-3">
        <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} className="h-8 min-w-0 flex-1 accent-(--color-bubble)" onChange={(event) => onChange(Number(event.target.value))} />
        <output htmlFor={id} className="w-16 text-right font-mono text-xs text-accent tabular-nums">
          {format(value)}
        </output>
      </div>
      {hint ? <p className="text-[0.8125rem] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}
