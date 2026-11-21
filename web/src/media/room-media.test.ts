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

type FakeTrack = { id: string } | null;
type FakeSender = { track: FakeTrack; replaceTrack(track: FakeTrack): Promise<void> };

function fakeConnection() {
  const pc = {
    senders: [] as FakeSender[],
    remoteDescription: null as unknown,
    closed: false,
    connectionState: "new",
    onconnectionstatechange: null as (() => void) | null,
    onicecandidate: null as ((event: { candidate: { toJSON(): object } | null }) => void) | null,
    ontrack: null as ((event: { streams: { id: string }[]; track: { onended: (() => void) | null } }) => void) | null,
    added: [] as object[],
    addTransceiver(track: { id: string }, init: { direction: string }) {
      const sender: FakeSender = {
        track,
        async replaceTrack(next) {
          sender.track = next;
        },
      };
      pc.senders.push(sender);
      return { sender, direction: init.direction, stop: () => pc.stopped.push(sender) };
    },
    stopped: [] as unknown[],
    getTransceivers: () => [],
    createOffer: async () => ({ type: "offer", sdp: `offer:${pc.senders.map((s) => s.track?.id ?? "-").join(",")}` }),
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
      const camera = { onended: null as (() => void) | null };
      made[0]!.ontrack!({ streams: [{ id: "7:camera" }], track: camera });
      expect(Object.keys(media.getSnapshot()[7] ?? {})).toEqual(["camera"]);
      made[0]!.ontrack!({ streams: [{ id: "nonsense" }], track: { onended: null } });
      expect(Object.keys(media.getSnapshot())).toEqual(["7"]);
      camera.onended!();
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
      expect(sent.at(-1)).toEqual({ role: "pub", kind: "offer", sdp: "offer:-,s1", sources: { s1: "screen" } });
      expect(sent).toHaveLength(2);
    });

    test("keeps one transceiver per source for good: turning a source off empties it and leaves it out of the offer, so no m-line is ever rejected and no other source takes its place", async () => {
      const { media, made, sent } = setup();
      const answer = async () => {
        await settle();
        media.signal({ role: "pub", kind: "answer", sdp: "ok" });
        await settle();
      };
      media.publish({ camera: track("c1"), screen: track("s1") });
      await answer();
      media.publish({ screen: track("s1") });
      await answer();
      expect(sent.at(-1)).toEqual({ role: "pub", kind: "offer", sdp: "offer:-,s1", sources: { s1: "screen" } });
      media.publish({ screen: track("s1"), camera: track("c2") });
      await answer();
      expect(made).toHaveLength(1);
      expect(made[0]!.senders).toHaveLength(2);
      expect(made[0]!.stopped).toEqual([]);
      expect(sent.at(-1)).toEqual({ role: "pub", kind: "offer", sdp: "offer:c2,s1", sources: { c1: "camera", s1: "screen" } });
    });

    test("changing the track of a source that stays on does not negotiate again", async () => {
      const { media, made, sent } = setup();
      media.publish({ camera: track("c1") });
      await settle();
      media.signal({ role: "pub", kind: "answer", sdp: "ok" });
      await settle();
      media.publish({ camera: track("c2") });
      await settle();
      expect(sent).toHaveLength(1);
      expect(made[0]!.senders[0]!.track).toEqual(track("c2"));
    });

    test("builds the publish connection again when its offer goes unanswered, and when it fails", async () => {
      vi.useFakeTimers();
      try {
        const { media, made, sent } = setup();
        media.publish({ camera: track("c1") });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(made[0]!.closed).toBe(true);
        expect(made).toHaveLength(2);
        expect(sent.at(-1)).toMatchObject({ role: "pub", kind: "offer", sources: { c1: "camera" } });
        media.signal({ role: "pub", kind: "answer", sdp: "ok" });
        await vi.advanceTimersByTimeAsync(0);
        made[1]!.connectionState = "failed";
        made[1]!.onconnectionstatechange!();
        await vi.advanceTimersByTimeAsync(0);
        expect(made[1]!.closed).toBe(true);
        expect(made).toHaveLength(3);
        expect(sent.filter((signal) => signal.kind === "offer")).toHaveLength(3);
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
