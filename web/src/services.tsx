import { createContext, use, type ReactNode } from "react";

import type { RoomsApi } from "./api/rooms";
import type { Derived, RandomBytes } from "./domain/password";
import type { LobbyStore } from "./lobby/lobby-store";
import type { MediaDevicesPort } from "./media/local-media";
import type { ProjectStore } from "./project/project-store";
import type { EntryIntent } from "./session/intent";
import type { SeatStorage } from "./session/seat";
import type { SocketFactory } from "./signal/link";

/** Everything the pages need from the outside world, so tests can replace each piece. */
export type Services = {
  roomsApi: RoomsApi;
  lobby: LobbyStore;
  project: ProjectStore;
  socket: SocketFactory;
  signalUrl: string;
  seatStorage: SeatStorage;
  mediaDevices: MediaDevicesPort | undefined;
  entryIntent: EntryIntent;
  nameMemory: { read(): string; write(name: string): void };
  lookMemory: { read(): number; write(look: number): void };
  faceMemory: { read(): string; write(face: string): void };
  /** Shrinks a picture chosen by the person to a small square JPEG as base64, or nothing when it cannot be read. */
  shrinkPhoto(file: Blob): Promise<string | undefined>;
  origin: string;
  clipboard: { write(text: string): Promise<boolean> };
  readPasswordHash(): string;
  forgetHash(): void;
  derive(password: string, slug: string): Promise<Derived>;
  generatePassword(random?: RandomBytes): string;
  pageLifecycle: { onPageHide(listener: () => void): () => void };
};

const ServicesContext = createContext<Services | undefined>(undefined);

/** Hands the services to the pages below it. */
export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}

/** The services of the running app. */
export function useServices(): Services {
  const services = use(ServicesContext);
  if (!services) throw new Error("useServices needs a ServicesProvider above it");
  return services;
}
