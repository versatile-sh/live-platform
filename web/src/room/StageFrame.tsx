import { useRef, type ComponentProps, type ReactNode } from "react";

import { useT } from "../i18n/I18nProvider";
import { canFloatPage } from "../media/floating-window";
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
  /** Floats the frame in its own window (picture-in-picture); the button shows only where the browser can. */
  onFloat?(video: HTMLVideoElement | null): void;
  children: ReactNode;
};

const SIZE: Record<StageMode, string> = {
  grid: "aspect-video",
  front: "size-full",
  strip: "aspect-video w-full shrink-0",
};

/** Sizes that follow the frame they sit in (its container), so controls and labels shrink with a small tile and never spill. */
export const SCALE = {
  edge: "[--edge:clamp(0.25rem,3cqmin,0.625rem)]",
  control: "size-[clamp(1.25rem,11cqmin,2rem)]",
  icon: "size-3/5",
  text: "text-[clamp(0.625rem,5.5cqmin,0.875rem)]",
  small: "text-[clamp(0.5625rem,4.5cqmin,0.75rem)]",
} as const;

const CONTROL = `grid ${SCALE.control} place-items-center rounded-full bg-canvas/75 text-fg transition-colors duration-200 hover:bg-fg hover:text-canvas`;

/** One frame of the stage, whatever it shows: it can be brought to the front or sent back, opened to the whole screen, and a screen can float in its own window. */
export function StageFrame({ mode, name, onFront, clickable = true, onFloat, className = "", children, ...rest }: StageFrameProps) {
  const t = useT();
  const frame = useRef<HTMLLIElement>(null);
  const canFloat = onFloat !== undefined && (canFloatPage() || document.pictureInPictureEnabled === true);

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void frame.current?.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <li
      ref={frame}
      data-mode={mode}
      className={`group/frame ${SCALE.edge} relative isolate [container-type:size] flex min-h-0 min-w-0 items-center justify-center overflow-hidden ${SIZE[mode]} ${clickable ? "cursor-pointer" : ""} ${className}`}
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
      <div className="absolute top-(--edge) left-(--edge) z-10 flex gap-1.5 opacity-0 transition-opacity duration-200 group-focus-within/frame:opacity-100 group-hover/frame:opacity-100">
        <button type="button" aria-pressed={mode === "front"} aria-label={t(mode === "front" ? "stage.back" : "stage.front", { name })} title={t(mode === "front" ? "stage.back" : "stage.front", { name })} className={CONTROL} onClick={onFront}>
          <Icon name={mode === "front" ? "grid" : "front"} className={SCALE.icon} />
        </button>
        <button type="button" aria-label={t("stage.fullscreen", { name })} title={t("stage.fullscreen", { name })} className={CONTROL} onClick={fullscreen}>
          <Icon name="expand" className={SCALE.icon} />
        </button>
        {canFloat ? (
          <button type="button" aria-label={t("stage.float", { name })} title={t("stage.float", { name })} className={CONTROL} onClick={() => onFloat?.(frame.current?.querySelector("video") ?? null)}>
            <Icon name="pip" className={SCALE.icon} />
          </button>
        ) : null}
      </div>
    </li>
  );
}
