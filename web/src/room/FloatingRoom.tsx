import { useT } from "../i18n/I18nProvider";
import { Icon, type IconName } from "../ui/icons";
import { DOCK, FOCUS_RING, button } from "../ui/styles";

type Toggle = { on: boolean; busy: boolean; toggle(): void };

type FloatingRoomProps = {
  /** The shared screen shown, with its label; none when nobody shares one anymore. */
  screen: { stream: MediaStream; name: string } | undefined;
  microphone: Toggle;
  camera: Toggle;
  onBack(): void;
  onLeave(): void;
};

const show = (stream: MediaStream) => (element: HTMLVideoElement | null) => {
  if (element && element.srcObject !== stream) element.srcObject = stream;
};

/** The room in the floating window, as Meet does: the shared screen, and the microphone, camera, back-to-tab and leave buttons. */
export function FloatingRoom({ screen, microphone, camera, onBack, onLeave }: FloatingRoomProps) {
  const t = useT();
  const toggle = (state: Toggle, on: IconName, off: IconName, labels: [string, string]) => (
    <button type="button" aria-pressed={state.on} aria-label={labels[state.on ? 1 : 0]} title={labels[state.on ? 1 : 0]} disabled={state.busy} className={`${DOCK.round} size-10 ${state.on ? DOCK.on : DOCK.off} ${FOCUS_RING}`} onClick={state.toggle}>
      <Icon name={state.on ? on : off} />
    </button>
  );
  return (
    <main className="flex h-dvh flex-col gap-2 bg-canvas p-2 text-fg">
      <div className="bubble relative min-h-0 flex-1 overflow-hidden border border-bubble bg-sunken">
        {screen ? (
          <>
            <video ref={show(screen.stream)} autoPlay muted playsInline className="absolute inset-0 size-full object-contain" />
            <span className="bubble-word absolute bottom-2 left-2 bg-canvas/70 px-2.5 py-1 text-xs font-semibold" translate="no">
              {screen.name}
            </span>
          </>
        ) : (
          <p className="grid size-full place-items-center p-4 text-center text-sm text-muted">{t("float.noScreen")}</p>
        )}
      </div>
      <nav aria-label={t("float.controls")} className="flex shrink-0 items-center justify-center gap-2">
        {toggle(microphone, "mic", "micOff", [t("dock.micOn"), t("dock.micOff")])}
        {toggle(camera, "camera", "cameraOff", [t("dock.cameraOn"), t("dock.cameraOff")])}
        <button type="button" aria-label={t("float.back")} title={t("float.back")} className={`${DOCK.round} size-10 ${DOCK.off} ${FOCUS_RING}`} onClick={onBack}>
          <Icon name="pip" />
        </button>
        <button type="button" aria-label={t("room.leave")} title={t("room.leave")} className={`${button({ size: "md" })} px-3`} onClick={onLeave}>
          <Icon name="leave" />
        </button>
      </nav>
    </main>
  );
}
