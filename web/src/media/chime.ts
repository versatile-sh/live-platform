let context: AudioContext | undefined;

/** Plays a short two-note sound: rising when someone arrives, falling when someone leaves, the same note twice when someone asks to speak, one soft note when a message comes. Silent where the browser cannot or will not. */
export function chime(kind: "arrive" | "leave" | "ask" | "message"): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    const notes = kind === "arrive" ? [587, 880] : kind === "leave" ? [659, 440] : kind === "ask" ? [784, 784] : [988];
    notes.forEach((frequency, index) => {
      const tone = new OscillatorNode(context!, { type: "sine", frequency });
      const level = new GainNode(context!, { gain: 0 });
      const at = start + index * 0.11;
      level.gain.setValueAtTime(0, at);
      level.gain.linearRampToValueAtTime(0.07, at + 0.015);
      level.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      tone.connect(level).connect(context!.destination);
      tone.start(at);
      tone.stop(at + 0.24);
    });
  } catch {
    return;
  }
}
