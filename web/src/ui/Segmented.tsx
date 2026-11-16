type SegmentedProps<T extends string> = {
  label: string;
  options: readonly [{ value: T; text: string }, { value: T; text: string }];
  value: T;
  onChange(value: T): void;
  tone?: "fg" | "ink" | "paper";
  className?: string;
};

const TONE = {
  fg: { frame: "border-line-strong", thumb: "bg-fg", idle: "text-muted hover:text-fg", active: "aria-pressed:text-canvas" },
  ink: { frame: "border-ink/35", thumb: "bg-ink", idle: "text-ink/70 hover:text-ink", active: "aria-pressed:text-paper" },
  paper: { frame: "border-paper/30", thumb: "bg-paper", idle: "text-paper/70 hover:text-paper", active: "aria-pressed:text-ink" },
} as const;

/** A choice between two things as a pill whose thumb slides to the chosen one. */
export function Segmented<T extends string>({ label, options, value, onChange, tone = "fg", className = "" }: SegmentedProps<T>) {
  const colours = TONE[tone];
  const second = value === options[1].value;
  return (
    <div role="group" aria-label={label} data-second={second} className={`group/seg relative flex h-10 rounded-full border p-1 ${colours.frame} ${className}`}>
      <span aria-hidden="true" className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full transition-transform duration-500 ease-(--ease-glide) group-data-[second=true]/seg:translate-x-full ${colours.thumb}`} />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`relative z-10 h-full flex-1 rounded-full px-4 text-sm font-semibold transition-colors duration-300 ${colours.idle} ${colours.active}`}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
