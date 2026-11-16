import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const RUNTIME = "/assets/vision";
const MODEL = "/assets/models/selfie_segmenter.tflite";
const MASK_WIDTH = 256;

/** Finds the person in a frame: gives back a small picture that is opaque where the person is, or nothing when the model has no answer. */
export type PersonFinder = { find(video: HTMLVideoElement): HTMLCanvasElement | undefined; close(): void };

async function load(): Promise<ImageSegmenter> {
  const files = await FilesetResolver.forVisionTasks(RUNTIME);
  const options = (delegate: "GPU" | "CPU") => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO" as const, outputConfidenceMasks: true, outputCategoryMask: false });
  try {
    return await ImageSegmenter.createFromOptions(files, options("GPU"));
  } catch {
    return ImageSegmenter.createFromOptions(files, options("CPU"));
  }
}

function sheet(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas in this browser");
  return [canvas, context];
}

/**
 * Loads the model that tells a person from what is behind them. Which side of its answer is the person is settled by looking:
 * a person stands in the middle and low, the background in the upper corners.
 */
export async function createPersonFinder(): Promise<PersonFinder> {
  const segmenter = await load();
  const [small, shrink] = sheet(MASK_WIDTH, 144);
  const [mask, paint] = sheet(MASK_WIDTH, 144);
  let lean = 0;
  return {
    find(video) {
      const height = Math.max(1, Math.round((MASK_WIDTH * video.videoHeight) / Math.max(video.videoWidth, 1)));
      if (small.height !== height) small.height = height;
      shrink.drawImage(video, 0, 0, small.width, small.height);
      const result = segmenter.segmentForVideo(small, performance.now());
      const found = result.confidenceMasks?.[0];
      if (!found) {
        result.close();
        return undefined;
      }
      const values = found.getAsFloat32Array();
      const { width, height: tall } = found;
      let middle = 0;
      let corners = 0;
      let middleCount = 0;
      let cornerCount = 0;
      for (let y = 0; y < tall; y += 4) {
        for (let x = 0; x < width; x += 4) {
          const value = values[y * width + x] ?? 0;
          if (y > tall * 0.55 && x > width * 0.35 && x < width * 0.65) {
            middle += value;
            middleCount++;
          } else if (y < tall * 0.2 && (x < width * 0.15 || x > width * 0.85)) {
            corners += value;
            cornerCount++;
          }
        }
      }
      lean = Math.max(-30, Math.min(30, lean + (middle / Math.max(middleCount, 1) - corners / Math.max(cornerCount, 1))));
      const personIsHigh = lean >= 0;
      if (mask.width !== width || mask.height !== tall) {
        mask.width = width;
        mask.height = tall;
      }
      const pixels = paint.createImageData(width, tall);
      for (let at = 0; at < values.length; at++) {
        const value = values[at] ?? 0;
        pixels.data[at * 4 + 3] = (personIsHigh ? value : 1 - value) * 255;
      }
      paint.putImageData(pixels, 0, 0);
      result.close();
      return mask;
    },
    close: () => segmenter.close(),
  };
}
