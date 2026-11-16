import { useRef, type ComponentProps, type ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import { Icon } from "../ui/icons";

/** Where a frame stands on the stage: among equals in the grid, alone in front, or small in the strip beside whoever is in front. */
export type StageMode = "grid" | "front" | "strip";

type StageFrameProps = Omit<ComponentProps<"li">, "children" | "onClick"> & {
  mode: StageMode;
  /** What the frame is called in its controls: a person's name, a screen, the whiteboard. */
  name: string;
  onFront(): void;
  /** Whether a click anywhere on the frame brings it to the front; off for a frame one works inside. */
  clickable?: boolean;
  children: ReactNode;
};

const SIZE: Record<StageMode, string> = {
  grid: "aspect-video",
  front: "size-full",
  strip: "aspect-video w-full shrink-0",
};

const CONTROL = "grid size-8 place-items-center rounded-full bg-canvas/75 text-fg transition-colors duration-200 hover:bg-fg hover:text-canvas";

/** One frame of the stage, whatever it shows: it can be brought to the front or sent back, and opened to the whole screen. */
export function StageFrame({ mode, name, onFront, clickable = true, className = "", children, ...rest }: StageFrameProps) {
  const t = useT();
  const frame = useRef<HTMLLIElement>(null);

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void frame.current?.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <li
      ref={frame}
      data-mode={mode}
      className={`group/frame relative isolate flex min-h-0 min-w-0 items-center justify-center overflow-hidden ${SIZE[mode]} ${clickable ? "cursor-pointer" : ""} ${className}`}
      onClick={
        clickable
          ? (event) => {
              if (!(event.target as Element).closest("button, a, input, textarea")) onFront();
            }
          : undefined
      }
      onDoubleClick={clickable ? fullscreen : undefined}
      {...rest}
    >
      {children}
      <div className="absolute top-2.5 left-2.5 z-10 flex gap-1.5 opacity-0 transition-opacity duration-200 group-focus-within/frame:opacity-100 group-hover/frame:opacity-100">
        <button type="button" aria-pressed={mode === "front"} aria-label={t(mode === "front" ? "stage.back" : "stage.front", { name })} title={t(mode === "front" ? "stage.back" : "stage.front", { name })} className={CONTROL} onClick={onFront}>
          <Icon name={mode === "front" ? "grid" : "front"} className="size-4" />
        </button>
        <button type="button" aria-label={t("stage.fullscreen", { name })} title={t("stage.fullscreen", { name })} className={CONTROL} onClick={fullscreen}>
          <Icon name="expand" className="size-4" />
        </button>
      </div>
    </li>
  );
}
