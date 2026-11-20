import { useCallback, useState } from "react";

import type { Box } from "../domain/stage-fit";

/** The measured size of the element given the returned ref, kept current while it is mounted; `undefined` until measured. */
export function useBox(): [Box | undefined, (element: HTMLElement | null) => (() => void) | undefined] {
  const [box, setBox] = useState<Box | undefined>();
  const measure = useCallback((element: HTMLElement | null) => {
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setBox((current) => (current?.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, measure];
}
