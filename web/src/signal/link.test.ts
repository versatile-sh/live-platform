import { describe, expect, test } from "vitest";

import { openLink, signalUrl, type LinkEvent } from "./link";
import { fakeSockets } from "./fake-socket";

function setup(hello = { t: "join", slug: "demo", name: "Ana" } as const) {
  const { factory, sockets } = fakeSockets();
  const events: LinkEvent[] = [];
  const link = openLink({ url: "ws://x/ws", hello, socket: factory, onEvent: (e) => events.push(e) });
  const socket = sockets[0]!;
  return { link, socket, events };
}

describe("openLink", () => {
  test("asks for the lv.1 subprotocol", () => {
    expect(setup().socket.protocols).toEqual(["lv.1"]);
  });

  describe("when the socket opens", () => {
    test("sends the hello as the first frame", () => {
      const { socket } = setup();
      socket.serverOpen();
      expect(socket.sent.map((s) => JSON.parse(s))).toEqual([{ t: "join", slug: "demo", name: "Ana" }]);
    });
  });

  describe("before joined arrives", () => {
    test("refuses to send other frames", () => {
      const { link, socket } = setup();
      socket.serverOpen();
      expect(link.send({ t: "hb" })).toBe(false);
      expect(socket.sent).toHaveLength(1);
    });
  });

  describe("after joined arrives", () => {
    test("sends frames and reports what the server sent", () => {
      const { link, socket, events } = setup();
      socket.serverOpen();
      socket.serverSend({ t: "joined", pid: 1, gen: 1, secret: "s" });
      expect(link.send({ t: "hb" })).toBe(true);
      expect(socket.sent).toHaveLength(2);
      expect(events).toEqual([{ kind: "frame", frame: { t: "joined", pid: 1, gen: 1, secret: "s" } }]);
    });
  });

  describe("when the server refuses the entry", () => {
    test("reports the close with the error frame that preceded it", () => {
      const { socket, events } = setup();
      socket.serverOpen();
      socket.serverSend({ t: "error", code: "PERMISSION_DENIED", message: "needs password" });
      socket.serverClose(4400);
      expect(events.at(-1)).toEqual({ kind: "closed", code: 4400, meaning: { kind: "refused" }, error: { code: "PERMISSION_DENIED", message: "needs password" } });
    });
  });

  describe("when the client closes the link", () => {
    test("closes the socket and reports nothing more", () => {
      const { link, socket, events } = setup();
      socket.serverOpen();
      link.close();
      socket.serverClose(1000);
      expect(socket.closedByClient).toBe(true);
      expect(events).toEqual([]);
    });
  });

  test("ignores frames it cannot parse", () => {
    const { socket, events } = setup();
    socket.serverOpen();
    socket.serverSend("garbage");
    expect(events).toEqual([]);
  });
});

describe("signalUrl", () => {
  test("uses wss on https pages", () => {
    expect(signalUrl({ protocol: "https:", host: "live.versatile.sh" })).toBe("wss://live.versatile.sh/ws");
  });

  test("uses ws on http pages", () => {
    expect(signalUrl({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws");
  });
});
