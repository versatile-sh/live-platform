import { describe, expect, test } from "vitest";

import { formatRate, grade, readStats, type StatEntry } from "./stats";

const pair: StatEntry = { type: "candidate-pair", id: "p", nominated: true, state: "succeeded", currentRoundTripTime: 0.053, localCandidateId: "l", remoteCandidateId: "r" };
const host = (type: string, id: string, candidateType = "host"): StatEntry => ({ type, id, candidateType });
const receiving = (bytes: number, lost = 0, got = 1000): StatEntry[] => [
  pair,
  host("local-candidate", "l"),
  host("remote-candidate", "r"),
  { type: "inbound-rtp", id: "v", kind: "video", bytesReceived: bytes, packetsLost: lost, packetsReceived: got, codecId: "c-vp8", jitter: 0.004 },
  { type: "inbound-rtp", id: "a", kind: "audio", bytesReceived: 0, packetsLost: 0, packetsReceived: 0, codecId: "c-opus", jitter: 0.001 },
  { type: "codec", id: "c-vp8", mimeType: "video/VP8" },
  { type: "codec", id: "c-opus", mimeType: "audio/opus" },
];
const sending = (bytes: number): StatEntry[] => [{ type: "outbound-rtp", id: "o", kind: "audio", bytesSent: bytes, codecId: "c-opus" }, { type: "codec", id: "c-opus", mimeType: "audio/opus" }];

describe("readStats", () => {
  test("names the route, delay, jitter and codecs at the first reading, without rates", () => {
    const { stats } = readStats(sending(0), receiving(0), 1000);
    expect(stats).toEqual({ route: "direct", rtt: 53, loss: 0, jitter: 1, receiving: undefined, sending: undefined, videoCodec: "VP8", audioCodec: "opus" });
  });

  test("turns bytes since the previous reading into bits per second", () => {
    const first = readStats(sending(0), receiving(0), 1000);
    const { stats } = readStats(sending(2000), receiving(575_000), 3000, first.mark);
    expect(stats.receiving).toBe(2_300_000);
    expect(stats.sending).toBe(8000);
  });

  test("reports loss as a share of what should have arrived, and a relayed route", () => {
    const relayed = receiving(0, 50, 950).map((entry) => (entry.id === "r" ? host("remote-candidate", "r", "relay") : entry));
    const { stats } = readStats([], relayed, 1000);
    expect(stats.loss).toBe(5);
    expect(stats.route).toBe("relay");
  });

  test("answers nothing it cannot know when there is no connection yet", () => {
    expect(readStats([], [], 1000).stats).toEqual({ route: undefined, rtt: undefined, loss: undefined, jitter: undefined, receiving: undefined, sending: undefined, videoCodec: undefined, audioCodec: undefined });
  });
});

describe("grade and formatRate", () => {
  test("judges by the worse of delay and loss", () => {
    expect(grade({ rtt: 53, loss: 0 })).toBe("excellent");
    expect(grade({ rtt: 150, loss: 0 })).toBe("good");
    expect(grade({ rtt: 40, loss: 8 })).toBe("poor");
    expect(grade({ rtt: undefined, loss: undefined })).toBeUndefined();
  });

  test("writes a rate in the unit that reads best", () => {
    expect(formatRate(2_300_000)).toBe("2.3 Mbps");
    expect(formatRate(8000)).toBe("8 kbps");
    expect(formatRate(undefined)).toBeUndefined();
  });
});
