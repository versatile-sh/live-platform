import type { CameraChange } from "./local-media";
import type { CameraEffect } from "./settings";
import type { PersonFinder } from "./camera-segmenter";

type FramedVideo = HTMLVideoElement & { requestVideoFrameCallback?(run: () => void): number };

const RADIUS: Record<Exclude<CameraEffect, "none">, number> = { blur: 10, blurStrong: 24 };

function sheet(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || !("filter" in context)) throw new Error("no canvas filters in this browser");
  return [canvas, context];
}

/**
 * Draws a camera onto one picture that never changes hands, so the background can be put out of focus, changed and put back without the picture being replaced.
 * The model that finds the person loads the first time a blur is asked for; until it is ready, and whenever no blur is chosen, the camera is drawn as it is.
 */
export async function stageCamera(raw: MediaStream, first: CameraEffect, findPerson: () => Promise<PersonFinder>): Promise<CameraChange> {
  const settings = raw.getVideoTracks()[0]?.getSettings() ?? {};
  const [out, paint] = sheet(settings.width ?? 1280, settings.height ?? 720);
  const [person, cut] = sheet(out.width, out.height);
  const video = document.createElement("video") as FramedVideo;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = raw;
  let effect = first;
  let live = true;
  let finder: PersonFinder | undefined;
  let loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function want() {
    if (effect === "none" || finder || loading) return;
    loading = true;
    findPerson().then(
      (found) => {
        if (live) finder = found;
        else found.close();
      },
      () => undefined,
    );
  }

  function draw() {
    if (!live) return;
    if (video.videoWidth > 0) {
      if (out.width !== video.videoWidth || out.height !== video.videoHeight) {
        out.width = person.width = video.videoWidth;
        out.height = person.height = video.videoHeight;
      }
      let mask: HTMLCanvasElement | undefined;
      if (effect !== "none" && finder) {
        try {
          mask = finder.find(video);
        } catch {
          mask = undefined;
        }
      }
      if (mask && effect !== "none") {
        const radius = (RADIUS[effect] * out.height) / 720;
        paint.filter = `blur(${radius}px)`;
        paint.drawImage(video, -radius, -radius, out.width + radius * 2, out.height + radius * 2);
        paint.filter = "none";
        cut.globalCompositeOperation = "copy";
        cut.filter = `blur(${Math.max(2, out.height / 240)}px)`;
        cut.drawImage(mask, 0, 0, out.width, out.height);
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
  want();
  draw();
  return {
    stream: out.captureStream(settings.frameRate ?? 30),
    set(next) {
      effect = next;
      want();
    },
    release() {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      video.pause();
      video.srcObject = null;
      finder?.close();
    },
  };
}
