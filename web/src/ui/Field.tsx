import { useId, type ComponentProps, type ReactNode } from "react";

type FieldProps = Omit<ComponentProps<"input">, "id" | "aria-invalid" | "aria-describedby" | "prefix"> & {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  prefix?: ReactNode;
  mono?: boolean;
  large?: boolean;
  className?: string;
};

const BOX = "bubble mt-1.5 flex items-center border border-muted-light bg-canvas transition-colors duration-200 focus-within:border-fg/50 has-aria-invalid:border-amber";
const INPUT = "h-full min-w-0 flex-1 bg-transparent text-fg placeholder:text-muted-light focus-visible:outline-none";

/** The one text field: a label, the input (with an optional fixed prefix), and a note below that keeps its height whether it holds the hint or the error. */
export function Field({ label, hint, error, prefix, mono = false, large = false, className = "", ...input }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className={`${BOX} ${large ? "h-14" : "h-11"} ${prefix ? "pl-3.5" : ""}`}>
        {prefix ? (
          <span aria-hidden="true" className="shrink-0 font-mono text-sm text-muted select-none" translate="no">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-note`}
          className={`${INPUT} ${prefix ? "pr-3.5 pl-0.5" : "px-3.5"} ${mono ? "font-mono" : ""} ${large ? "text-xl font-bold tracking-[0.12em] uppercase placeholder:font-normal" : mono ? "text-sm" : ""}`}
          {...input}
        />
      </div>
      <p id={`${id}-note`} className={`mt-1.5 min-h-5 text-sm ${error ? "text-amber" : "text-muted"}`}>
        {error ?? hint}
      </p>
    </div>
  );
}
