import { useId, useState, type ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import type { LocalMediaSnapshot, VoiceFilter } from "../media/local-media";
import { CAMERA_EFFECTS, CAMERA_QUALITIES, SCREEN_QUALITIES, TALK_KEYS, type MediaSettings as Settings } from "../media/settings";
import { Choice } from "../ui/Choice";
import { Disclosure } from "../ui/Disclosure";
import { Slider } from "../ui/Slider";
import { Switch } from "../ui/Switch";
import { DeviceList } from "./DeviceList";

type MediaSettingsProps = {
  settings: Settings;
  filter: VoiceFilter;
  strongAvailable: boolean;
  effectsAvailable: boolean;
  devices: Pick<LocalMediaSnapshot, "microphones" | "cameras" | "microphoneId" | "cameraId">;
  onDevice(kind: "microphone" | "camera", id: string): void;
  onFilter(filter: VoiceFilter): void;
  onChange(change: Partial<Settings>): void;
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="bubble flex flex-col gap-4 border border-line-strong bg-canvas p-4">
      <h4 className="font-display text-base font-bold tracking-[-0.03em]">{title}</h4>
      {children}
    </section>
  );
}

/** How this device captures and sends: the basics first (which microphone and camera, the noise cleanup, the background, the computer's sound), the finer controls of the voice, the talk key and the picture one click away. Each change takes effect at once and is kept for the next visit. */
export function MediaSettings({ settings, filter, strongAvailable, effectsAvailable, devices, onDevice, onFilter, onChange }: MediaSettingsProps) {
  const t = useT();
  const basic = useId();
  const [advanced, setAdvanced] = useState(false);
  const cleaned = filter !== "off";
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby={basic} className="flex flex-col gap-3">
        <h3 id={basic} className="font-display text-lg font-bold tracking-[-0.03em]">
          {t("settings.basic")}
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Group title={t("settings.sound")}>
            <DeviceList label={t("menu.microphone")} devices={devices.microphones} chosen={devices.microphoneId} onChoose={(id) => onDevice("microphone", id)} />
            <Choice<VoiceFilter>
              label={t("menu.voiceFilter")}
              value={filter}
              onChange={onFilter}
              options={[{ value: "off", text: t("menu.filterOff") }, { value: "standard", text: t("menu.filterStandard") }, ...(strongAvailable ? [{ value: "strong" as const, text: t("menu.filterStrong") }] : [])]}
            />
            <Switch checked={settings.sounds} onChange={(sounds) => onChange({ sounds })}>
              {t("settings.sounds")}
            </Switch>
          </Group>
          <Group title={t("settings.video")}>
            <DeviceList label={t("menu.camera")} devices={devices.cameras} chosen={devices.cameraId} onChoose={(id) => onDevice("camera", id)} />
            {effectsAvailable ? (
              <Choice label={t("menu.cameraEffect")} value={settings.cameraEffect} onChange={(cameraEffect) => onChange({ cameraEffect })} options={CAMERA_EFFECTS.map((effect) => ({ value: effect, text: t(`settings.effect.${effect}`) }))} />
            ) : null}
            <Switch checked={settings.screenAudio} onChange={(screenAudio) => onChange({ screenAudio })}>
              {t("settings.screenAudio")}
            </Switch>
          </Group>
        </div>
      </section>
      <Disclosure label={t("settings.advanced")} open={advanced} onOpen={setAdvanced}>
        <div className="grid gap-3 md:grid-cols-2">
          <Group title={t("settings.voice")}>
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
            </Group>
            <Group title={t("settings.quality")}>
              <Choice label={t("settings.cameraQuality")} value={settings.cameraQuality} onChange={(cameraQuality) => onChange({ cameraQuality })} options={CAMERA_QUALITIES.map((quality) => ({ value: quality, text: `${quality}p` }))} />
              <Choice
                label={t("settings.screenQuality")}
                hint={t("settings.qualityHint")}
                value={settings.screenQuality}
                onChange={(screenQuality) => onChange({ screenQuality })}
                options={SCREEN_QUALITIES.map((quality) => ({ value: quality, text: quality.replace("p", "p · ") + " fps" }))}
              />
            </Group>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
