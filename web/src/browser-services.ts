import { randomLook } from "./domain/look";
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
    mediaDevices: navigator.mediaDevices
      ? {
          user: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
          list: () => navigator.mediaDevices.enumerateDevices(),
          display: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
        }
      : undefined,
    entryIntent: createEntryIntent(),
    lookMemory: {
      read() {
        const kept = Number(local?.getItem(LOOK_KEY));
        if (Number.isInteger(kept) && kept > 0) return kept;
        const drawn = randomLook();
        this.write(drawn);
        return drawn;
      },
      write(look) {
        try {
          local?.setItem(LOOK_KEY, String(look));
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
