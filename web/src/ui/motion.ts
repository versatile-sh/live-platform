import { flushSync } from "react-dom";

/** The ways one screen gives place to another: words changing where they stand, a step back to where one came from, and a step forward. */
export type Motion = "words" | "back" | "forward";

type TransitionPage = Document & { startViewTransition?: (update: () => void) => { finished: Promise<unknown> } };

/** Applies a change to the screen as one movement of the kind named, where the browser can; elsewhere the change is simply made. */
export function withMotion(kind: Motion, update: () => void): void {
  const page = document as TransitionPage;
  if (!page.startViewTransition) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.motion = kind;
  const clear = () => {
    if (root.dataset.motion === kind) delete root.dataset.motion;
  };
  page.startViewTransition(() => flushSync(update)).finished.then(clear, clear);
}

/**
 * The iris as clip-path circles in percentages of the screen: Chromium draws a view transition's snapshot without the page zoom,
 * so pixel values would put the circle off the point under a zoomed page.
 */
export function irisFrames(at: { x: number; y: number }, view: { width: number; height: number }): [string, string] {
  const center = `${(at.x / view.width) * 100}% ${(at.y / view.height) * 100}%`;
  const reach = Math.hypot(Math.max(at.x, view.width - at.x), Math.max(at.y, view.height - at.y)) / (Math.hypot(view.width, view.height) / Math.SQRT2);
  return [`circle(0% at ${center})`, `circle(${reach * 100}% at ${center})`];
}

/** Applies a change to the screen as a circle that opens from a point until it covers everything, where the browser can; elsewhere the change is simply made. */
export function withIris(at: { x: number; y: number }, update: () => void): void {
  const page = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<unknown>; finished: Promise<unknown> } };
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!page.startViewTransition || still) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.motion = "iris";
  const clear = () => {
    if (root.dataset.motion === "iris") delete root.dataset.motion;
  };
  const clipPath = irisFrames(at, { width: window.innerWidth, height: window.innerHeight });
  const transition = page.startViewTransition(() => flushSync(update));
  transition.ready.then(
    () => root.animate({ clipPath }, { duration: 650, easing: "cubic-bezier(0.65, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" }),
    () => undefined,
  );
  transition.finished.then(clear, clear);
}
