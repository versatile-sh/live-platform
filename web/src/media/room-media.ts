import type { RtcSignal } from "../signal/protocol";
import type { StatEntry } from "./stats";

/** What a participant can send: its microphone, its camera, its screen, and the sound of its screen. */
export type Source = "microphone" | "camera" | "screen" | "screenAudio";

const SOURCES: readonly Source[] = ["microphone", "camera", "screen", "screenAudio"];

/** What each participant is sending me, by participant id and source. */
export type Remote = Readonly<Record<number, Partial<Record<Source, MediaStream>>>>;

/** How long an offer may first go unanswered before the publish connection is taken as lost and built again; each loss in a row doubles it, up to the most. */
const ANSWER_WAIT_MS = 10_000;
const ANSWER_WAIT_MOST_MS = 60_000;

/** Builds a peer connection, so tests can do without one. */
export type RtcPort = (() => RTCPeerConnection) | undefined;

export type RoomMedia = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Remote;
  /** Applies a media signal the server sent. */
  signal(signal: RtcSignal): void;
  /** Sends exactly these tracks to the room: adds, replaces and removes what differs from before. */
  publish(tracks: Partial<Record<Source, MediaStreamTrack>>): void;
  /** Starts over, because the server gave me new connections; what I was publishing is offered again. */
  restart(): void;
  /** Sets the most bits per second each source may send; a source left out is not limited. */
  limit(ceilings: Partial<Record<Source, number>>): void;
  /** Reads what both connections report about themselves right now. */
  report(): Promise<{ sending: StatEntry[]; receiving: StatEntry[] }>;
  dispose(): void;
};

