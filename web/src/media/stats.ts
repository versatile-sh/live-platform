/** One entry of what a peer connection reports about itself; only the fields read here are named. */
export type StatEntry = { type: string; id: string; [key: string]: unknown };

/** The connection as a person can judge it. */
export type MediaStats = {
  route: "direct" | "relay" | undefined;
  rtt: number | undefined;
  /** Share of packets lost on the way in, 0 to 100. */
  loss: number | undefined;
  jitter: number | undefined;
  receiving: number | undefined;
  sending: number | undefined;
  videoCodec: string | undefined;
  audioCodec: string | undefined;
};

/** What is kept between two readings to turn byte counts into a rate. */
export type StatsMark = { at: number; received: number; sent: number };

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function codecName(entries: readonly StatEntry[], rtp: StatEntry | undefined): string | undefined {
  const codec = entries.find((entry) => entry.type === "codec" && entry.id === rtp?.codecId);
  return typeof codec?.mimeType === "string" ? codec.mimeType.split("/")[1] : undefined;
}

/** Reads the publishing and the receiving connection's reports into figures a person can judge, with rates measured since the previous reading. */
export function readStats(sending: readonly StatEntry[], receiving: readonly StatEntry[], now: number, previous?: StatsMark): { stats: MediaStats; mark: StatsMark } {
  const all = [...receiving, ...sending];
  const pair = all.find((entry) => entry.type === "candidate-pair" && entry.nominated === true && entry.state === "succeeded");
  const ends = all.filter((entry) => (entry.type === "local-candidate" && entry.id === pair?.localCandidateId) || (entry.type === "remote-candidate" && entry.id === pair?.remoteCandidateId));
  const inbound = receiving.filter((entry) => entry.type === "inbound-rtp");
  const outbound = sending.filter((entry) => entry.type === "outbound-rtp");
  const sum = (entries: readonly StatEntry[], field: string) => entries.reduce((total, entry) => total + (num(entry[field]) ?? 0), 0);
  const received = sum(inbound, "bytesReceived");
  const sent = sum(outbound, "bytesSent");
  const lost = sum(inbound, "packetsLost");
  const arrived = sum(inbound, "packetsReceived");
  const seconds = previous ? (now - previous.at) / 1000 : 0;
  const rate = (total: number, before: number | undefined) => (before === undefined || seconds <= 0 || total < before ? undefined : Math.round(((total - before) * 8) / seconds));
  const rttSeconds = num(pair?.currentRoundTripTime);
  const audioIn = inbound.find((entry) => entry.kind === "audio");
  const jitterSeconds = num(audioIn?.jitter) ?? num(inbound[0]?.jitter);
  const video = [...outbound, ...inbound].find((entry) => entry.kind === "video");
  const audio = [...outbound, ...inbound].find((entry) => entry.kind === "audio");
  return {
    stats: {
      route: pair ? (ends.some((end) => end.candidateType === "relay") ? "relay" : "direct") : undefined,
      rtt: rttSeconds === undefined ? undefined : Math.round(rttSeconds * 1000),
      loss: arrived + lost > 0 ? Math.round((Math.max(lost, 0) / (arrived + lost)) * 1000) / 10 : undefined,
      jitter: jitterSeconds === undefined ? undefined : Math.round(jitterSeconds * 1000),
      receiving: rate(received, previous?.received),
      sending: rate(sent, previous?.sent),
      videoCodec: codecName(all, video),
      audioCodec: codecName(all, audio),
    },
    mark: { at: now, received, sent },
  };
}

/** A one-word judgement of the connection from its delay and loss. */
export function grade(stats: Pick<MediaStats, "rtt" | "loss">): "excellent" | "good" | "poor" | undefined {
  if (stats.rtt === undefined && stats.loss === undefined) return undefined;
  const rtt = stats.rtt ?? 0;
  const loss = stats.loss ?? 0;
  if (rtt > 300 || loss > 5) return "poor";
  if (rtt > 120 || loss > 1) return "good";
  return "excellent";
}

/** A rate in the largest unit that keeps it readable. */
export function formatRate(bitsPerSecond: number | undefined): string | undefined {
  if (bitsPerSecond === undefined) return undefined;
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}
