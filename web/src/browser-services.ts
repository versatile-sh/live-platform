import { cleanFace, formatLook, parseLook, randomLook } from "./domain/look";
import { stageCamera } from "./media/camera-effect";
import { parseSettings } from "./media/settings";
import { createTheme } from "./ui/theme";
import { createEntryIntent } from "./session/intent";
import { createProjectStore, loadStars } from "./project/project-store";
import { createRoomsApi } from "./api/rooms";
import { derive, generatePassword } from "./domain/password";
import { GIF_MAX_BYTES, PHOTO_SOURCE_MAX_BYTES, sniffPhoto, toBase64 } from "./domain/photo";
import { passwordFromHash } from "./domain/share-link";
import { parsePass, readInvite, readKept, withKept, withoutInvite, type GuestPass } from "./domain/guest-pass";
import { createLobbyStore, documentVisibility } from "./lobby/lobby-store";
import { platformSocket, signalUrl } from "./signal/link";
import type { Services } from "./services";

const NAME_KEY = "live.name";
const LOOK_KEY = "live.look";
const FACE_KEY = "live.face";
const PASSES_KEY = "live.passes";
const THEME_KEY = "live.theme";
const SETTINGS_KEY = "live.media";
/** A pass is handed once by the server, so a second ask for the same id (React runs effects twice in development) reuses the first. */
const passes = new Map<string, Promise<GuestPass | undefined>>();
const PHOTO_SIDE = 128;
const PHOTO_MAX_BASE64 = 13_000;

async function shrinkPhoto(file: Blob): Promise<string | undefined> {
  try {
    if (file.size > PHOTO_SOURCE_MAX_BYTES) return undefined;
    if (sniffPhoto(new Uint8Array(await file.slice(0, 6).arrayBuffer())) === "gif" && file.size <= GIF_MAX_BYTES) return toBase64(new Uint8Array(await file.arrayBuffer()));
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PHOTO_SIDE;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
    for (const quality of [0.8, 0.6, 0.4]) {
      const data = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
      if (data !== "" && data.length <= PHOTO_MAX_BASE64) return data;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function safeStorage(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return window[kind];
  } catch {
    return undefined;
  }
}

/**
 * Whether the page is going away because of a reload: with the Navigation API the navigation type says so,
 * and without it every pagehide is treated as leaving.
 */
function watchReload(): () => boolean {
  let reloading = false;
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigate", (event) => {
    reloading = (event as unknown as { navigationType?: string }).navigationType === "reload";
  });
  return () => reloading;
}

/** Wires the services to the real browser. */
export function createBrowserServices(): Services {
  const roomsApi = createRoomsApi();
  const local = safeStorage("localStorage");
  const session = safeStorage("sessionStorage");
  const isReloading = watchReload();
  const noStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  return {
    roomsApi,
    lobby: createLobbyStore({ load: (signal) => roomsApi.lobby(signal), visibility: documentVisibility() }),
    project: createProjectStore(() => loadStars()),
    socket: platformSocket(),
    signalUrl: signalUrl(window.location),
    seatStorage: session ?? noStorage,
    rtc: typeof RTCPeerConnection === "undefined" ? undefined : () => new RTCPeerConnection(),
    mediaDevices: navigator.mediaDevices
      ? {
          user: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
          list: () => navigator.mediaDevices.enumerateDevices(),
          display: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
        }
      : undefined,
    voiceCleaner: typeof AudioWorkletNode === "undefined" || typeof WebAssembly === "undefined" ? undefined : async (raw, chain) => (await import("./media/voice-cleaner")).cleanVoice(raw, chain),
    cameraEffects: typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype && typeof WebAssembly !== "undefined" ? (raw, effect) => stageCamera(raw, effect, async () => (await import("./media/camera-segmenter")).createPersonFinder()) : undefined,
    entryIntent: createEntryIntent(),
    faceMemory: {
      read() {
        const face = local?.getItem(FACE_KEY) ?? "";
        return cleanFace(face) === face ? face : "";
      },
      write(face) {
        try {
          local?.setItem(FACE_KEY, face);
        } catch {
          return;
        }
      },
    },
    passMemory: {
      read: (slug) => readKept(local?.getItem(PASSES_KEY) ?? null, slug),
      write(slug, kept) {
        try {
          local?.setItem(PASSES_KEY, withKept(local.getItem(PASSES_KEY), slug, kept));
        } catch {
          return;
        }
      },
    },
    theme: createTheme({
      read() {
        const kept = local?.getItem(THEME_KEY);
        return kept === "dark" || kept === "light" ? kept : undefined;
      },
      write(theme) {
        try {
          local?.setItem(THEME_KEY, theme);
        } catch {
          return;
        }
      },
      systemPrefersLight: () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches,
      root: document.documentElement,
    }),
    shrinkPhoto,
    settingsMemory: {
      read: () => parseSettings(local?.getItem(SETTINGS_KEY)),
      write(settings) {
        try {
          local?.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
          return;
        }
      },
    },
    lookMemory: {
      read() {
        const kept = local?.getItem(LOOK_KEY) ?? "";
        if (formatLook(parseLook(kept)) === kept) return kept;
        const drawn = randomLook();
        this.write(drawn);
        return drawn;
      },
      write(look) {
        try {
          local?.setItem(LOOK_KEY, look);
        } catch {
          return;
        }
      },
    },
    nameMemory: {
      read: () => local?.getItem(NAME_KEY) ?? "",
      write(name) {
        try {
          local?.setItem(NAME_KEY, name);
        } catch {
          return;
        }
      },
    },
    origin: window.location.origin,
    clipboard: {
      async write(text) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
    },
    readPasswordHash: () => passwordFromHash(window.location.hash),
    forgetHash() {
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    },
    invite: {
      read: () => readInvite(window.location.search),
      forget() {
        const search = withoutInvite(window.location.search);
        if (search !== window.location.search) window.history.replaceState(window.history.state, "", window.location.pathname + search + window.location.hash);
      },
    },
    takePass(id) {
      let taking = passes.get(id);
      if (!taking) {
        taking = fetch(`/api/pass/${encodeURIComponent(id)}`, { cache: "no-store" })
          .then(async (res) => (res.ok ? parsePass(await res.json()) : undefined))
          .catch(() => undefined)
          .then((pass) => {
            if (!pass) passes.delete(id);
            return pass;
          });
        passes.set(id, taking);
      }
      return taking;
    },
    derive: (password, slug) => derive(password, slug),
    generatePassword: (random) => generatePassword(random),
    pageLifecycle: {
      onPageHide(listener) {
        const handle = (event: PageTransitionEvent) => {
          if (!event.persisted && !isReloading()) listener();
        };
        window.addEventListener("pagehide", handle);
        return () => window.removeEventListener("pagehide", handle);
      },
    },
  };
}
