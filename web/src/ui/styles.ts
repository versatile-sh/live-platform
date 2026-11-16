/** Card surface shared by panels, tiles and dialogs: a speech bubble with a hairline border. */
export const SURFACE = "bubble border border-line-strong bg-card";

/** Press feedback for anything clickable that is drawn as a button. */
export const PRESS = "transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[0.97]";

/** Quiet underlined text link. */
export const QUIET_LINK = "cursor-pointer underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg hover:decoration-fg";

type ButtonOptions = { variant?: "primary" | "secondary" | "quiet"; size?: "sm" | "md" };

const BUTTON_VARIANT = {
  primary: "bg-fg text-canvas hover:opacity-90 focus-visible:opacity-90 disabled:opacity-60",
  secondary: "border border-line-strong text-fg hover:border-fg/60 focus-visible:border-fg/60 disabled:opacity-60",
  quiet: "text-muted hover:bg-fg/8 hover:text-fg focus-visible:bg-fg/8 focus-visible:text-fg disabled:opacity-60",
} as const;

const BUTTON_SIZE = { sm: "h-9 px-4 text-sm", md: "h-11 px-6 text-[0.9375rem]" } as const;

/** Class string of the one button language, for links and real buttons alike: a small bubble with its tail. */
export function button({ variant = "primary", size = "md" }: ButtonOptions = {}): string {
  return `inline-flex shrink-0 items-center justify-center rounded-[0.8rem] rounded-bl-[0.2rem] font-semibold whitespace-nowrap ${PRESS} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`;
}
