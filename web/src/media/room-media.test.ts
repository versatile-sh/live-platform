import { describe, expect, test, vi } from "vitest";

import type { RtcSignal } from "../signal/protocol";
import { createRoomMedia } from "./room-media";

const settle = () => new Promise((done) => setTimeout(done, 0));

class FakeStream {
  readonly id: string;
  constructor(private readonly tracks: { id: string }[]) {
    this.id = tracks[0]?.id ?? "";
  }
  getTracks() {
    return this.tracks;
  }
}
vi.stubGlobal("MediaStream", FakeStream);

function fakeConnection() {
  const pc = {
    senders: [] as { track: { id: string } | null }[],
    remoteDescription: null as unknown,
    closed: false,
    onicecandidate: null as ((event: { candidate: { toJSON(): object } | null }) => void) | null,
    ontrack: null as ((event: { streams: { id: string }[]; track: { addEventListener(type: string, listener: () => void): void } }) => void) | null,
    added: [] as object[],
    addTrack(track: { id: string }) {
      const sender = { track, replaceTrack: async () => undefined };
      pc.senders.push(sender);
      return sender;
    },
    stopped: [] as unknown[],
    getTransceivers: () =>
      pc.senders.map((sender) => ({
        sender,
        stop() {
          pc.stopped.push(sender);
          pc.senders = pc.senders.filter((kept) => kept !== sender);
        },
      })),
    createOffer: async () => ({ type: "offer", sdp: `offer:${pc.senders.map((s) => s.track?.id).join(",")}` }),
    createAnswer: async () => ({ type: "answer", sdp: "answer" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async (description: unknown) => {
      pc.remoteDescription = description;
    },
    addIceCandidate: async (init: object) => {
      pc.added.push(init);
    },
    close() {
      pc.closed = true;
    },
  };
  return pc;
}

function setup() {
  const made: ReturnType<typeof fakeConnection>[] = [];
  const sent: RtcSignal[] = [];
  const media = createRoomMedia(
    () => {
      const pc = fakeConnection();
      made.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    (signal) => sent.push(signal),
  );
  return { media, made, sent };
}

const track = (id: string) => ({ id, readyState: "live" }) as unknown as MediaStreamTrack;

describe("room media", () => {
  describe("when the server offers the room", () => {
    test("answers on the subscribe connection and applies candidates that came early", async () => {
      const { media, made, sent } = setup();
      media.signal({ role: "sub", kind: "ice", candidate: JSON.stringify({ candidate: "early" }) });
      media.signal({ role: "sub", kind: "offer", sdp: "the offer" });
      await settle();
      expect(sent).toEqual([{ role: "sub", kind: "answer", sdp: "answer" }]);
      expect(made[0]!.added).toEqual([{ candidate: "early" }]);
    });

    test("files an arriving track under who sent it and what it is, and forgets it when it ends", async () => {
      const { media, made } = setup();
      media.signal({ role: "sub", kind: "offer", sdp: "the offer" });
      await settle();
      let end = () => undefined as void;
      made[0]!.ontrack!({ streams: [{ id: "7:camera" }], track: { addEventListener: (_type, listener) => void (end = listener) } });
      expect(Object.keys(media.getSnapshot()[7] ?? {})).toEqual(["camera"]);
      made[0]!.ontrack!({ streams: [{ id: "nonsense" }], track: { addEventListener: () => undefined } });
      expect(Object.keys(media.getSnapshot())).toEqual(["7"]);
      end();
      expect(media.getSnapshot()).toEqual({});
    });
  });

  describe("when I publish", () => {
    test("offers on the publish connection, saying which track is which", async () => {
      const { media, sent } = setup();
      media.publish({ microphone: track("m1"), camera: track("c1") });
      await settle();
      expect(sent).toEqual([{ role: "pub", kind: "offer", sdp: "offer:m1,c1", sources: { m1: "microphone", c1: "camera" } }]);
    });

    test("offers again, once, for what changed while the first offer was unanswered", async () => {
      const { media, sent } = setup();
      media.publish({ microphone: track("m1") });
      await settle();
      media.publish({ microphone: track("m1"), screen: track("s1") });
      media.publish({ screen: track("s1") });
      await settle();
      expect(sent).toHaveLength(1);
      media.signal({ role: "pub", kind: "answer", sdp: "ok" });
      await settle();
      expect(sent.at(-1)).toEqual({ role: "pub", kind: "offer", sdp: "offer:s1", sources: { s1: "screen" } });
      expect(sent).toHaveLength(2);
    });

    test("stops the transceiver of a source I turn off, so a source turned on later never takes its place", async () => {
      const { media, made, sent } = setup();
      media.publish({ screen: track("s1") });
      await settle();
      media.signal({ role: "pub", kind: "answer", sdp: "ok" });
      await settle();
      media.publish({});
      await settle();
      media.signal({ role: "pub", kind: "answer", sdp: "ok" });
      await settle();
      media.publish({ camera: track("c1") });
      await settle();
      expect(made[0]!.stopped).toEqual([{ track: track("s1"), replaceTrack: expect.any(Function) }]);
      expect(sent.at(-1)).toEqual({ role: "pub", kind: "offer", sdp: "offer:c1", sources: { c1: "camera" } });
    });

    test("tells the server I stopped everything, then closes the publish connection and publishes later on a new one", async () => {
      const { media, made, sent } = setup();
      media.publish({ screen: track("s1") });
      await settle();
      media.publish({});
      media.signal({ role: "pub", kind: "answer", sdp: "ok" });
      await settle();
      expect(sent.at(-1)).toEqual({ role: "pub", kind: "offer", sdp: "offer:", sources: {} });
      expect(made[0]!.closed).toBe(false);
      media.signal({ role: "pub", kind: "answer", sdp: "ok" });
      await settle();
      expect(made[0]!.closed).toBe(true);
      media.publish({ screen: track("s2") });
      await settle();
      expect(made).toHaveLength(2);
      expect(sent.at(-1)).toEqual({ role: "pub", kind: "offer", sdp: "offer:s2", sources: { s2: "screen" } });
    });

    test("starts the publish connection over when an offer is never answered", async () => {
      vi.useFakeTimers();
      try {
        const { media, made, sent } = setup();
        media.publish({ screen: track("s1") });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(made[0]!.closed).toBe(true);
        expect(made).toHaveLength(2);
        expect(sent.filter((signal) => signal.kind === "offer")).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    test("opens no connection while there is nothing to send", () => {
      const { media, made } = setup();
      media.publish({});
      expect(made).toHaveLength(0);
    });
  });

  describe("when my place in the room is established again", () => {
    test("closes both connections, forgets what it was sent, and offers what I was publishing", async () => {
      const { media, made, sent } = setup();
      media.signal({ role: "sub", kind: "offer", sdp: "the offer" });
      media.publish({ camera: track("c1") });
      await settle();
      media.restart();
      await settle();
      expect(made.slice(0, 2).every((pc) => pc.closed)).toBe(true);
      expect(media.getSnapshot()).toEqual({});
      expect(sent.at(-1)).toMatchObject({ role: "pub", kind: "offer", sources: { c1: "camera" } });
    });
  });

  test("without a way to make connections, does nothing", () => {
    const sent: RtcSignal[] = [];
    const media = createRoomMedia(undefined, (signal) => sent.push(signal));
    media.signal({ role: "sub", kind: "offer", sdp: "x" });
    media.publish({ camera: track("c1") });
    expect(sent).toEqual([]);
  });
});
