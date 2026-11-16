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
