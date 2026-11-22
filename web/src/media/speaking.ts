/** Who is speaking right now, heard from each person's microphone as it arrives in this browser. */
export type Speaking = {
  subscribe(listener: () => void): () => void;
  /** The ids of those speaking; the same set until it changes. */
  getSnapshot(): ReadonlySet<number>;
  /** Listens to exactly these microphones, by participant id; one left out is no longer listened to. */
  watch(streams: ReadonlyMap<number, MediaStream>): void;
  dispose(): void;
};

const EVERY_MS = 100;
const HOLD_MS = 450;
const LOUD = 0.018;

type Ear = { stream: MediaStream; tracks: MediaStreamTrack[]; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; until: number };

/** Measures the loudness of each microphone ten times a second and calls a person speaking from the first loud moment until a little after the last. Silent where the browser has no audio graph. */
export function createSpeaking(): Speaking {
  const listeners = new Set<() => void>();
  const ears = new Map<number, Ear>();
  let snapshot: ReadonlySet<number> = new Set();
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function measure() {
    const now = Date.now();
    let loud = 0;
    let same = true;
    for (const [pid, ear] of ears) {
      const live = ear.tracks.some((track) => track.enabled && track.readyState === "live");
      if (live) {
        ear.analyser.getFloatTimeDomainData(ear.samples);
        let sum = 0;
        for (let i = 0; i < ear.samples.length; i++) sum += ear.samples[i]! * ear.samples[i]!;
        if (Math.sqrt(sum / ear.samples.length) > LOUD) ear.until = now + HOLD_MS;
      } else {
        ear.until = 0;
      }
      if (ear.until > now) {
        loud++;
        if (!snapshot.has(pid)) same = false;
      }
    }
    if (same && loud === snapshot.size) return;
    const next = new Set<number>();
    for (const [pid, ear] of ears) if (ear.until > now) next.add(pid);
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function drop(pid: number) {
    const ear = ears.get(pid);
    if (!ear) return;
    ear.source.disconnect();
    ears.delete(pid);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    watch(streams) {
      if (typeof AudioContext === "undefined") return;
      for (const pid of [...ears.keys()]) if (ears.get(pid)?.stream !== streams.get(pid)) drop(pid);
      for (const [pid, stream] of streams) {
        if (ears.has(pid) || stream.getAudioTracks().length === 0) continue;
        try {
          context ??= new AudioContext();
          if (context.state === "suspended") void context.resume();
          const source = context.createMediaStreamSource(stream);
          const analyser = new AnalyserNode(context, { fftSize: 512 });
          source.connect(analyser);
          ears.set(pid, { stream, tracks: stream.getAudioTracks(), source, analyser, samples: new Float32Array(analyser.fftSize), until: 0 });
        } catch {
          continue;
        }
      }
      if (ears.size > 0 && timer === undefined) timer = setInterval(measure, EVERY_MS);
      if (ears.size === 0 && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
        measure();
      }
    },
    dispose() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      for (const pid of [...ears.keys()]) drop(pid);
      void context?.close();
      context = undefined;
    },
  };
}