/** My media in a room: one connection the server sends the others on, and one I publish on, both negotiated through the signalling link. */
export function createRoomMedia(rtc: RtcPort, send: (signal: RtcSignal) => void): RoomMedia {
  const listeners = new Set<() => void>();
  let remote: Remote = {};
  let sub: RTCPeerConnection | undefined;
  let pub: RTCPeerConnection | undefined;
  let wanted: Partial<Record<Source, MediaStreamTrack>> = {};
  let negotiating = false;
  let again = false;
  let early: { role: "pub" | "sub"; init: RTCIceCandidateInit }[] = [];
  const lanes = new Map<Source, { transceiver: RTCRtpTransceiver; stream: string; on: boolean }>();
  let unanswered: ReturnType<typeof setTimeout> | undefined;
  let patience = ANSWER_WAIT_MS;
  let ceilings: Partial<Record<Source, number>> = {};

  function cap(source: Source) {
    const sender = lanes.get(source)?.transceiver.sender;
    const max = ceilings[source];
    if (!sender || typeof sender.getParameters !== "function") return;
    const parameters = sender.getParameters();
    if (!parameters.encodings || parameters.encodings.length === 0) parameters.encodings = [{}];
    if (max === undefined) delete parameters.encodings[0]!.maxBitrate;
    else parameters.encodings[0]!.maxBitrate = max;
    void sender.setParameters(parameters).catch(() => undefined);
  }

  async function entries(pc: RTCPeerConnection | undefined): Promise<StatEntry[]> {
    if (!pc || typeof pc.getStats !== "function") return [];
    const out: StatEntry[] = [];
    (await pc.getStats()).forEach((entry: StatEntry) => out.push(entry));
    return out;
  }

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function setRemote(pid: number, source: Source, stream: MediaStream | undefined) {
    const { [source]: _old, ...rest } = remote[pid] ?? {};
    const mine = stream ? { ...rest, [source]: stream } : rest;
    const { [pid]: _gone, ...others } = remote;
    remote = Object.keys(mine).length > 0 ? { ...others, [pid]: mine } : others;
    emit();
  }

  function wire(pc: RTCPeerConnection, role: "pub" | "sub") {
    pc.onicecandidate = (event) => {
      if (event.candidate) send({ role, kind: "ice", candidate: JSON.stringify(event.candidate.toJSON()) });
    };
  }

  function subscriber(): RTCPeerConnection | undefined {
    if (sub || !rtc) return sub;
    const pc = rtc();
    wire(pc, "sub");
    pc.ontrack = (event) => {
      const [pidText, source] = (event.streams[0]?.id ?? "").split(":");
      const pid = Number(pidText);
      if (!Number.isInteger(pid) || !SOURCES.includes(source as Source)) return;
      const stream = new MediaStream([event.track]);
      setRemote(pid, source as Source, stream);
      event.track.onended = () => {
        if (remote[pid]?.[source as Source] === stream) setRemote(pid, source as Source, undefined);
      };
    };
    sub = pc;
    return pc;
  }

  async function flush(role: "pub" | "sub", pc: RTCPeerConnection) {
    const mine = early.filter((entry) => entry.role === role);
    early = early.filter((entry) => entry.role !== role);
    for (const entry of mine) await pc.addIceCandidate(entry.init).catch(() => undefined);
  }

  async function answerOffer(sdp: string) {
    const pc = subscriber();
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      await flush("sub", pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ role: "sub", kind: "answer", sdp: answer.sdp ?? "" });
      const receiving =
        typeof pc.getTransceivers === "function"
          ? new Set(
              pc
                .getTransceivers()
                .filter((transceiver) => transceiver.currentDirection === "recvonly" || transceiver.currentDirection === "sendrecv")
                .map((transceiver) => transceiver.receiver.track),
            )
          : undefined;
      for (const [pidText, sources] of Object.entries(remote)) {
        for (const [source, stream] of Object.entries(sources)) {
          if (stream.getTracks().every((track) => track.readyState === "ended" || (receiving !== undefined && !receiving.has(track)))) setRemote(Number(pidText), source as Source, undefined);
        }
      }
    } catch {
      return;
    }
  }

  async function negotiate() {
    if (!pub) return;
    if (negotiating) {
      again = true;
      return;
    }
    negotiating = true;
    try {
      const pc = pub;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sources: Record<string, string> = {};
      for (const [source, lane] of lanes) if (lane.on) sources[lane.stream] = source;
      send({ role: "pub", kind: "offer", sdp: offer.sdp ?? "", sources });
      unanswered = setTimeout(() => {
        if (pub !== pc) return;
        patience = Math.min(patience * 2, ANSWER_WAIT_MOST_MS);
        rebuild();
      }, patience);
    } catch {
      settled();
    }
  }

  function settled() {
    clearTimeout(unanswered);
    unanswered = undefined;
    negotiating = false;
    if (again) {
      again = false;
      void negotiate();
    }
  }

  function sync() {
    if (!rtc) return;
    const any = SOURCES.some((source) => wanted[source]);
    if (!pub && !any) return;
    if (!pub) {
      const pc = rtc();
      wire(pc, "pub");
      pc.onconnectionstatechange = () => {
        if (pub === pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) rebuild();
      };
      pub = pc;
    }
    let changed = false;
    for (const source of SOURCES) {
      const track = wanted[source];
      const lane = lanes.get(source);
      if (!lane) {
        if (!track) continue;
        const stream = new MediaStream([track]);
        lanes.set(source, { transceiver: pub.addTransceiver(track, { direction: "sendonly", streams: [stream] }), stream: stream.id, on: true });
        cap(source);
        changed = true;
        continue;
      }
      const { sender } = lane.transceiver;
      if (sender.track !== (track ?? null)) void sender.replaceTrack(track ?? null).catch(() => undefined);
      if (lane.on !== (track !== undefined)) {
        lane.on = track !== undefined;
        changed = true;
      }
    }
    if (changed) void negotiate();
  }

  function dropPub() {
    clearTimeout(unanswered);
    unanswered = undefined;
    pub?.close();
    pub = undefined;
    lanes.clear();
    negotiating = again = false;
    early = early.filter((entry) => entry.role !== "pub");
  }

  function rebuild() {
    dropPub();
    sync();
  }

  function close() {
    dropPub();
    sub?.close();
    sub = undefined;
    early = [];
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => remote,
    limit(next) {
      ceilings = next;
      SOURCES.forEach(cap);
    },
    report: async () => ({ sending: await entries(pub), receiving: await entries(sub) }),
    signal(signal) {
      if (signal.kind === "ice") {
        let init: RTCIceCandidateInit;
        try {
          init = JSON.parse(signal.candidate ?? "") as RTCIceCandidateInit;
        } catch {
          return;
        }
        const pc = signal.role === "sub" ? sub : pub;
        if (pc?.remoteDescription) void pc.addIceCandidate(init).catch(() => undefined);
        else early.push({ role: signal.role, init });
      } else if (signal.role === "sub" && signal.kind === "offer") {
        void answerOffer(signal.sdp ?? "");
      } else if (signal.role === "pub" && signal.kind === "answer" && pub) {
        const pc = pub;
        void pc
          .setRemoteDescription({ type: "answer", sdp: signal.sdp ?? "" })
          .then(() => {
            patience = ANSWER_WAIT_MS;
            return flush("pub", pc);
          })
          .catch(() => undefined)
          .finally(settled);
      }
    },
    publish(tracks) {
      wanted = tracks;
      sync();
    },
    restart() {
      close();
      remote = {};
      emit();
      sync();
    },
    dispose() {
      close();
      listeners.clear();
    },
  };
}
