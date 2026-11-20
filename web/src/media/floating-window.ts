import { useCallback, useEffect, useState } from "react";

type DocumentPictureInPicture = { requestWindow(options?: { width?: number; height?: number }): Promise<Window> };

const api = (): DocumentPictureInPicture | undefined => (typeof window === "undefined" ? undefined : (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture);

/** Whether the browser can float a whole page of the room (Document Picture-in-Picture), as Meet does. */
export const canFloatPage = (): boolean => api() !== undefined;

/**
 * Gives a new window the room's look: the attributes of its html and body, and its stylesheets. A stylesheet file is linked,
 * since the site's CSP (style-src 'self') refuses inline styles; only a sheet with no file (in development) is copied inline.
 */
export function dressLike(target: Document, source: Pick<Document, "documentElement" | "body" | "styleSheets"> = document) {
  for (const { name, value } of Array.from(source.documentElement.attributes)) target.documentElement.setAttribute(name, value);
  target.body.className = source.body.className;
  for (const sheet of Array.from(source.styleSheets)) {
    if (sheet.href) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      target.head.append(link);
      continue;
    }
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      target.head.append(style);
    } catch {
      continue;
    }
  }
}

/** A floating window the room renders into (through a portal): opened by a press or by the browser on leaving the tab, gone when closed or the room ends. */
export function useFloatingWindow() {
  const [floating, setFloating] = useState<Window | null>(null);

  const open = useCallback(async (): Promise<boolean> => {
    const pip = api();
    if (!pip) return false;
    try {
      const win = await pip.requestWindow({ width: 480, height: 320 });
      dressLike(win.document);
      win.addEventListener("pagehide", () => setFloating(null), { once: true });
      setFloating(win);
      return true;
    } catch {
      return false;
    }
  }, []);

  const close = useCallback(() => floating?.close(), [floating]);

  useEffect(() => () => floating?.close(), [floating]);

  return { floating, open, close };
}
