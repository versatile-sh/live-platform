import type { ReactNode } from "react";

type BubbleProps = { tone?: "accent" | "neutral" | "amber"; children: ReactNode };

const TONE = {
  accent: "bg-bubble text-on-bubble",
  neutral: "border border-line-strong text-muted",
  amber: "border border-amber text-amber",
} as const;

/** A few words in a small bubble: a status, a role, a flag. */
export function Bubble({ tone = "neutral", children }: BubbleProps) {
  return <span className={`bubble-word inline-block px-2 py-0.5 font-mono text-xs ${TONE[tone]}`}>{children}</span>;
}
