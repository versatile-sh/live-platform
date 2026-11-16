import { describe, expect, test, vi } from "vitest";

import { createLocalMedia, type MediaDevicesPort } from "./local-media";

function fakeStream() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn(), kind: "audio" });
  return { getTracks: () => [track], getAudioTracks: () => [track], track } as unknown as MediaStream & { track: { stop: ReturnType<typeof vi.fn> } };
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
