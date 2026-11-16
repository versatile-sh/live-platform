import type { SocketFactory, SocketLike } from "./link";

/** A scripted socket for tests: records what was sent and lets the test play the server. */
export type FakeSocket = SocketLike & {
  url: string;
  protocols: string[];
  sent: string[];
  closedByClient: boolean;
  serverOpen(): void;
  serverSend(frame: unknown): void;
  serverClose(code: number): void;
};

/** A socket factory that hands every socket it creates to `sockets`. */
export function fakeSockets(): { factory: SocketFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = (url, protocols) => {
    const socket: FakeSocket = {
      url,
      protocols,
      sent: [],
      closedByClient: false,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data) => void socket.sent.push(data),
      close: () => {
        socket.closedByClient = true;
      },
      serverOpen: () => void socket.onopen?.(new Event("open")),
      serverSend: (frame) => void socket.onmessage?.(new MessageEvent("message", { data: typeof frame === "string" ? frame : JSON.stringify(frame) })),
      serverClose: (code) => void socket.onclose?.(Object.assign(new Event("close"), { code }) as CloseEvent),
    };
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
}
