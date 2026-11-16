import type { RtcSignal } from "../signal/protocol";

/** What a participant can send: its microphone, its camera, its screen, and the sound of its screen. */
export type Source = "microphone" | "camera" | "screen" | "screenAudio";

const SOURCES: readonly Source[] = ["microphone", "camera", "screen", "screenAudio"];

/** What each participant is sending me, by participant id and source. */
export type Remote = Readonly<Record<number, Partial<Record<Source, MediaStream>>>>;

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
  const senders = new Map<Source, RTCRtpSender>();

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
      event.track.addEventListener("ended", () => {
        if (remote[pid]?.[source as Source] === stream) setRemote(pid, source as Source, undefined);
      });
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
      for (const [pidText, sources] of Object.entries(remote)) {
        for (const [source, stream] of Object.entries(sources)) {
          if (stream.getTracks().every((track) => track.readyState === "ended")) setRemote(Number(pidText), source as Source, undefined);
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
      const offer = await pub.createOffer();
      await pub.setLocalDescription(offer);
      const sources: Record<string, string> = {};
      for (const [source, sender] of senders) if (sender.track) sources[sender.track.id] = source;
      send({ role: "pub", kind: "offer", sdp: offer.sdp ?? "", sources });
    } catch {
      negotiating = false;
    }
  }

  function sync() {
    if (!rtc) return;
    const any = SOURCES.some((source) => wanted[source]);
    if (!pub && !any) return;
    if (!pub) {
      pub = rtc();
      wire(pub, "pub");
    }
    let changed = false;
    for (const source of SOURCES) {
      const track = wanted[source];
      const sender = senders.get(source);
      if (track && !sender) {
        senders.set(source, pub.addTrack(track, new MediaStream([track])));
        changed = true;
      } else if (!track && sender) {
        pub.removeTrack(sender);
        senders.delete(source);
        changed = true;
      } else if (track && sender && sender.track !== track) {
        void sender.replaceTrack(track);
        changed = true;
      }
    }
    if (changed) void negotiate();
  }

  function close() {
    sub?.close();
    pub?.close();
    sub = pub = undefined;
    senders.clear();
    negotiating = again = false;
    early = [];
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => remote,
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
          .then(() => flush("pub", pc))
          .catch(() => undefined)
          .finally(() => {
            negotiating = false;
            if (again) {
              again = false;
              void negotiate();
            }
          });
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
