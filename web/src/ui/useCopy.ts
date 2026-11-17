import { useEffect, useState } from "react";

import { useServices } from "../services";

const SHOWN_MS = 2500;

/** How the last copy went: nothing to say, copied, or refused by the browser. */
export type CopyResult = "idle" | "copied" | "failed";

/** Copies text to the clipboard and says how it went for a few seconds, then goes quiet again. */
export function useCopy(): { result: CopyResult; copy(text: string): Promise<void> } {
  const { clipboard } = useServices();
  const [last, setLast] = useState<{ result: Exclude<CopyResult, "idle"> } | undefined>();
  useEffect(
    function quietAfterAWhile() {
      if (!last) return;
      const timer = setTimeout(() => setLast(undefined), SHOWN_MS);
      return () => clearTimeout(timer);
    },
    [last],
  );
  return {
    result: last?.result ?? "idle",
    async copy(text) {
      setLast({ result: (await clipboard.write(text)) ? "copied" : "failed" });
    },
  };
}
