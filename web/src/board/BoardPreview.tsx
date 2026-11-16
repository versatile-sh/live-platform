import { exportToCanvas, restoreElements } from "@excalidraw/excalidraw";
import { useEffect, useRef } from "react";

import type { BoardElement } from "./board-sync";

const SIDE = 480;

/** The whiteboard as a small picture, redrawn a moment after it changes, for when it is not the frame in front. */
export default function BoardPreview({ elements }: { elements: readonly BoardElement[] }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const shown = restoreElements(elements as never, null).filter((element) => !element.isDeleted);
      void exportToCanvas({ elements: shown, appState: { exportBackground: true, viewBackgroundColor: "#0e1116", exportWithDarkMode: true }, files: null, maxWidthOrHeight: SIDE, exportPadding: 24 }).then(
        (canvas: HTMLCanvasElement) => {
          if (!live || !holder.current) return;
          canvas.className = "size-full object-contain";
          holder.current.replaceChildren(canvas);
        },
        () => undefined,
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [elements]);
  return <div ref={holder} aria-hidden="true" className="absolute inset-0 -z-10" />;
}
