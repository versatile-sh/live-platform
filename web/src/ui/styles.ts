/** Card surface shared by panels, tiles and dialogs: a speech bubble with a hairline border. */
export const SURFACE = "bubble border border-line-strong bg-card";

/** Press feedback for anything clickable that is drawn as a button. */
export const PRESS = "transition-[background-color,border-color,color,opacity,transform,filter] duration-150 active:scale-[0.97]";

/** Quiet underlined text link. */
export const QUIET_LINK = "cursor-pointer underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg hover:decoration-fg";

type ButtonOptions = { variant?: "primary" | "accent" | "secondary" | "quiet" | "ink" | "onInk"; size?: "xs" | "sm" | "md" | "lg" };

const BUTTON_VARIANT = {
  primary: "bg-fg text-canvas hover:opacity-90 focus-visible:opacity-90 disabled:opacity-60",
  accent: "bg-bubble text-on-bubble hover:brightness-110 focus-visible:brightness-110 disabled:opacity-60",
  secondary: "border border-line-strong text-fg hover:border-fg/60 focus-visible:border-fg/60 disabled:opacity-60",
  ink: "bg-ink text-paper hover:opacity-85 focus-visible:opacity-85 disabled:opacity-60",
  onInk: "border border-paper/30 text-paper hover:border-paper/70 focus-visible:border-paper/70 disabled:opacity-60",
  quiet: "text-muted hover:bg-fg/8 hover:text-fg focus-visible:bg-fg/8 focus-visible:text-fg disabled:opacity-60",
} as const;

const BUTTON_SIZE = { xs: "h-8 px-3 text-xs", sm: "h-9 px-4 text-sm", md: "h-11 px-6 text-[0.9375rem]", lg: "h-12 px-5 text-base" } as const;

/** Class string of the one button language, for links and real buttons alike: a small bubble with its tail. */
export function button({ variant = "primary", size = "md" }: ButtonOptions = {}): string {
  return `bubble-word inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap ${PRESS} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`;
}

/** Visible keyboard focus for a control drawn without a skin of its own. */
export const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg";

/** A round avatar that is also a button: small, pressed like the rest, ringed on keyboard focus. */
export const AVATAR_BUTTON = `rounded-full ${PRESS} ${FOCUS_RING}`;

/** Class string of a button that is only an icon: round, quiet until pointed at. Everything with words is a `button()`. */
export const ICON_BUTTON = `grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-fg/10 hover:text-fg ${PRESS}`;

/** Class string of a small choice that stays pressed: a bubble that turns lime when on (`aria-pressed` or `aria-checked`). */
export const CHIP = `bubble-word inline-flex h-8 shrink-0 items-center justify-center gap-2 border border-line-strong px-3 text-xs font-semibold whitespace-nowrap text-muted hover:border-fg/50 aria-checked:border-transparent aria-checked:bg-bubble aria-checked:text-on-bubble aria-pressed:border-transparent aria-pressed:bg-bubble aria-pressed:text-on-bubble ${PRESS}`;

/** The icon button on ink or on lime, where the page's own colours would not read: it takes the colour of the text around it. */
export const ICON_BUTTON_PLAIN = `grid size-9 shrink-0 place-items-center rounded-full hover:bg-current/15 ${PRESS}`;


/** The chip on an ink surface: it turns paper when on. */
export const CHIP_ON_INK = `bubble-word inline-flex h-8 shrink-0 items-center justify-center gap-2 border border-paper/30 px-3.5 text-sm font-semibold whitespace-nowrap text-paper/70 hover:text-paper aria-pressed:border-paper aria-pressed:bg-paper aria-pressed:text-ink ${PRESS}`;

/**
 * The round controls of the call. A dock toggle is `round`, or a `split` pill holding its `main` button and a `caret` for its options; either wears `on` (lime) or `off` (card, ringed).
 * The toggles at the top are `top`, `quiet` until their panel or menu is `open`.
 */
export const DOCK = {
  round: `relative grid size-12 shrink-0 place-items-center rounded-full disabled:opacity-40 ${PRESS}`,
  split: `relative flex h-12 shrink-0 items-center rounded-full ${PRESS}`,
  main: "grid size-12 shrink-0 place-items-center rounded-l-full transition-colors duration-150 hover:bg-current/10 disabled:opacity-40 max-sm:rounded-r-full",
  caret: "relative grid h-12 w-9 place-items-center rounded-r-full transition-colors duration-150 before:absolute before:inset-y-3.5 before:left-0 before:w-px before:bg-current/25 hover:bg-current/10 max-sm:hidden",
  on: "bg-bubble text-on-bubble hover:opacity-85",
  off: "bg-card text-fg ring-1 ring-muted-light ring-inset hover:ring-fg",
  top: `relative grid size-10 shrink-0 place-items-center rounded-full ${PRESS}`,
  topLabeled: `relative inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-semibold max-sm:w-10 max-sm:justify-center max-sm:px-0 ${PRESS}`,
  quiet: "text-fg hover:bg-fg/10",
  open: "bg-fg text-canvas hover:opacity-85",
} as const;

/** The fixed link under the front page that moves it to the next stop or back; on the lime stop it turns ink. */
export const CONVEYOR_LINK = `bubble-word mx-auto inline-flex h-10 w-56 shrink-0 items-center justify-center gap-2 border border-line-strong text-sm font-semibold text-muted  hover:border-fg/50 hover:text-fg group-data-[view=lobby]:border-ink group-data-[view=lobby]:bg-ink group-data-[view=lobby]:text-paper group-data-[view=lobby]:hover:opacity-85 ${PRESS} duration-500`;

/** The icon button that sends or confirms: round and filled. */
export const ICON_BUTTON_SOLID = `grid size-9 shrink-0 place-items-center rounded-full bg-fg text-canvas hover:opacity-85 disabled:opacity-30 ${PRESS}`;

/** A colour to pick: a round swatch ringed when chosen (`aria-checked`). */
export const SWATCH = "size-7 rounded-full border border-fg/25 outline-2 outline-offset-2 outline-transparent transition-[scale,outline-color] duration-200 hover:scale-110 aria-checked:outline-fg";
