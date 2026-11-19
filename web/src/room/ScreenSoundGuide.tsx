import { useId, useState } from "react";

import { useT } from "../i18n/I18nProvider";
import { HELPER_OFF, helperCommand, type SoundRoute } from "../media/desktop-sound";
import { Icon } from "../ui/icons";
import { ICON_BUTTON, button } from "../ui/styles";
import { useCopy } from "../ui/useCopy";

/** A command shown whole, in a box that selects at a click, with a button that copies it and says so. */
function CopyLine({ text }: { text: string }) {
  const t = useT();
  const { result, copy } = useCopy();
  return (
    <span className="bubble flex items-start gap-2 border border-line-strong bg-canvas p-2 pl-3">
      <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all select-all" translate="no">
        {text}
      </code>
      <button type="button" className={`${button({ variant: "accent", size: "xs" })} shrink-0`} onClick={() => void copy(text)}>
        {t(result === "copied" ? "pcSound.copied" : "pcSound.copy")}
      </button>
    </span>
  );
}

const STEPS: Record<SoundRoute, readonly ("pcSound.step.linuxPaste" | "pcSound.step.linuxRetry" | "pcSound.step.stop" | "pcSound.step.entire" | "pcSound.step.tick" | "pcSound.step.mac" | "pcSound.step.browser")[]> = {
  linux: ["pcSound.step.linuxPaste", "pcSound.step.linuxRetry"],
  picker: ["pcSound.step.stop", "pcSound.step.entire", "pcSound.step.tick"],
  mac: ["pcSound.step.mac", "pcSound.step.stop", "pcSound.step.entire", "pcSound.step.tick"],
  none: ["pcSound.step.browser"],
};

type GuideProps = { route: SoundRoute; origin: string; onRetry(): Promise<boolean>; onShareAgain(): void; onClose(): void };

/**
 * Shown while I asked for the whole computer's sound and my screen goes without it: the steps for my system, with the
 * Linux command ready to copy. It folds down to its title, and closing it asks first, since the screen stays silent.
 */
export function ScreenSoundGuide({ route, origin, onRetry, onShareAgain, onClose }: GuideProps) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(true);
  const [closing, setClosing] = useState(false);
  const [missing, setMissing] = useState(false);
  return (
    <li aria-labelledby={`${id}-title`} className="swap-in bubble pointer-events-auto flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col gap-3 border border-bubble bg-card px-4 py-3 text-sm">
      <span className="flex items-center gap-2">
        <Icon name="screen" className="size-4 shrink-0 text-accent" />
        <strong id={`${id}-title`} className="min-w-0 flex-1 font-semibold">
          {t("pcSound.title")}
        </strong>
        <button type="button" aria-expanded={open} aria-controls={id} aria-label={t(open ? "pcSound.fold" : "pcSound.unfold")} title={t(open ? "pcSound.fold" : "pcSound.unfold")} className={`${ICON_BUTTON} size-8`} onClick={() => setOpen(!open)}>
          <Icon name="back" className={`size-4 transition-transform duration-300 ${open ? "rotate-90" : "-rotate-90"}`} />
        </button>
        <button type="button" aria-label={t("pcSound.close")} title={t("pcSound.close")} className={`${ICON_BUTTON} size-8`} onClick={() => setClosing(true)}>
          <Icon name="close" className="size-4" />
        </button>
      </span>
      {closing ? (
        <span role="alertdialog" aria-label={t("pcSound.sure")} className="flex flex-col gap-2.5">
          <span>{t("pcSound.sure")}</span>
          <span className="flex gap-2">
            <button type="button" className={button({ variant: "accent", size: "xs" })} onClick={onClose}>
              {t("pcSound.closeYes")}
            </button>
            <button type="button" className={button({ variant: "secondary", size: "xs" })} onClick={() => setClosing(false)}>
              {t("pcSound.closeNo")}
            </button>
          </span>
        </span>
      ) : null}
      <div id={id} hidden={!open} className="flex flex-col gap-3">
        <p className="text-muted">{t(`pcSound.why.${route}`)}</p>
        <ol className="flex list-decimal flex-col gap-2.5 pl-5">
          {STEPS[route].map((step) => (
            <li key={step} className="flex flex-col gap-2">
              <span>{t(step)}</span>
              {step === "pcSound.step.linuxPaste" ? <CopyLine text={helperCommand(origin)} /> : null}
            </li>
          ))}
        </ol>
        {missing ? (
          <p role="alert" className="text-muted">
            {t("pcSound.missing")}
          </p>
        ) : null}
        {route === "linux" ? (
          <>
            <button type="button" className={`${button({ variant: "accent", size: "xs" })} self-start`} onClick={() => void onRetry().then((found) => setMissing(!found))}>
              {t("pcSound.retry")}
            </button>
            <span className="flex flex-col gap-2 text-muted">
              {t("pcSound.after")}
              <CopyLine text={HELPER_OFF} />
            </span>
          </>
        ) : route === "none" ? null : (
          <button type="button" className={`${button({ variant: "accent", size: "xs" })} self-start`} onClick={onShareAgain}>
            {t("pcSound.shareAgain")}
          </button>
        )}
      </div>
    </li>
  );
}
