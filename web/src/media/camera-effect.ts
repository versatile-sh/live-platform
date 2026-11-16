import type { CameraEffect } from "./settings";

const FILTER: Record<Exclude<CameraEffect, "none">, string> = {
  soft: "blur(1.5px) brightness(1.06) saturate(1.05)",
  warm: "sepia(0.3) saturate(1.25) brightness(1.03)",
  cool: "hue-rotate(-12deg) saturate(0.9) brightness(1.04) contrast(1.05)",
  vivid: "contrast(1.15) saturate(1.45)",
  mono: "grayscale(1) contrast(1.1)",
  noir: "grayscale(1) contrast(1.45) brightness(0.92)",
};

type FramedVideo = HTMLVideoElement & { requestVideoFrameCallback?(run: () => void): number };

/** Redraws a camera through a colour effect, frame by frame, and gives back the changed picture with the way to stop. The picture is drawn while this tab is in view; a hidden tab slows it down. */
export function applyCameraEffect(raw: MediaStream, effect: Exclude<CameraEffect, "none">): { stream: MediaStream; release(): void } {
  const settings = raw.getVideoTracks()[0]?.getSettings() ?? {};
  const canvas = document.createElement("canvas");
  canvas.width = settings.width ?? 1280;
  canvas.height = settings.height ?? 720;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !("filter" in context)) throw new Error("no canvas filters in this browser");
  const video = document.createElement("video") as FramedVideo;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = raw;
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const draw = () => {
    if (!live) return;
    if (video.videoWidth > 0 && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    context.filter = FILTER[effect];
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
    else timer = setTimeout(draw, 33);
  };
  void video.play().then(draw, draw);
  return {
    stream: canvas.captureStream(settings.frameRate ?? 30),
    release() {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      video.pause();
      video.srcObject = null;
    },
  };
}
