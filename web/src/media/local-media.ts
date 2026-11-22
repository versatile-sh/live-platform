import { FLAG } from "../domain/flags";
import { callOutput, isHelperInput, openDesktopSound } from "./desktop-sound";
import { DEFAULT_SETTINGS, cameraShape, screenShape, type CameraEffect, type MediaSettings } from "./settings";

/** Asks for one of the camera's own formats instead of a crop to the asked size, so a 4:3 sensor keeps its whole angle. */
const WHOLE_SENSOR = { resizeMode: { ideal: "none" } } as MediaTrackConstraints;

/** The capture calls of the browser, so tests can hand the store fakes. */
export type MediaDevicesPort = {
  user(constraints: MediaStreamConstraints): Promise<MediaStream>;
  display(constraints: DisplayMediaStreamOptions): Promise<MediaStream>;
  list(): Promise<MediaDeviceInfo[]>;
};

/** The screen picker hints Chrome reads and the DOM typings do not name yet. */
type ScreenPicker = DisplayMediaStreamOptions & Partial<Record<"systemAudio" | "surfaceSwitching" | "selfBrowserSurface" | "monitorTypeSurfaces", "include" | "exclude">>;

/** A microphone or camera the browser offers. */
export type Device = { id: string; label: string };

/** How hard the browser cleans the microphone: not at all, or its own noise and echo removal. */
export type VoiceFilter = "off" | "standard" | "strong";

/** A microphone after a noise remover, and the way to let the remover go. */
export type CleanedVoice = { stream: MediaStream; release(): void };

/** What the voice passes through on its way out: the neural noise remover and how much of it, the balancing, and the gate. */
export type VoiceChain = { denoise: boolean; strength: number; balanced: boolean; gate: boolean; gateDb: number };

/** Passes a microphone's voice through a chain in this browser; absent where the browser cannot. */
export type VoiceCleaner = (raw: MediaStream, chain: VoiceChain) => Promise<CleanedVoice>;

/** A camera drawn onto a picture that stays the same while its background is put out of focus, changed or put back. */
export type CameraChange = { stream: MediaStream; set(effect: CameraEffect): void; release(): void };

/** Starts drawing a camera so that its background can be put out of focus in this browser; absent where the browser cannot. */
export type CameraEffects = (raw: MediaStream, effect: CameraEffect) => Promise<CameraChange>;

export type MediaKind = "microphone" | "camera" | "screen";

/** What this device is capturing right now, and the last thing that went wrong. */
export type LocalMediaSnapshot = {
  microphone: MediaStream | undefined;
  camera: MediaStream | undefined;
  screen: MediaStream | undefined;
  hand: boolean;
  /** Whether I have the whiteboard open for the room. */
  board: boolean;
  microphones: readonly Device[];
  cameras: readonly Device[];
  microphoneId: string | undefined;
  cameraId: string | undefined;
  /** The output the call plays on to stay out of the shared computer sound; absent where the Linux helper is off. */
  speaker: string | undefined;
  voiceFilter: VoiceFilter;
  settings: MediaSettings;
  /** With push to talk on, whether the key is held. */
  talking: boolean;
  busy: MediaKind | undefined;
  problem: { kind: MediaKind; why: "denied" | "unavailable" | "muted" } | undefined;
  /** Whether the owner of the room took my microphone away. */
  silenced: boolean;
};

export type LocalMedia = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LocalMediaSnapshot;
  toggle(kind: MediaKind): Promise<void>;
  toggleHand(): void;
  /** Adds the computer's sound from the Linux helper to a screen that went without sound, telling whether it found it. */
  addScreenSound(): Promise<boolean>;
  /** Opens the whiteboard for the room, or stops showing it. */
  setBoard(open: boolean): void;
  /** Takes the microphone away, turning it off, or gives it back without turning it on. */
  silence(on: boolean): void;
  /** Reads the microphones and cameras the browser offers; their names appear only after a capture was allowed. */
  refreshDevices(): Promise<void>;
  /** Uses another microphone or camera, restarting the capture when it is on. */
  choose(kind: "microphone" | "camera", id: string): Promise<void>;
  /** Changes the voice filter, restarting the microphone when it is on. */
  setVoiceFilter(filter: VoiceFilter): Promise<void>;
  /** Changes how this device captures and sends; what is being captured follows at once. */
  setSettings(change: Partial<MediaSettings>): Promise<void>;
  /** Holds or lets go of the talk key. */
  talk(held: boolean): void;
  /** Takes the store back into use after a dispose, as React's development mode does when it mounts a component twice. */
  revive(): void;
  dispose(): void;
};

