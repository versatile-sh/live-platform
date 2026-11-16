import { useSyncExternalStore, type MouseEvent } from "react";

import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import { withIris } from "./motion";

const SUN = "M12 2.5v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100M12 16.500a4.500 4.500 0 1 0 0-9 4.500 4.500 0 0 0 0 9z";
const MOON = "M20.500 14.200A8.500 8.500 0 0 1 9.800 3.500a8.500 8.500 0 1 0 10.700 10.700z";

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
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={current === "dark" ? SUN : MOON} />
      </svg>
    </button>
  );
}
