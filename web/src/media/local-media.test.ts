import { describe, expect, test, vi } from "vitest";

import { createLocalMedia, type MediaDevicesPort, type VoiceChain } from "./local-media";

function fakeStream() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn(), kind: "audio" });
  return { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [track], track } as unknown as MediaStream & { track: { stop: ReturnType<typeof vi.fn> } };
}

function setup() {
  const raw = fakeStream();
  const user = vi.fn(async (_constraints: MediaStreamConstraints) => raw);
  const devices = { user, display: vi.fn(), list: async () => [] } as unknown as MediaDevicesPort;
  return { raw, user, devices };
}

describe("the voice filter", () => {
  test("standard asks the browser for its own noise removal, and off asks for the microphone as it is", async () => {
    const { user, devices } = setup();
    const media = createLocalMedia(devices, () => undefined);
    await media.toggle("microphone");
    expect(user.mock.calls[0]![0].audio).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    await media.setVoiceFilter("off");
    expect(user.mock.calls.at(-1)![0].audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });

  test("strong sends the cleaned voice, with the browser's own removal off, and lets everything go when the microphone is turned off", async () => {
    const { raw, user, devices } = setup();
    const cleaned = fakeStream();
    const release = vi.fn();
    const media = createLocalMedia(devices, () => undefined, async () => ({ stream: cleaned, release }));
    await media.setVoiceFilter("strong");
    await media.toggle("microphone");
    expect(user.mock.calls[0]![0].audio).toMatchObject({ echoCancellation: true, noiseSuppression: false });
    expect(media.getSnapshot().microphone).toBe(cleaned);
    await media.toggle("microphone");
    expect(release).toHaveBeenCalledTimes(1);
    expect(raw.track.stop).toHaveBeenCalled();
    expect(media.getSnapshot().microphone).toBeUndefined();
  });

  test("strong falls back to the plain microphone when the cleaner cannot start", async () => {
    const { raw, devices } = setup();
    const media = createLocalMedia(devices, () => undefined, async () => Promise.reject(new Error("no wasm")));
    await media.setVoiceFilter("strong");
    await media.toggle("microphone");
    expect(media.getSnapshot().microphone).toBe(raw);
  });
});

describe("settings", () => {
  test("echo and gain can be turned off on their own, and the microphone restarts to take them", async () => {
    const { user, devices } = setup();
    const media = createLocalMedia(devices, () => undefined);
    await media.toggle("microphone");
    await media.setSettings({ echo: false, gain: false });
    expect(user).toHaveBeenCalledTimes(2);
    expect(user.mock.calls.at(-1)![0].audio).toMatchObject({ echoCancellation: false, noiseSuppression: true, autoGainControl: false });
  });

  test("balanced voice or the gate send the voice through the chain even with the standard filter", async () => {
    const { devices } = setup();
    const cleaned = fakeStream();
    const cleaner = vi.fn(async (_raw: MediaStream, _chain: VoiceChain) => ({ stream: cleaned, release: vi.fn() }));
    const media = createLocalMedia(devices, () => undefined, cleaner);
    await media.setSettings({ gate: true, gateDb: -40 });
    await media.toggle("microphone");
    expect(cleaner.mock.calls[0]![1]).toEqual({ denoise: false, strength: 100, balanced: false, gate: true, gateDb: -40 });
    expect(media.getSnapshot().microphone).toBe(cleaned);
  });

  test("with push to talk the microphone only sends while the key is held", async () => {
    const { raw, devices } = setup();
    const track = raw.track as unknown as { enabled: boolean };
    const media = createLocalMedia(devices, () => undefined);
    await media.setSettings({ pushToTalk: true });
    await media.toggle("microphone");
    expect(track.enabled).toBe(false);
    media.talk(true);
    expect(track.enabled).toBe(true);
    media.talk(false);
    expect(track.enabled).toBe(false);
    await media.setSettings({ pushToTalk: false });
    expect(track.enabled).toBe(true);
  });

  test("the camera and the screen are asked for in the size chosen", async () => {
    const { user, devices } = setup();
    const display = devices.display as unknown as ReturnType<typeof vi.fn>;
    display.mockResolvedValue(fakeStream());
    const media = createLocalMedia(devices, () => undefined);
    await media.setSettings({ cameraQuality: "1080", screenQuality: "1440p60", screenAudio: false });
    await media.toggle("camera");
    expect(user.mock.calls.at(-1)![0].video).toMatchObject({ width: { ideal: 1920 }, height: { ideal: 1080 } });
    await media.toggle("screen");
    expect(display.mock.calls[0]![0]).toMatchObject({ video: { width: { ideal: 2560 }, frameRate: { ideal: 60 } }, audio: false });
  });
});

describe("camera effects", () => {
  test("the background blur comes on, changes strength and goes off without asking for the camera again", async () => {
    const { raw, user, devices } = setup();
    const changed = fakeStream();
    const release = vi.fn();
    const set = vi.fn();
    const effects = vi.fn(async (_raw: MediaStream, _effect: string) => ({ stream: changed, set, release }));
    const media = createLocalMedia(devices, () => undefined, undefined, undefined, effects);
    await media.toggle("camera");
    expect(media.getSnapshot().camera).toBe(raw);
    await media.setSettings({ cameraEffect: "blur" });
    expect(effects).toHaveBeenCalledWith(raw, "blur");
    expect(media.getSnapshot().camera).toBe(changed);
    await media.setSettings({ cameraEffect: "blurStrong" });
    expect(set).toHaveBeenCalledWith("blurStrong");
    expect(media.getSnapshot().camera).toBe(changed);
    await media.setSettings({ cameraEffect: "none" });
    expect(release).toHaveBeenCalledTimes(1);
    expect(media.getSnapshot().camera).toBe(raw);
    expect(raw.track.stop).not.toHaveBeenCalled();
    expect(user).toHaveBeenCalledTimes(1);
  });

  test("a camera turned on with the blur chosen starts blurred, and turning it off lets everything go", async () => {
    const { raw, devices } = setup();
    const changed = fakeStream();
    const release = vi.fn();
    const media = createLocalMedia(devices, () => undefined, undefined, undefined, async () => ({ stream: changed, set: vi.fn(), release }));
    await media.setSettings({ cameraEffect: "blur" });
    await media.toggle("camera");
    expect(media.getSnapshot().camera).toBe(changed);
    await media.toggle("camera");
    expect(release).toHaveBeenCalledTimes(1);
    expect(raw.track.stop).toHaveBeenCalled();
  });

  test("a muted room takes the microphone away and gives it back without turning it on", async () => {
    const { raw, devices } = setup();
    const media = createLocalMedia(devices, () => undefined);
    await media.toggle("microphone");
    media.silence(true);
    expect(media.getSnapshot().microphone).toBeUndefined();
    expect(raw.track.stop).toHaveBeenCalled();
    await media.toggle("microphone");
    expect(media.getSnapshot()).toMatchObject({ microphone: undefined, problem: { kind: "microphone", why: "muted" } });
    media.silence(false);
    expect(media.getSnapshot()).toMatchObject({ microphone: undefined, problem: undefined, silenced: false });
  });
});
