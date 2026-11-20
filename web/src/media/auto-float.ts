import { useEffect, useEffectEvent } from "react";

const ACTION = "enterpictureinpicture" as MediaSessionAction;

/**
 * While a screen is shared, asks the browser to float the room when the tab is left, as video calls do: Chromium calls
 * the media session's enterpictureinpicture action by itself, while the page uses the microphone or camera.
 */
export function useAutoFloat(active: boolean, float: () => void) {
  const onLeave = useEffectEvent(float);
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
    if (!set(() => onLeave())) return;
    return () => void set(null);
  }, [active]);
}
