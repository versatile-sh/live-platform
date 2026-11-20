import { useEffect } from "react";

const ACTION = "enterpictureinpicture" as MediaSessionAction;

/** The screen worth floating when the tab is left: the one in front, else someone else's, else mine. */
export function screenToFloat(root: ParentNode = document): HTMLVideoElement | null {
  return (
    root.querySelector<HTMLVideoElement>('[data-float][data-mode="front"] video') ??
    root.querySelector<HTMLVideoElement>('[data-float="other"] video') ??
    root.querySelector<HTMLVideoElement>("[data-float] video")
  );
}

/**
 * While a screen is shared, asks the browser to float it when the tab is left, as video calls do: Chromium opens
 * picture-in-picture by itself through the media session's enterpictureinpicture action, while the page uses the microphone or camera.
 */
export function useAutoFloat(active: boolean) {
  useEffect(() => {
    const session = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!active || !session) return;
    const set = (handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(ACTION, handler);
        return true;
      } catch {
        return false;
      }
    };
    if (!set(() => void screenToFloat()?.requestPictureInPicture().catch(() => undefined))) return;
    return () => void set(null);
  }, [active]);
}
