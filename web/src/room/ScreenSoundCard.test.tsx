import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { fakeServices, renderWithApp } from "../test-support/render";
import { ScreenSoundCard } from "./ScreenSoundCard";

const ORIGIN = "https://live.versatile.sh";

describe("ScreenSoundCard", () => {
  describe("on Linux", () => {
    test("copies the one line that installs the helper from this site and turns it on", async () => {
      const services = fakeServices();
      renderWithApp(<ScreenSoundCard route="helper" origin={ORIGIN} onRetry={async () => true} onClose={() => undefined} />, { services });
      await userEvent.click(screen.getByRole("button", { name: "Copy command" }));
      expect(services.copied.at(-1)).toBe(
        "mkdir -p ~/.local/bin && curl -fsSL https://live.versatile.sh/assets/screen-audio.sh -o ~/.local/bin/screen-audio && chmod +x ~/.local/bin/screen-audio && ~/.local/bin/screen-audio on",
      );
    });

    test("says the sound is still missing when a retry finds nothing", async () => {
      const onRetry = vi.fn(async () => false);
      renderWithApp(<ScreenSoundCard route="helper" origin={ORIGIN} onRetry={onRetry} onClose={() => undefined} />);
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledOnce();
      expect(await screen.findByRole("alert")).toHaveTextContent("I still cannot find the computer's sound");
    });
  });

  describe("in Chrome or Edge elsewhere", () => {
    test("points at the picker's tick box and shows no command", () => {
      renderWithApp(<ScreenSoundCard route="picker" origin={ORIGIN} onRetry={async () => true} onClose={() => undefined} />, { locale: "pt-BR" });
      expect(screen.getByText(/marque Compartilhar áudio do sistema/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copiar comando" })).toBeNull();
    });
  });

  test("Not now closes it", async () => {
    const onClose = vi.fn();
    renderWithApp(<ScreenSoundCard route="none" origin={ORIGIN} onRetry={async () => true} onClose={onClose} />);
    expect(screen.getByText(/Use Chrome or Edge/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
