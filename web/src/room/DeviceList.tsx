import { useId } from "react";

import { useT } from "../i18n/I18nProvider";
import type { Device } from "../media/local-media";

type DeviceListProps = { label: string; devices: readonly Device[]; chosen: string | undefined; onChoose(id: string): void };

/** The microphones or cameras this device has, one to choose; the first stands for the system's own until another is chosen. */
export function DeviceList({ label, devices, chosen, onChoose }: DeviceListProps) {
  const t = useT();
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      {devices.length === 0 ? (
        <p className="text-sm text-muted">{t("menu.noDevices")}</p>
      ) : (
        <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
          {devices.map((device, index) => {
            const checked = chosen ? chosen === device.id : index === 0;
            return (
              <label
                key={device.id}
                className="flex min-h-10 cursor-pointer items-center gap-3 bubble px-2.5 text-sm transition-colors duration-200 hover:bg-fg/8 has-checked:bg-fg/10 has-focus-visible:outline-2 has-focus-visible:outline-fg/55"
              >
                <input type="radio" name={name} className="sr-only" checked={checked} onChange={() => onChoose(device.id)} />
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${checked ? "bg-bubble" : "border border-muted-light"}`} />
                <span className="min-w-0 flex-1 truncate">{device.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
