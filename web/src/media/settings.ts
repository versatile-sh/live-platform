/** Keys a person may hold to talk. */
export const TALK_KEYS = ["Space", "ControlLeft", "AltLeft", "Backquote"] as const;
export type TalkKey = (typeof TALK_KEYS)[number];

export const CAMERA_QUALITIES = ["360", "720", "1080"] as const;
export type CameraQuality = (typeof CAMERA_QUALITIES)[number];

export const SCREEN_QUALITIES = ["720p30", "1080p30", "1080p60", "1440p60"] as const;
export type ScreenQuality = (typeof SCREEN_QUALITIES)[number];

/** How this device captures and sends: kept between visits. */
export type MediaSettings = {
  /** How much of the strong filter is heard, 0 to 100; below 100 some of the original voice is mixed back. */
  strength: number;
  echo: boolean;
  gain: boolean;
  /** Cuts the low rumble and evens the voice out. */
  balanced: boolean;
  /** Closes the microphone between phrases. */
  gate: boolean;
  /** The loudness that opens the gate, in decibels. */
  gateDb: number;
  pushToTalk: boolean;
  talkKey: TalkKey;
  sounds: boolean;
  cameraQuality: CameraQuality;
  screenQuality: ScreenQuality;
  screenAudio: boolean;
};

export const DEFAULT_SETTINGS: MediaSettings = {
  strength: 100,
  echo: true,
  gain: true,
  balanced: false,
  gate: false,
  gateDb: -50,
  pushToTalk: false,
  talkKey: "Space",
  sounds: true,
  cameraQuality: "720",
  screenQuality: "1080p30",
  screenAudio: true,
};

const CAMERA = { "360": { width: 640, height: 360, bitrate: 600_000 }, "720": { width: 1280, height: 720, bitrate: 1_500_000 }, "1080": { width: 1920, height: 1080, bitrate: 3_000_000 } } as const;
const SCREEN = {
  "720p30": { width: 1280, height: 720, frameRate: 30, bitrate: 1_500_000 },
  "1080p30": { width: 1920, height: 1080, frameRate: 30, bitrate: 3_000_000 },
  "1080p60": { width: 1920, height: 1080, frameRate: 60, bitrate: 5_000_000 },
  "1440p60": { width: 2560, height: 1440, frameRate: 60, bitrate: 8_000_000 },
} as const;

/** The size, rate and ceiling of bits a camera quality stands for. */
export function cameraShape(quality: CameraQuality) {
  return { ...CAMERA[quality], frameRate: 30 };
}

/** The size, rate and ceiling of bits a screen quality stands for. */
export function screenShape(quality: ScreenQuality) {
  return SCREEN[quality];
}

function within(value: unknown, low: number, high: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), low), high) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Reads settings kept as text, taking the default for anything missing, out of range or of another shape. */
export function parseSettings(text: string | null | undefined): MediaSettings {
  let raw: Partial<Record<keyof MediaSettings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(text ?? "");
    if (typeof parsed === "object" && parsed !== null) raw = parsed;
  } catch {
    raw = {};
  }
  const d = DEFAULT_SETTINGS;
  return {
    strength: within(raw.strength, 0, 100, d.strength),
    echo: flag(raw.echo, d.echo),
    gain: flag(raw.gain, d.gain),
    balanced: flag(raw.balanced, d.balanced),
    gate: flag(raw.gate, d.gate),
    gateDb: within(raw.gateDb, -80, -20, d.gateDb),
    pushToTalk: flag(raw.pushToTalk, d.pushToTalk),
    talkKey: oneOf(raw.talkKey, TALK_KEYS, d.talkKey),
    sounds: flag(raw.sounds, d.sounds),
    cameraQuality: oneOf(raw.cameraQuality, CAMERA_QUALITIES, d.cameraQuality),
    screenQuality: oneOf(raw.screenQuality, SCREEN_QUALITIES, d.screenQuality),
    screenAudio: flag(raw.screenAudio, d.screenAudio),
  };
}
