import type { KeyboardEvent } from "react";

import { useLocale, useT } from "../i18n/I18nProvider";
import { COUNTRIES, UNCODED, WORLD_SIZE } from "./world";

type WorldMapProps = {
  counts: ReadonlyMap<string, number>;
  selected: string | undefined;
  onSelect(code: string | undefined): void;
};

/** The world drawn in ink on the lime panel: countries with open rooms are solid and can be picked, the rest is a faint outline of land. */
export default function WorldMap({ counts, selected, onSelect }: WorldMapProps) {
  const t = useT();
  const names = new Intl.DisplayNames([useLocale()], { type: "region" });
  const open = Object.keys(COUNTRIES).filter((code) => counts.has(code));
  const quiet = Object.keys(COUNTRIES).filter((code) => !counts.has(code));

  function onKey(event: KeyboardEvent, code: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(selected === code ? undefined : code);
  }

  return (
    <svg viewBox={`0 0 ${WORLD_SIZE.width} ${WORLD_SIZE.height}`} role="group" aria-label={t("lobby.mapLabel")} className="h-auto w-full">
      <path d={UNCODED} className="fill-ink/15" />
      {quiet.map((code) => (
        <path key={code} d={COUNTRIES[code]} className="fill-ink/15" />
      ))}
      {open.map((code) => (
        <path
          key={code}
          d={COUNTRIES[code]}
          role="button"
          tabIndex={0}
          aria-pressed={selected === code}
          aria-label={t("lobby.mapCountry", { country: names.of(code) ?? code, count: counts.get(code) ?? 0 })}
          className="cursor-pointer fill-ink stroke-bubble stroke-[0.75] transition-colors duration-200 hover:fill-ink/75 aria-pressed:fill-paper aria-pressed:stroke-ink"
          onClick={() => onSelect(selected === code ? undefined : code)}
          onKeyDown={(event) => onKey(event, code)}
        />
      ))}
    </svg>
  );
}
