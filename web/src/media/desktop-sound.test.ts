import { describe, expect, test, vi } from "vitest";

import { callOutput, isHelperInput, isLinuxDesktop, openDesktopSound, soundRoute } from "./desktop-sound";
import type { MediaDevicesPort } from "./local-media";

const device = (kind: MediaDeviceKind, label: string, deviceId = label) => ({ kind, label, deviceId }) as MediaDeviceInfo;
const sound = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream;

function port(lists: MediaDeviceInfo[][]) {
  const user = vi.fn(async (_constraints: MediaStreamConstraints) => sound());
  const list = vi.fn(async () => lists.shift() ?? []);
  return { devices: { user, list, display: vi.fn() } as unknown as MediaDevicesPort, user, list };
}

describe("isLinuxDesktop", () => {
  test("is true on a Linux computer and false on Android, Windows and macOS", () => {
    expect(isLinuxDesktop("Mozilla/5.0 (X11; Linux x86_64) Chrome/140")).toBe(true);
    expect(isLinuxDesktop("Mozilla/5.0 (Linux; Android 15) Chrome/140")).toBe(false);
    expect(isLinuxDesktop("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140")).toBe(false);
    expect(isLinuxDesktop("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/140")).toBe(false);
  });
});

describe("the helper's devices", () => {
  test("its inputs are not microphones", () => {
    expect(isHelperInput("Desktop-Audio-Share")).toBe(true);
    expect(isHelperInput("Monitor of Desktop-Audio")).toBe(true);
    expect(isHelperInput("USB Microphone")).toBe(false);
  });

  test("the call plays on Call-Output when it exists", () => {
    expect(callOutput([device("audiooutput", "Headphones"), device("audiooutput", "Call-Output", "call")])).toBe("call");
    expect(callOutput([device("audiooutput", "Headphones"), device("audioinput", "Call-Output")])).toBeUndefined();
  });
});

describe("openDesktopSound", () => {
  test("opens the share input with the voice processing off", async () => {
    const { devices, user } = port([[device("audioinput", "USB Microphone"), device("audioinput", "Desktop-Audio-Share", "share")]]);
    expect(await openDesktopSound(devices, true)).toBeDefined();
    expect(user.mock.calls[0]![0].audio).toMatchObject({ deviceId: { exact: "share" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });

  test("on Linux with unnamed devices, asks for the microphone once to read the names", async () => {
    const { devices, user } = port([[device("audioinput", "", "a")], [device("audioinput", "Desktop-Audio-Share", "share")]]);
    expect(await openDesktopSound(devices, true)).toBeDefined();
    expect(user.mock.calls[0]![0]).toEqual({ audio: true });
    expect(user.mock.calls[1]![0].audio).toMatchObject({ deviceId: { exact: "share" } });
  });

  test("elsewhere, or with the helper off, asks for nothing", async () => {
    const away = port([[device("audioinput", "", "a")]]);
    expect(await openDesktopSound(away.devices, false)).toBeUndefined();
    expect(away.user).not.toHaveBeenCalled();
    const off = port([[device("audioinput", "USB Microphone")]]);
    expect(await openDesktopSound(off.devices, true)).toBeUndefined();
    expect(off.user).not.toHaveBeenCalled();
  });
});

describe("soundRoute", () => {
  test("Linux uses the helper, Chrome and Edge elsewhere the picker, Firefox and Safari cannot", () => {
    expect(soundRoute("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("helper");
    expect(soundRoute("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("picker");
    expect(soundRoute("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("none");
    expect(soundRoute("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15")).toBe("none");
  });
});
