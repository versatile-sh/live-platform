/** The two looks of the site. */
export type Theme = "dark" | "light";

/** Where the chosen look is kept and how the system's own preference is read; a page hands in its browser's, a test hands in fakes. */
export type ThemePort = { read(): Theme | undefined; write(theme: Theme): void; systemPrefersLight(): boolean; root: { dataset: Record<string, string | undefined> } };

export type ThemeStore = {
  subscribe(listener: () => void): () => void;
  /** The look in effect: the one chosen, or the system's when none was. */
  getSnapshot(): Theme;
  /** Takes the other look and keeps the choice. */
  toggle(): void;
};

/** The look of the site as a store: it follows the system until the person chooses, and then keeps what they chose. */
export function createTheme(port: ThemePort): ThemeStore {
  const listeners = new Set<() => void>();
  let chosen = port.read();
  if (chosen) port.root.dataset.theme = chosen;
  const current = (): Theme => chosen ?? (port.systemPrefersLight() ? "light" : "dark");
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: current,
    toggle() {
      chosen = current() === "dark" ? "light" : "dark";
      port.root.dataset.theme = chosen;
      port.write(chosen);
      listeners.forEach((listener) => listener());
    },
  };
}
