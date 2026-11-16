import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

import type { CameraChange } from "./local-media";
import type { CameraEffect } from "./settings";

type Blur = Exclude<CameraEffect, "none">;
type FramedVideo = HTMLVideoElement & { requestVideoFrameCallback?(run: () => void): number };

const RUNTIME = "/assets/vision";
const MODEL = "/assets/models/selfie_segmenter.tflite";
const MASK_WIDTH = 256;
const RADIUS: Record<Blur, number> = { blur: 10, blurStrong: 24 };

async function loadSegmenter(): Promise<ImageSegmenter> {
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
  if (!context || !("filter" in context)) throw new Error("no canvas filters in this browser");
  return [canvas, context];
}

/**
 * Blurs what is behind the person on a camera, in this browser: a small model finds the person in each frame and the rest is drawn out of focus.
 * Which side of the model's answer is the person is settled by looking: a person stands in the middle and low, the background in the upper corners.
 */
export async function blurBackground(raw: MediaStream, first: Blur): Promise<CameraChange> {
  const segmenter = await loadSegmenter();
  const settings = raw.getVideoTracks()[0]?.getSettings() ?? {};
  const [out, paint] = sheet(settings.width ?? 1280, settings.height ?? 720);
  const [person, cut] = sheet(out.width, out.height);
  const [small, shrink] = sheet(MASK_WIDTH, Math.round((MASK_WIDTH * out.height) / out.width));
  const [maskSheet, maskPaint] = sheet(small.width, small.height);
  const video = document.createElement("video") as FramedVideo;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = raw;
  let effect = first;
  let live = true;
  let lean = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function mask(): boolean {
    shrink.drawImage(video, 0, 0, small.width, small.height);
    const result = segmenter.segmentForVideo(small, performance.now());
    const found = result.confidenceMasks?.[0];
    if (!found) {
      result.close();
      return false;
    }
    const values = found.getAsFloat32Array();
    const { width, height } = found;
    let middle = 0;
    let corners = 0;
    let middleCount = 0;
    let cornerCount = 0;
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const value = values[y * width + x] ?? 0;
        if (y > height * 0.55 && x > width * 0.35 && x < width * 0.65) {
          middle += value;
          middleCount++;
        } else if (y < height * 0.2 && (x < width * 0.15 || x > width * 0.85)) {
          corners += value;
          cornerCount++;
        }
      }
    }
    lean = Math.max(-30, Math.min(30, lean + (middle / Math.max(middleCount, 1) - corners / Math.max(cornerCount, 1))));
    const personIsHigh = lean >= 0;
    if (maskSheet.width !== width || maskSheet.height !== height) {
      maskSheet.width = width;
      maskSheet.height = height;
    }
    const pixels = maskPaint.createImageData(width, height);
    for (let at = 0; at < values.length; at++) {
      const value = values[at] ?? 0;
      pixels.data[at * 4 + 3] = (personIsHigh ? value : 1 - value) * 255;
    }
    maskPaint.putImageData(pixels, 0, 0);
    result.close();
    return true;
  }

  function draw() {
    if (!live) return;
    if (video.videoWidth > 0) {
      if (out.width !== video.videoWidth || out.height !== video.videoHeight) {
        out.width = person.width = video.videoWidth;
        out.height = person.height = video.videoHeight;
      }
      const radius = (RADIUS[effect] * out.height) / 720;
      let masked = false;
      try {
        masked = mask();
      } catch {
        masked = false;
      }
      if (masked) {
        paint.filter = `blur(${radius}px)`;
        paint.drawImage(video, -radius, -radius, out.width + radius * 2, out.height + radius * 2);
        paint.filter = "none";
        cut.globalCompositeOperation = "copy";
        cut.filter = `blur(${Math.max(2, out.height / 240)}px)`;
        cut.drawImage(maskSheet, 0, 0, out.width, out.height);
        cut.filter = "none";
        cut.globalCompositeOperation = "source-in";
        cut.drawImage(video, 0, 0, out.width, out.height);
        paint.drawImage(person, 0, 0);
      } else {
        paint.drawImage(video, 0, 0, out.width, out.height);
      }
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
    else timer = setTimeout(draw, 33);
  }

  await video.play().catch(() => undefined);
  draw();
  return {
    stream: out.captureStream(settings.frameRate ?? 30),
    set(next) {
      effect = next;
    },
    release() {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      video.pause();
      video.srcObject = null;
      segmenter.close();
    },
  };
}
