import { describe, expect, test, vi } from "vitest";

import { createLocalMedia, type MediaDevicesPort, type VoiceChain } from "./local-media";
import { DEFAULT_SETTINGS } from "./settings";

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

  test("the camera and the screen are asked for in the size chosen, the camera in one of its own formats so nothing of its angle is cropped", async () => {
    const { user, devices } = setup();
    const display = devices.display as unknown as ReturnType<typeof vi.fn>;
    display.mockResolvedValue(fakeStream());
    const media = createLocalMedia(devices, () => undefined);
    await media.setSettings({ cameraQuality: "1080", screenQuality: "1440p60", screenAudio: false });
    await media.toggle("camera");
    expect(user.mock.calls.at(-1)![0].video).toMatchObject({ width: { ideal: 1920 }, height: { ideal: 1080 }, resizeMode: { ideal: "none" } });
    await media.toggle("screen");
    expect(display.mock.calls[0]![0]).toMatchObject({ video: { width: { ideal: 2560 }, frameRate: { ideal: 60 } }, audio: false });
  });

  test("the screen picker offers every screen, window and tab with the computer's sound, and lets the source change while sharing", async () => {
    const { devices } = setup();
    const display = devices.display as unknown as ReturnType<typeof vi.fn>;
    display.mockResolvedValue(fakeStream());
    await createLocalMedia(devices, () => undefined).toggle("screen");
    expect(display.mock.calls[0]![0]).toMatchObject({ systemAudio: "include", surfaceSwitching: "include", selfBrowserSurface: "exclude", monitorTypeSurfaces: "include" });
  });

  test("a store taken back into use after a dispose keeps what it captures, as when React mounts the room twice", async () => {
    const { devices } = setup();
    const display = devices.display as unknown as ReturnType<typeof vi.fn>;
    display.mockResolvedValue(fakeStream());
    const media = createLocalMedia(devices, () => undefined, undefined, { ...DEFAULT_SETTINGS, screenQuality: "1440p60" });
    media.dispose();
    media.revive();
    await media.toggle("screen");
    expect(media.getSnapshot().screen).toBeDefined();
    expect(media.getSnapshot().settings.screenQuality).toBe("1440p60");
  });

  test("the screen asks the browser to leave the call's own sound out of the computer's sound", async () => {
    const { devices } = setup();
    const display = devices.display as unknown as ReturnType<typeof vi.fn>;
    display.mockResolvedValue(fakeStream());
    await createLocalMedia(devices, () => undefined).toggle("screen");
    expect(display.mock.calls[0]![0]).toMatchObject({ audio: { restrictOwnAudio: true } });
  });

  describe("with the Linux helper on and the whole computer's sound asked for", () => {
    const PC_SOUND = { ...DEFAULT_SETTINGS, pcSound: true };
    const shareInput = { kind: "audioinput", label: "Desktop-Audio-Share", deviceId: "share" } as MediaDeviceInfo;
    const callOut = { kind: "audiooutput", label: "Call-Output", deviceId: "call" } as MediaDeviceInfo;

    function linuxSetup() {
      vi.stubGlobal("MediaStream", class {
        constructor(private readonly tracks: MediaStreamTrack[]) {}
        getTracks = () => this.tracks;
        getAudioTracks = () => this.tracks.filter((track) => track.kind === "audio");
        getVideoTracks = () => this.tracks.filter((track) => track.kind === "video");
      });
      const video = Object.assign(new EventTarget(), { stop: vi.fn(), kind: "video" });
      const silent = { getTracks: () => [video], getAudioTracks: () => [], getVideoTracks: () => [video] } as unknown as MediaStream;
      const desk = fakeStream();
      const user = vi.fn(async (_constraints: MediaStreamConstraints) => desk);
      const devices = { user, display: vi.fn(async () => silent), list: async () => [shareInput, callOut, { kind: "audioinput", label: "USB Microphone", deviceId: "mic" } as MediaDeviceInfo] } as unknown as MediaDevicesPort;
      return { devices, user, video, desk, silent };
    }

    test("a screen that came without sound sends the helper's sound, hides its inputs from the microphones and plays the call on Call-Output", async () => {
      const { devices, video, desk } = linuxSetup();
      const media = createLocalMedia(devices, () => undefined, undefined, PC_SOUND);
      await media.toggle("screen");
      await vi.waitFor(() => expect(media.getSnapshot().speaker).toBe("call"));
      const screen = media.getSnapshot().screen!;
      expect(screen.getVideoTracks()).toEqual([video]);
      expect(screen.getAudioTracks()).toEqual([desk.track]);
      expect(media.getSnapshot().microphones).toEqual([{ id: "mic", label: "USB Microphone" }]);
      vi.unstubAllGlobals();
    });

    test("the helper's sound going away keeps the screen, and the screen ending stops both", async () => {
      const { devices, video, desk } = linuxSetup();
      const media = createLocalMedia(devices, () => undefined, undefined, PC_SOUND);
      await media.toggle("screen");
      (desk.track as unknown as EventTarget).dispatchEvent(new Event("ended"));
      expect(media.getSnapshot().screen).toBeDefined();
      video.dispatchEvent(new Event("ended"));
      expect(media.getSnapshot().screen).toBeUndefined();
      expect(video.stop).toHaveBeenCalled();
      expect(desk.track.stop).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    test("without asking for it, the screen goes with no helper sound; asking for it mid-share keeps the picture and puts the sound beside it", async () => {
      const { devices, user, video, desk } = linuxSetup();
      const media = createLocalMedia(devices, () => undefined);
      await media.toggle("screen");
      expect(user).not.toHaveBeenCalled();
      expect(media.getSnapshot().screen!.getAudioTracks()).toEqual([]);
      await media.setSettings({ pcSound: true });
      expect(media.getSnapshot().screen!.getVideoTracks()).toEqual([video]);
      expect(media.getSnapshot().screen!.getAudioTracks()).toEqual([desk.track]);
      vi.unstubAllGlobals();
    });
  });

  test("adding the sound without the helper says it found nothing and leaves the screen as it was", async () => {
    const { devices } = setup();
    const video = Object.assign(new EventTarget(), { stop: vi.fn(), kind: "video" });
    const silent = { getTracks: () => [video], getAudioTracks: () => [], getVideoTracks: () => [video] } as unknown as MediaStream;
    (devices.display as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(silent);
    const media = createLocalMedia(devices, () => undefined);
    await media.toggle("screen");
    expect(await media.addScreenSound()).toBe(false);
    expect(media.getSnapshot().screen).toBe(silent);
  });

  test("stopping the share from the browser releases all of it", async () => {
    const { devices } = setup();
    const shared = fakeStream();
    (devices.display as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(shared);
    const media = createLocalMedia(devices, () => undefined);
    await media.toggle("screen");
    (shared.track as unknown as EventTarget).dispatchEvent(new Event("ended"));
    expect(media.getSnapshot().screen).toBeUndefined();
    expect(shared.track.stop).toHaveBeenCalled();
  });
});

describe("camera effects", () => {
  test("the first blur moves the camera onto one picture, and from then on changing or removing the blur keeps that same picture", async () => {
    const { raw, user, devices } = setup();
    const staged = fakeStream();
    const release = vi.fn();
    const set = vi.fn();
    const effects = vi.fn(async (_raw: MediaStream, _effect: string) => ({ stream: staged, set, release }));
    const media = createLocalMedia(devices, () => undefined, undefined, undefined, effects);
    await media.toggle("camera");
    expect(media.getSnapshot().camera).toBe(raw);
    await media.setSettings({ cameraEffect: "blur" });
    expect(effects).toHaveBeenCalledWith(raw, "blur");
    expect(media.getSnapshot().camera).toBe(staged);
    await media.setSettings({ cameraEffect: "blurStrong" });
    await media.setSettings({ cameraEffect: "none" });
    await media.setSettings({ cameraEffect: "blur" });
    expect(set.mock.calls).toEqual([["blurStrong"], ["none"], ["blur"]]);
    expect(media.getSnapshot().camera).toBe(staged);
    expect(effects).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
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
