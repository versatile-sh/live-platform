import type { ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import type { VoiceFilter } from "../media/local-media";
import { CAMERA_QUALITIES, SCREEN_QUALITIES, TALK_KEYS, type MediaSettings as Settings } from "../media/settings";
import { Choice } from "../ui/Choice";
import { Slider } from "../ui/Slider";
import { Switch } from "../ui/Switch";

type MediaSettingsProps = {
  settings: Settings;
  filter: VoiceFilter;
  strongAvailable: boolean;
  onFilter(filter: VoiceFilter): void;
  onChange(change: Partial<Settings>): void;
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="bubble flex flex-col gap-4 border border-line-strong bg-canvas p-4">
      <h3 className="font-display text-base font-bold tracking-[-0.03em]">{title}</h3>
      {children}
    </section>
  );
}

/** How this device captures and sends: the voice's path, the keys, the sounds, and the size of camera and screen. Each change takes effect at once and is kept for the next visit. */
export function MediaSettings({ settings, filter, strongAvailable, onFilter, onChange }: MediaSettingsProps) {
  const t = useT();
  const cleaned = filter !== "off";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Group title={t("settings.sound")}>
        <Choice<VoiceFilter>
          label={t("menu.voiceFilter")}
          value={filter}
          onChange={onFilter}
          options={[{ value: "off", text: t("menu.filterOff") }, { value: "standard", text: t("menu.filterStandard") }, ...(strongAvailable ? [{ value: "strong" as const, text: t("menu.filterStrong") }] : [])]}
        />
        {filter === "strong" ? <Slider label={t("settings.strength")} value={settings.strength} min={0} max={100} step={5} format={(value) => `${value}%`} onChange={(strength) => onChange({ strength })} /> : null}
        <Switch checked={cleaned && settings.echo} onChange={(echo) => onChange({ echo })}>
          {t("settings.echo")}
        </Switch>
        <Switch checked={cleaned && settings.gain} onChange={(gain) => onChange({ gain })}>
          {t("settings.gain")}
        </Switch>
        <Switch checked={settings.balanced} onChange={(balanced) => onChange({ balanced })}>
          {t("settings.balanced")}
        </Switch>
        <Switch checked={settings.gate} onChange={(gate) => onChange({ gate })}>
          {t("settings.gate")}
        </Switch>
        <Slider label={t("settings.gateDb")} value={settings.gateDb} min={-80} max={-20} format={(value) => `${value} dB`} disabled={!settings.gate} onChange={(gateDb) => onChange({ gateDb })} />
      </Group>
      <div className="flex flex-col gap-3">
        <Group title={t("settings.talk")}>
          <Switch checked={settings.pushToTalk} onChange={(pushToTalk) => onChange({ pushToTalk })}>
            {t("settings.pushToTalk")}
          </Switch>
          <Choice label={t("settings.talkKey")} value={settings.talkKey} onChange={(talkKey) => onChange({ talkKey })} options={TALK_KEYS.map((key) => ({ value: key, text: t(`settings.key.${key}`) }))} />
          <Switch checked={settings.sounds} onChange={(sounds) => onChange({ sounds })}>
            {t("settings.sounds")}
          </Switch>
        </Group>
        <Group title={t("settings.video")}>
          <Choice label={t("settings.cameraQuality")} value={settings.cameraQuality} onChange={(cameraQuality) => onChange({ cameraQuality })} options={CAMERA_QUALITIES.map((quality) => ({ value: quality, text: `${quality}p` }))} />
          <Choice
            label={t("settings.screenQuality")}
            value={settings.screenQuality}
            onChange={(screenQuality) => onChange({ screenQuality })}
            options={SCREEN_QUALITIES.map((quality) => ({ value: quality, text: quality.replace("p", "p · ") + " fps" }))}
          />
          <Switch checked={settings.screenAudio} onChange={(screenAudio) => onChange({ screenAudio })}>
            {t("settings.screenAudio")}
          </Switch>
        </Group>
      </div>
    </div>
  );
}