const OFF: LocalMediaSnapshot = {
  microphone: undefined,
  camera: undefined,
  screen: undefined,
  hand: false,
  board: false,
  silenced: false,
  microphones: [],
  cameras: [],
  microphoneId: undefined,
  cameraId: undefined,
  speaker: undefined,
  voiceFilter: "standard",
  settings: DEFAULT_SETTINGS,
  talking: false,
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
    (snapshot.hand ? FLAG.hand : 0) |
    (snapshot.board ? FLAG.board : 0)
  );
}

function stop(stream: MediaStream | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Microphone, camera, screen and the raised hand of this device, as a store: each is asked of the browser when turned on and released when turned off. */
export function createLocalMedia(devices: MediaDevicesPort | undefined, onFlags: (flags: number) => void, cleaner?: VoiceCleaner, initial: MediaSettings = DEFAULT_SETTINGS, effects?: CameraEffects): LocalMedia {
  const releases = new WeakMap<MediaStream, () => void>();
  const listeners = new Set<() => void>();
  let snapshot: LocalMediaSnapshot = { ...OFF, settings: initial };
  let disposed = false;
  let rawCamera: MediaStream | undefined;
  let changer: CameraChange | undefined;

  function patch(next: Partial<LocalMediaSnapshot>) {
    snapshot = { ...snapshot, ...next };
    onFlags(flagsOf(snapshot));
    listeners.forEach((listener) => listener());
  }

  async function capture(kind: MediaKind): Promise<MediaStream> {
    if (!devices) return Promise.reject(new DOMException("no capture on this device", "NotFoundError"));
    if (kind === "screen") {
      const { width, height, frameRate } = screenShape(snapshot.settings.screenQuality);
      const picker: ScreenPicker = {
        video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
        audio: snapshot.settings.screenAudio || snapshot.settings.pcSound ? ({ restrictOwnAudio: true } as MediaTrackConstraints) : false,
        systemAudio: "include",
        surfaceSwitching: "include",
        selfBrowserSurface: "exclude",
        monitorTypeSurfaces: "include",
      };
      const shared = await devices.display(picker);
      if (!snapshot.settings.pcSound || shared.getAudioTracks().length > 0) return shared;
      return withDesktopSound(devices, shared);
    }
    if (kind === "camera") {
      const { width, height, frameRate } = cameraShape(snapshot.settings.cameraQuality);
      rawCamera = await devices.user({ video: { ...WHOLE_SENSOR, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate }, ...(snapshot.cameraId ? { deviceId: { exact: snapshot.cameraId } } : {}) } });
      return dress(rawCamera);
    }
    return microphone(devices);
  }

  async function withDesktopSound(from: MediaDevicesPort, shared: MediaStream): Promise<MediaStream> {
    try {
      const sound = await openDesktopSound(from);
      return sound ? new MediaStream([...shared.getVideoTracks(), ...sound.getAudioTracks()]) : shared;
    } catch {
      return shared;
    }
  }

  function watch(kind: MediaKind, stream: MediaStream) {
    const ending = kind === "screen" ? stream.getVideoTracks() : stream.getTracks();
    ending.forEach((track) =>
      track.addEventListener("ended", () => {
        if (snapshot[kind] !== stream) return;
        end(stream);
        patch({ [kind]: undefined });
      }),
    );
  }

  async function microphone(from: MediaDevicesPort): Promise<MediaStream> {
    const filter = snapshot.voiceFilter;
    const { echo, gain, strength, balanced, gate, gateDb } = snapshot.settings;
    const denoise = filter === "strong";
    const chained = cleaner !== undefined && (denoise || balanced || gate);
    const raw = await from.user({
      audio: { echoCancellation: filter !== "off" && echo, noiseSuppression: filter === "standard" || (denoise && !chained), autoGainControl: filter !== "off" && gain, ...(snapshot.microphoneId ? { deviceId: { exact: snapshot.microphoneId } } : {}) },
    });
    if (!chained) return raw;
    try {
      const cleaned = await cleaner(raw, { denoise, strength, balanced, gate, gateDb });
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

  async function dress(raw: MediaStream): Promise<MediaStream> {
    const effect = snapshot.settings.cameraEffect;
    changer = undefined;
    if (effect === "none" || !effects) return raw;
    try {
      const made = await effects(raw, effect);
      changer = made;
      releases.set(made.stream, () => {
        made.release();
        stop(raw);
      });
      raw.getTracks().forEach((track) => track.addEventListener("ended", () => made.stream.getTracks().forEach((dressed) => dressed.dispatchEvent(new Event("ended")))));
      return made.stream;
    } catch {
      return raw;
    }
  }

  async function redress() {
    const shown = snapshot.camera;
    const raw = rawCamera;
    const effect = snapshot.settings.cameraEffect;
    if (!shown || !raw) return;
    if (changer && shown === changer.stream) {
      changer.set(effect);
      return;
    }
    const next = await dress(raw);
    if (next === raw) return;
    if (disposed || snapshot.camera !== shown) {
      releases.get(next)?.();
      return;
    }
    next.getTracks().forEach((track) =>
      track.addEventListener("ended", () => {
        if (snapshot.camera === next) patch({ camera: undefined });
      }),
    );
    patch({ camera: next });
  }

  function gateKey() {
    const open = !snapshot.settings.pushToTalk || snapshot.talking;
    snapshot.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = open;
    });
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
      const named = (kind: MediaDeviceKind) => all.filter((device) => device.kind === kind && device.deviceId !== "" && !isHelperInput(device.label)).map((device, index) => ({ id: device.deviceId, label: device.label || `${index + 1}` }));
      if (!disposed) patch({ microphones: named("audioinput"), cameras: named("videoinput"), speaker: callOutput(all) });
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
      if (kind === "microphone" && !current && snapshot.silenced) {
        patch({ problem: { kind, why: "muted" } });
        return;
      }
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
        if (kind === "microphone" && snapshot.silenced) {
          end(stream);
          patch({ busy: undefined });
          return;
        }
        watch(kind, stream);
        patch({ [kind]: stream, busy: undefined });
        if (kind === "microphone") gateKey();
        if (kind === "screen") stream.getVideoTracks().forEach((track) => void (track.contentHint = "detail"));
        void refreshDevices();
      } catch (error) {
        const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
        const cancelled = kind === "screen" && denied;
        patch({ busy: undefined, problem: cancelled ? undefined : { kind, why: denied ? "denied" : "unavailable" } });
      }
    },
    async addScreenSound() {
      const shown = snapshot.screen;
      if (!devices || !shown) return false;
      if (shown.getAudioTracks().length > 0) return true;
      const both = await withDesktopSound(devices, shown);
      if (both === shown) return false;
      if (disposed || snapshot.screen !== shown) {
        both.getAudioTracks().forEach((track) => track.stop());
        return false;
      }
      watch("screen", both);
      patch({ screen: both });
      void refreshDevices();
      return true;
    },
    toggleHand() {
      patch({ hand: !snapshot.hand });
    },
    silence(on) {
      if (snapshot.silenced === on) return;
      const open = snapshot.microphone;
      if (on && open) end(open);
      patch({ silenced: on, problem: undefined, ...(on ? { microphone: undefined } : {}) });
    },
    setBoard(open) {
      if (snapshot.board !== open) patch({ board: open });
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
    async setSettings(change) {
      const before = snapshot.settings;
      const settings = { ...before, ...change };
      patch({ settings });
      const differs = (...keys: (keyof MediaSettings)[]) => keys.some((key) => before[key] !== settings[key]);
      if (differs("pushToTalk")) gateKey();
      if (differs("echo", "gain", "strength", "balanced", "gate", "gateDb")) await restart("microphone");
      if (differs("cameraQuality")) await restart("camera");
      else if (differs("cameraEffect")) await redress();
      if (differs("pcSound") && settings.pcSound) await store.addScreenSound();
      if (differs("screenQuality")) {
        const { width, height, frameRate } = screenShape(settings.screenQuality);
        await Promise.all((snapshot.screen?.getVideoTracks() ?? []).map((track) => track.applyConstraints({ width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } }).catch(() => undefined)));
      }
    },
    talk(held) {
      if (snapshot.talking === held) return;
      patch({ talking: held });
      gateKey();
    },
    revive() {
      disposed = false;
    },
    dispose() {
      disposed = true;
      end(snapshot.microphone);
      end(snapshot.camera);
      end(snapshot.screen);
      patch({ ...OFF, settings: snapshot.settings });
    },
  };
  return store;
}
