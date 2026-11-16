import { useSyncExternalStore, type MouseEvent } from "react";

import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import { withIris } from "./motion";

const SUN = "M12 4V2M12 22v-2M4 12H2M22 12h-2M6.300 6.300L4.900 4.900M19.100 19.100l-1.400-1.400M6.300 17.700l-1.400 1.400M19.100 4.900l-1.400 1.400M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
const MOON = "M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z";

/** Switches between the dark and the light look; the new one opens as a circle from where the button was pressed. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const t = useT();
  const { theme } = useServices();
  const current = useSyncExternalStore(theme.subscribe, theme.getSnapshot);

  function press(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    withIris(keyboard ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: event.clientX, y: event.clientY }, theme.toggle);
  }

  return (
    <button type="button" aria-label={t(current === "dark" ? "theme.toLight" : "theme.toDark")} title={t(current === "dark" ? "theme.toLight" : "theme.toDark")} className={className} onClick={press}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d={current === "dark" ? SUN : MOON} />
      </svg>
    </button>
  );
}
