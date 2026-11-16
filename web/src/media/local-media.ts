import { FLAG } from "../domain/flags";

/** The capture calls of the browser, so tests can hand the store fakes. */
export type MediaDevicesPort = {
  user(constraints: MediaStreamConstraints): Promise<MediaStream>;
  display(constraints: DisplayMediaStreamOptions): Promise<MediaStream>;
};

export type MediaKind = "microphone" | "camera" | "screen";

/** What this device is capturing right now, and the last thing that went wrong. */
export type LocalMediaSnapshot = {
  microphone: MediaStream | undefined;
  camera: MediaStream | undefined;
  screen: MediaStream | undefined;
  hand: boolean;
  busy: MediaKind | undefined;
  problem: { kind: MediaKind; why: "denied" | "unavailable" } | undefined;
};

export type LocalMedia = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LocalMediaSnapshot;
  toggle(kind: MediaKind): Promise<void>;
  toggleHand(): void;
  dispose(): void;
};

const OFF: LocalMediaSnapshot = { microphone: undefined, camera: undefined, screen: undefined, hand: false, busy: undefined, problem: undefined };

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
export function createLocalMedia(devices: MediaDevicesPort | undefined, onFlags: (flags: number) => void): LocalMedia {
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
    return devices.user(kind === "camera" ? { video: { width: { ideal: 1280 }, height: { ideal: 720 } } } : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async toggle(kind) {
      if (snapshot.busy) return;
      const current = snapshot[kind];
      if (current) {
        stop(current);
        patch({ [kind]: undefined, problem: undefined });
        return;
      }
      patch({ busy: kind, problem: undefined });
      try {
        const stream = await capture(kind);
        if (disposed) {
          stop(stream);
          return;
        }
        stream.getTracks().forEach((track) =>
          track.addEventListener("ended", () => {
            if (snapshot[kind] === stream) patch({ [kind]: undefined });
          }),
        );
        patch({ [kind]: stream, busy: undefined });
      } catch (error) {
        const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
        const cancelled = kind === "screen" && denied;
        patch({ busy: undefined, problem: cancelled ? undefined : { kind, why: denied ? "denied" : "unavailable" } });
      }
    },
    toggleHand() {
      patch({ hand: !snapshot.hand });
    },
    dispose() {
      disposed = true;
      stop(snapshot.microphone);
      stop(snapshot.camera);
      stop(snapshot.screen);
      snapshot = OFF;
    },
  };
}
