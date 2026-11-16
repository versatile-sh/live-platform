import type { Person } from "../signal/protocol";
import { useT } from "../i18n/I18nProvider";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/icons";
import { describePerson } from "./person";
import { button } from "../ui/styles";
import { hasFlag } from "../domain/flags";

type PeoplePanelProps = { people: readonly Person[]; me: number | undefined; canModerate: boolean; quiet: boolean; onRemove(pid: number): void; onBan(pid: number): void; onQuiet(op: "mute-all" | "unmute-all"): void; onVoice(pid: number, op: "mute" | "allow"): void; onTransfer(pid: number): void; photos: Readonly<Record<number, string>>; onEditLook(): void };

const XS = button({ variant: "secondary", size: "xs" });

/** Everyone in the room as a list: who they are, what they are doing, and, for the owner, what can be done about them. */
export function PeoplePanel({ people, me, canModerate, quiet, onRemove, onBan, onQuiet, onVoice, onTransfer, photos, onEditLook }: PeoplePanelProps) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {canModerate ? (
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 pt-3">
          <p className="min-w-0 text-[0.8125rem] leading-snug text-muted">{t(quiet ? "quiet.on" : "quiet.off")}</p>
          <button type="button" className={button({ variant: quiet ? "accent" : "secondary", size: "sm" })} onClick={() => onQuiet(quiet ? "unmute-all" : "mute-all")}>
            {t(quiet ? "quiet.unmuteAll" : "quiet.muteAll")}
          </button>
        </div>
      ) : null}
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {people.map((person) => {
        const view = describePerson(person);
        const mine = person.pid === me;
        const muted = hasFlag(person.flags, "muted");
        const asking = muted && view.flags.includes("hand");
        return (
          <li key={person.pid} className={`arrive bubble flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border bg-canvas px-3 py-2 ${asking ? "border-bubble" : "border-line-strong"}`}>
            <Avatar look={person.look} face={person.face} name={person.name} photo={photos[person.pid]} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold" translate="no">
                {person.name}
                {mine ? <span className="font-normal text-muted"> ({t("room.you")})</span> : null}
              </span>
              <span className={`truncate font-mono text-xs ${view.trouble ? "text-fg" : "text-accent"}`}>{[view.isOwner ? t("room.owner") : undefined, asking ? t("quiet.asking") : muted ? t("quiet.muted") : undefined, view.trouble || view.tone === "dashed" ? t(view.stateKey) : undefined].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-muted">
              {view.flags.includes("hand") ? <Icon name="hand" className="size-4 text-accent" /> : null}
              <Icon name={view.flags.includes("microphone") ? "mic" : "micOff"} className="size-4" />
              {mine ? (
                <button type="button" className={`ml-1 ${XS}`} onClick={onEditLook}>
                  {t("look.edit")}
                </button>
              ) : null}
            </span>
            {canModerate && !mine ? (
              <span className="flex w-full flex-wrap justify-end gap-1.5">
                <button type="button" className={button({ variant: asking ? "accent" : "secondary", size: "xs" })} onClick={() => onVoice(person.pid, muted ? "allow" : "mute")} aria-label={t(muted ? "quiet.allow" : "quiet.mute", { name: person.name })}>
                  {t(muted ? "quiet.allowShort" : "quiet.muteShort")}
                </button>
                <button type="button" className={XS} onClick={() => onTransfer(person.pid)} aria-label={t("owner.transfer", { name: person.name })}>
                  {t("owner.transferShort")}
                </button>
                <button type="button" className={XS} onClick={() => onRemove(person.pid)} aria-label={t("owner.remove", { name: person.name })}>
                  {t("owner.removeShort")}
                </button>
                <button type="button" className={XS} onClick={() => onBan(person.pid)} aria-label={t("owner.ban", { name: person.name })}>
                  {t("owner.banShort")}
                </button>
              </span>
            ) : null}
          </li>
        );
      })}
      </ul>
    </div>
  );
}
