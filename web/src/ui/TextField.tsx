import { useId, type ComponentProps, type ReactNode } from "react";

import { FIELD } from "./styles";

type TextFieldProps = Omit<ComponentProps<"input">, "id" | "aria-invalid" | "aria-describedby"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
  actions?: ReactNode;
  noteClassName?: string;
};

/** Labelled input whose hint and error are announced with it. The error slot keeps its height so the form never jumps. */
export function TextField({ label, hint, error, trailing, actions, noteClassName = "min-h-5", ...input }: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input id={id} className={FIELD} aria-invalid={error ? true : undefined} aria-describedby={note ? noteId : undefined} {...input} />
        {trailing}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      <p id={noteId} className={`${noteClassName} text-sm ${error ? "text-amber" : "text-muted"}`}>
        {note}
      </p>
    </div>
  );
}
