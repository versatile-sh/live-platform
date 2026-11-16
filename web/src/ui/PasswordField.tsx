import { useState } from "react";

import { useT } from "../i18n/I18nProvider";
import { useServices } from "../services";
import { button } from "./styles";
import { TextField } from "./TextField";

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: React.ReactNode;
  error?: string;
  disabled?: boolean;
  generated?: boolean;
  onGenerate?: () => void;
};

/**
 * A password input. A generated password is shown in clear with copy and renew actions so it can be shared;
 * one the person must type is hidden until they ask to see it.
 */
export function PasswordField({ label, value, onChange, hint, error, disabled, generated, onGenerate }: PasswordFieldProps) {
  const t = useT();
  const { clipboard } = useServices();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await clipboard.write(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <>
      <TextField
        label={label}
        hint={hint}
        {...(error ? { error } : {})}
        value={value}
        disabled={disabled}
        type={generated || shown ? "text" : "password"}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        noteClassName="min-h-16"
        actions={
          disabled ? undefined : generated ? (
            <>
              {onGenerate ? (
                <button type="button" className={button({ variant: "secondary", size: "sm" })} onClick={onGenerate}>
                  {t("entry.passwordGenerate")}
                </button>
              ) : null}
              <button type="button" className={button({ variant: "secondary", size: "sm" })} onClick={() => void copy()}>
                {copied ? t("entry.copied") : t("entry.copy")}
              </button>
            </>
          ) : (
            <button type="button" aria-pressed={shown} className={button({ variant: "quiet", size: "sm" })} onClick={() => setShown(!shown)}>
              {shown ? t("entry.passwordHide") : t("entry.passwordShow")}
            </button>
          )
        }
      />
      <p role="status" className="sr-only">
        {copied ? t("entry.copied") : ""}
      </p>
    </>
  );
}
