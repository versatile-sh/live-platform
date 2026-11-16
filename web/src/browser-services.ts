import { formatLook, parseLook, randomLook } from "./domain/look";
import { createEntryIntent } from "./session/intent";
import { createProjectStore, loadStars } from "./project/project-store";
import { createRoomsApi } from "./api/rooms";
import { derive, generatePassword } from "./domain/password";
import { passwordFromHash } from "./domain/share-link";
import { createLobbyStore, documentVisibility } from "./lobby/lobby-store";
import { platformSocket, signalUrl } from "./signal/link";
import type { Services } from "./services";

const NAME_KEY = "live.name";
const LOOK_KEY = "live.look";
const FACE_KEY = "live.face";
const PHOTO_SIDE = 128;
const PHOTO_MAX_BASE64 = 13_000;

async function shrinkPhoto(file: Blob): Promise<string | undefined> {
  try {
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
    entryIntent: createEntryIntent(),
    faceMemory: {
      read: () => local?.getItem(FACE_KEY) ?? "",
      write(face) {
        try {
          local?.setItem(FACE_KEY, face);
        } catch {
          return;
        }
      },
    },
    shrinkPhoto,
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
