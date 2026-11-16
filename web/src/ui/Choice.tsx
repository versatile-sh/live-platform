import type { ReactNode } from "react";

import { CHIP } from "./styles";

type ChoiceProps<T extends string> = { label: string; hint?: ReactNode; options: readonly { value: T; text: string }[]; value: T; onChange(value: T): void };

/** One of several things, each a chip that turns lime when it is the one chosen. */
export function Choice<T extends string>({ label, hint, options, value, onChange }: ChoiceProps<T>) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={CHIP} onClick={() => onChange(option.value)}>
            {option.text}
          </button>
        ))}
      </div>
      {hint ? <p className="mt-1.5 text-[0.8125rem] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}
