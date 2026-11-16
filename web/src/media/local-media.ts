import { FLAG } from "../domain/flags";

/** The capture calls of the browser, so tests can hand the store fakes. */
export type MediaDevicesPort = {
  user(constraints: MediaStreamConstraints): Promise<MediaStream>;
  display(constraints: DisplayMediaStreamOptions): Promise<MediaStream>;
  list(): Promise<MediaDeviceInfo[]>;
};

/** A microphone or camera the browser offers. */
export type Device = { id: string; label: string };

/** How hard the browser cleans the microphone: not at all, or its own noise and echo removal. */
export type VoiceFilter = "off" | "standard" | "strong";

/** A microphone after a noise remover, and the way to let the remover go. */
export type CleanedVoice = { stream: MediaStream; release(): void };

/** Cleans a microphone's voice in this browser; absent where the browser cannot. */
export type VoiceCleaner = (raw: MediaStream) => Promise<CleanedVoice>;

export type MediaKind = "microphone" | "camera" | "screen";

/** What this device is capturing right now, and the last thing that went wrong. */
export type LocalMediaSnapshot = {
  microphone: MediaStream | undefined;
  camera: MediaStream | undefined;
  screen: MediaStream | undefined;
  hand: boolean;
  microphones: readonly Device[];
  cameras: readonly Device[];
  microphoneId: string | undefined;
  cameraId: string | undefined;
  voiceFilter: VoiceFilter;
  busy: MediaKind | undefined;
  problem: { kind: MediaKind; why: "denied" | "unavailable" } | undefined;
};

export type LocalMedia = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LocalMediaSnapshot;
  toggle(kind: MediaKind): Promise<void>;
  toggleHand(): void;
  /** Reads the microphones and cameras the browser offers; their names appear only after a capture was allowed. */
  refreshDevices(): Promise<void>;
  /** Uses another microphone or camera, restarting the capture when it is on. */
  choose(kind: "microphone" | "camera", id: string): Promise<void>;
  /** Changes the voice filter, restarting the microphone when it is on. */
  setVoiceFilter(filter: VoiceFilter): Promise<void>;
  dispose(): void;
};

const OFF: LocalMediaSnapshot = {
  microphone: undefined,
  camera: undefined,
  screen: undefined,
  hand: false,
  microphones: [],
  cameras: [],
  microphoneId: undefined,
  cameraId: undefined,
  voiceFilter: "standard",
  busy: undefined,
  problem: undefined,
};

/** The flag word the room is told for a snapshot. */
export function flagsOf(snapshot: LocalMediaSnapshot): number {
  return (
    (snapshot.microphone ? FLAG.microphone : 0) |
    (snapshot.camera ? FLAG.camera : 0) |
    (snapshot.screen ? FLAG.screen : 0) |
    (snapshot.screen && snapshot.screen.getAudioTracks().length > 0 ? FLAG.screenAudio : 0) |
    (snapshot.hand ? FLAG.hand : 0)
  );
}

function stop(stream: MediaStream | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Microphone, camera, screen and the raised hand of this device, as a store: each is asked of the browser when turned on and released when turned off. */
export function createLocalMedia(devices: MediaDevicesPort | undefined, onFlags: (flags: number) => void, cleaner?: VoiceCleaner): LocalMedia {
  const releases = new WeakMap<MediaStream, () => void>();
  const listeners = new Set<() => void>();
  let snapshot = OFF;
  let disposed = false;

  function patch(next: Partial<LocalMediaSnapshot>) {
    snapshot = { ...snapshot, ...next };
    onFlags(flagsOf(snapshot));
    listeners.forEach((listener) => listener());
  }

  function capture(kind: MediaKind): Promise<MediaStream> {
    if (!devices) return Promise.reject(new DOMException("no capture on this device", "NotFoundError"));
    if (kind === "screen") return devices.display({ video: true, audio: true });
    if (kind === "camera") return devices.user({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(snapshot.cameraId ? { deviceId: { exact: snapshot.cameraId } } : {}) } });
    return microphone(devices);
  }

  async function microphone(from: MediaDevicesPort): Promise<MediaStream> {
    const filter = snapshot.voiceFilter;
    const strong = filter === "strong" && cleaner !== undefined;
    const raw = await from.user({ audio: { echoCancellation: filter !== "off", noiseSuppression: filter !== "off" && !strong, autoGainControl: filter !== "off", ...(snapshot.microphoneId ? { deviceId: { exact: snapshot.microphoneId } } : {}) } });
    if (!strong) return raw;
    try {
      const cleaned = await cleaner(raw);
      releases.set(cleaned.stream, () => {
        cleaned.release();
        stop(raw);
      });
      raw.getTracks().forEach((track) => track.addEventListener("ended", () => cleaned.stream.getTracks().forEach((made) => made.dispatchEvent(new Event("ended")))));
      return cleaned.stream;
    } catch {
      return raw;
    }
  }

  function end(stream: MediaStream | undefined) {
    if (!stream) return;
    releases.get(stream)?.();
    releases.delete(stream);
    stop(stream);
  }

  async function refreshDevices() {
    if (!devices) return;
    try {
      const all = await devices.list();
      const named = (kind: MediaDeviceKind) => all.filter((device) => device.kind === kind && device.deviceId !== "").map((device, index) => ({ id: device.deviceId, label: device.label || `${index + 1}` }));
      if (!disposed) patch({ microphones: named("audioinput"), cameras: named("videoinput") });
    } catch {
      return;
    }
  }

  async function restart(kind: "microphone" | "camera") {
    if (!snapshot[kind]) return;
    await store.toggle(kind);
    await store.toggle(kind);
  }

  const store: LocalMedia = {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async toggle(kind) {
      if (snapshot.busy) return;
      const current = snapshot[kind];
      if (current) {
        end(current);
        patch({ [kind]: undefined, problem: undefined });
        return;
      }
      patch({ busy: kind, problem: undefined });
      try {
        const stream = await capture(kind);
        if (disposed) {
          end(stream);
          return;
        }
        stream.getTracks().forEach((track) =>
          track.addEventListener("ended", () => {
            if (snapshot[kind] === stream) patch({ [kind]: undefined });
          }),
        );
        patch({ [kind]: stream, busy: undefined });
        if (kind !== "screen") void refreshDevices();
      } catch (error) {
        const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
        const cancelled = kind === "screen" && denied;
        patch({ busy: undefined, problem: cancelled ? undefined : { kind, why: denied ? "denied" : "unavailable" } });
      }
    },
    toggleHand() {
      patch({ hand: !snapshot.hand });
    },
    refreshDevices,
    async choose(kind, id) {
      patch(kind === "microphone" ? { microphoneId: id } : { cameraId: id });
      await restart(kind);
    },
    async setVoiceFilter(filter) {
      patch({ voiceFilter: filter });
      await restart("microphone");
    },
    dispose() {
      disposed = true;
      end(snapshot.microphone);
      end(snapshot.camera);
      end(snapshot.screen);
      snapshot = OFF;
    },
  };
  return store;
}
