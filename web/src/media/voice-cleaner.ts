import { NoiseGateWorkletNode, RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import gateWorkletUrl from "@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";

import type { CleanedVoice, VoiceChain } from "./local-media";

const RNNOISE_WORKLET_DELAY_SAMPLES = 640;

let binary: Promise<ArrayBuffer> | undefined;

/** Passes a microphone through the chain asked for, all in this browser: RNNoise (a neural noise remover) mixed with the original by its strength, then a rumble cut and a compressor, then a gate that closes between phrases. */
export async function cleanVoice(raw: MediaStream, chain: VoiceChain): Promise<CleanedVoice> {
  const context = new AudioContext({ sampleRate: 48_000 });
  const made: { disconnect(): void }[] = [];
  const dispose: (() => void)[] = [];
  try {
    const source = context.createMediaStreamSource(raw);
    made.push(source);
    let head: AudioNode = source;
    if (chain.denoise) {
      binary ??= loadRnnoise({ url: wasmUrl, simdUrl });
      const [wasmBinary] = await Promise.all([binary, context.audioWorklet.addModule(workletUrl)]);
      const denoiser = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
      dispose.push(() => denoiser.destroy());
      const wet = new GainNode(context, { gain: chain.strength / 100 });
      const dry = new GainNode(context, { gain: 1 - chain.strength / 100 });
      const align = new DelayNode(context, { delayTime: RNNOISE_WORKLET_DELAY_SAMPLES / context.sampleRate });
      const mix = new GainNode(context);
      source.connect(denoiser).connect(wet).connect(mix);
      source.connect(align).connect(dry).connect(mix);
      made.push(denoiser, wet, align, dry, mix);
      head = mix;
    }
    if (chain.balanced) {
      const cut = new BiquadFilterNode(context, { type: "highpass", frequency: 90, Q: 0.7 });
      const level = new DynamicsCompressorNode(context, { threshold: -24, knee: 20, ratio: 3, attack: 0.005, release: 0.2 });
      head.connect(cut).connect(level);
      made.push(cut, level);
      head = level;
    }
    if (chain.gate) {
      await context.audioWorklet.addModule(gateWorkletUrl);
      const gate = new NoiseGateWorkletNode(context, { openThreshold: chain.gateDb, closeThreshold: chain.gateDb - 6, holdMs: 250, maxChannels: 1 });
      head.connect(gate);
      made.push(gate);
      head = gate;
    }
    const out = context.createMediaStreamDestination();
    head.connect(out);
    return {
      stream: out.stream,
      release() {
        dispose.forEach((run) => run());
        made.forEach((node) => node.disconnect());
        void context.close();
      },
    };
  } catch (error) {
    binary = undefined;
    dispose.forEach((run) => run());
    void context.close();
    throw error;
  }
}
