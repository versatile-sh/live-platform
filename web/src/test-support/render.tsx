import { createEntryIntent } from "../session/intent";
import { PROJECT_LINKS } from "../project/project-store";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS } from "../media/settings";

import type { LobbyState, LobbyStore } from "../lobby/lobby-store";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "../i18n";
import { NavigationProvider } from "../routing/Navigation";
import type { PathnameStore } from "../routing/pathname-store";
import { ServicesProvider, type Services } from "../services";
import { fakeSockets } from "../signal/fake-socket";

/** A lobby store frozen at one state. */
export function staticLobby(state: LobbyState): LobbyStore {
  return { subscribe: () => () => undefined, getSnapshot: () => state };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/** A pathname store that records navigations instead of touching the History API. */
export function fakePathname(initial = "/"): PathnameStore & { visited: string[] } {
  let current = initial;
  const listeners = new Set<() => void>();
  const store = {
    visited: [] as string[],
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => current,
    navigate(path: string) {
      store.visited.push(path);
      current = path;
      listeners.forEach((listener) => listener());
    },
  };
  return store;
}

/** Services that touch nothing outside the test, each replaceable. */
export function fakeServices(overrides: Partial<Services> = {}): Services & { sockets: ReturnType<typeof fakeSockets>["sockets"]; copied: string[] } {
  const { factory, sockets } = fakeSockets();
  const names = { value: "" };
  const copied: string[] = [];
  return {
    roomsApi: { status: async () => ({ kind: "unreachable" }), lobby: async () => ({ kind: "unreachable" }) },
    lobby: staticLobby({ status: "ready", rooms: [] }),
    project: { subscribe: () => () => undefined, getSnapshot: () => PROJECT_LINKS },
    socket: factory,
    signalUrl: "ws://test/ws",
    seatStorage: memoryStorage(),
    mediaDevices: undefined,
    voiceCleaner: undefined,
    settingsMemory: { read: () => DEFAULT_SETTINGS, write: () => undefined },
    rtc: undefined,
    entryIntent: createEntryIntent(),
    lookMemory: { read: () => "ff9ec7-0e1116-0", write: () => undefined },
    faceMemory: { read: () => "^_^", write: () => undefined },
    shrinkPhoto: async () => "/9j/4AAQ",
    nameMemory: { read: () => names.value, write: (name) => void (names.value = name) },
    origin: "https://live.test",
    clipboard: {
      write: async (text) => {
        copied.push(text);
        return true;
      },
    },
    readPasswordHash: () => "",
    forgetHash: () => undefined,
    derive: async (password, slug) => ({ verifier: `v:${slug}:${password}`, mediaKey: new Uint8Array(32) }),
    generatePassword: () => "Kq7mR2xP",
    pageLifecycle: { onPageHide: () => () => undefined },
    ...overrides,
    sockets,
    copied,
  };
}

/** Renders `ui` inside every provider the app has. */
export function renderWithApp(ui: ReactNode, { services = fakeServices(), locale = "en", pathname = fakePathname() }: { services?: Services; locale?: Locale; pathname?: PathnameStore } = {}) {
  return render(
    <I18nProvider locale={locale}>
      <ServicesProvider services={services}>
        <NavigationProvider store={pathname}>{ui}</NavigationProvider>
      </ServicesProvider>
    </I18nProvider>,
  );
}

/** Renders and lets a suspended tree settle, for pages that wait on a promise. */
export async function renderWithAppSettled(...args: Parameters<typeof renderWithApp>) {
  await act(async () => {
    renderWithApp(...args);
  });
}
