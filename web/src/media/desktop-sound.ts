import type { MediaDevicesPort } from "./local-media";

/** The input the Linux helper adds with the whole computer's sound. */
const SHARE_SOURCE = /desktop-audio-share/i;
/** Every device the helper adds; none of them is a microphone. */
const HELPER_DEVICE = /desktop-audio/i;
/** The output the helper adds for the call, played but never shared. */
const CALL_OUTPUT = /call-output/i;

/** Whether this is a Linux computer, where Chrome sends a tab's sound only and the helper is the way to send the rest. */
export function isLinuxDesktop(agent = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Linux/.test(agent) && !/Android/.test(agent);
}

/** Whether a microphone the browser lists is one of the helper's devices rather than a real microphone. */
export function isHelperInput(label: string): boolean {
  return HELPER_DEVICE.test(label);
}

/** The output the call should play on, so that it stays out of the shared sound; absent without the helper. */
export function callOutput(all: readonly MediaDeviceInfo[]): string | undefined {
  return all.find((device) => device.kind === "audiooutput" && CALL_OUTPUT.test(device.label))?.deviceId;
}

/**
 * Opens the helper's input with the browser's voice processing off, absent when the helper is not on.
 * Device names show only after a capture was allowed, so on Linux an unnamed list asks once for the microphone.
 */
export async function openDesktopSound(devices: MediaDevicesPort, linux = isLinuxDesktop()): Promise<MediaStream | undefined> {
  const find = (all: readonly MediaDeviceInfo[]) => all.find((device) => device.kind === "audioinput" && SHARE_SOURCE.test(device.label));
  let all = await devices.list();
  let source = find(all);
  if (!source && linux && !all.some((device) => device.kind === "audioinput" && device.label !== "")) {
    (await devices.user({ audio: true })).getTracks().forEach((track) => track.stop());
    all = await devices.list();
    source = find(all);
  }
  if (!source) return undefined;
  return devices.user({
    audio: { deviceId: { exact: source.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48_000 },
  });
}

/** How this computer sends its whole sound with a screen: the Linux helper, the picker's tick box (macOS with its version note), or not at all. */
export type SoundRoute = "linux" | "picker" | "mac" | "none";

/** Which guide a person whose screen went without the computer's sound should see, from the browser's user agent. */
export function soundRoute(agent = typeof navigator === "undefined" ? "" : navigator.userAgent): SoundRoute {
  if (isLinuxDesktop(agent)) return "linux";
  if (!/Chrome\//.test(agent) || /Mobile/.test(agent)) return "none";
  return /Macintosh/.test(agent) ? "mac" : "picker";
}

/** The one line that installs the Linux helper from this site and turns it on. */
export function helperCommand(origin: string): string {
  return `mkdir -p ~/.local/bin && curl -fsSL ${origin}/assets/screen-audio.sh -o ~/.local/bin/screen-audio && chmod +x ~/.local/bin/screen-audio && ~/.local/bin/screen-audio on`;
}

/** The line that gives the computer's sound back to its own device after the call. */
export const HELPER_OFF = "~/.local/bin/screen-audio off";
