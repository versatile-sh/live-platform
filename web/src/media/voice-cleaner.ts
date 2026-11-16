import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";

import type { CleanedVoice } from "./local-media";

let binary: Promise<ArrayBuffer> | undefined;

/** Passes a microphone through RNNoise, a neural noise remover running in this browser, and gives back the cleaned voice with the way to let all of it go. */
export async function cleanVoice(raw: MediaStream): Promise<CleanedVoice> {
  const context = new AudioContext({ sampleRate: 48_000 });
  try {
    binary ??= loadRnnoise({ url: wasmUrl, simdUrl });
    const [wasmBinary] = await Promise.all([binary, context.audioWorklet.addModule(workletUrl)]);
    const source = context.createMediaStreamSource(raw);
    const node = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
    const out = context.createMediaStreamDestination();
    source.connect(node).connect(out);
    return {
      stream: out.stream,
      release() {
        node.destroy();
        source.disconnect();
        void context.close();
      },
    };
  } catch (error) {
    binary = undefined;
    void context.close();
    throw error;
  }
}
