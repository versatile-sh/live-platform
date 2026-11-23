import { SUBPROTOCOL, closeMeaning, encodeClientFrame, parseServerFrame, type ClientFrame, type ErrorCode, type Hello, type ServerFrame, type CloseMeaning } from "./protocol";

/** The slice of a WebSocket the link uses, so Node's, the browser's or a fake can stand in. */
export type SocketLike = {
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onclose: ((event: CloseEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

/** Opens a socket to `url` asking for the given subprotocols. */
export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

/** What a link reports: a frame, or the end of the socket with the last error frame that preceded it. */
export type LinkEvent =
  | { kind: "frame"; frame: ServerFrame }
  | { kind: "closed"; code: number; meaning: CloseMeaning; error?: { code: ErrorCode; message: string } };

export type Link = {
  /** Sends a frame once the server has answered the hello; returns false when it was not sent. */
  send(frame: ClientFrame): boolean;
  /** Closes the socket without reporting a `closed` event. */
  close(): void;
};

export type LinkOptions = {
  url: string;
  hello: Hello;
  socket: SocketFactory;
  onEvent: (event: LinkEvent) => void;
};

/** The address of the signalling endpoint on the page's own origin. */
export function signalUrl(location: { protocol: string; host: string }): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}

/**
 * One signalling connection: sends the hello when the socket opens, holds every other frame until `joined` arrives,
 * and reports `closed` once with the code and the error frame that explained it. It touches no DOM.
 */
export function openLink({ url, hello, socket: factory, onEvent }: LinkOptions): Link {
  const socket = factory(url, [SUBPROTOCOL]);
  let joined = false;
  let detached = false;
  let lastError: { code: ErrorCode; message: string } | undefined;

  socket.onopen = () => {
    if (!detached) socket.send(encodeClientFrame(hello));
  };
  socket.onmessage = (event) => {
    if (detached || typeof event.data !== "string") return;
    const frame = parseServerFrame(event.data);
    if (!frame) return;
    if (frame.t === "joined") joined = true;
    if (frame.t === "error") lastError = { code: frame.code === "ban-not-kept" ? "INTERNAL" : frame.code, message: frame.message };
    onEvent({ kind: "frame", frame });
  };
  socket.onclose = (event) => {
    if (detached) return;
    detached = true;
    onEvent({ kind: "closed", code: event.code, meaning: closeMeaning(event.code), error: lastError });
  };
  socket.onerror = null;

  return {
    send(frame) {
      if (detached || !joined) return false;
      try {
        socket.send(encodeClientFrame(frame));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      if (detached) return;
      detached = true;
      try {
        socket.close(1000);
      } catch {
        return;
      }
    },
  };
}

/** Wraps the platform WebSocket as a socket factory. */
export function platformSocket(): SocketFactory {
  return (url, protocols) => new WebSocket(url, protocols);
}

