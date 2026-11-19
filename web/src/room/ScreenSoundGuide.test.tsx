import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { fakeServices, renderWithApp } from "../test-support/render";
import { ScreenSoundGuide } from "./ScreenSoundGuide";

const ORIGIN = "https://live.versatile.sh";

function show(route: "linux" | "picker" | "mac" | "none", over: { onRetry?: () => Promise<boolean>; onShareAgain?: () => void; onClose?: () => void } = {}, locale: "en" | "pt-BR" = "en") {
  const services = fakeServices();
  const props = { onRetry: async () => true, onShareAgain: () => undefined, onClose: () => undefined, ...over };
  renderWithApp(<ScreenSoundGuide route={route} origin={ORIGIN} {...props} />, { services, locale });
  return services;
}

describe("ScreenSoundGuide", () => {
  describe("on Linux", () => {
    test("copies the one line that installs the helper from this site and turns it on", async () => {
      const services = show("linux");
      await userEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]!);
      expect(services.copied.at(-1)).toBe(
        "mkdir -p ~/.local/bin && curl -fsSL https://live.versatile.sh/assets/screen-audio.sh -o ~/.local/bin/screen-audio && chmod +x ~/.local/bin/screen-audio && ~/.local/bin/screen-audio on",
      );
    });

    test("copies the line that gives the sound back after the call", async () => {
      const services = show("linux");
      await userEvent.click(screen.getAllByRole("button", { name: "Copy" })[1]!);
      expect(services.copied.at(-1)).toBe("~/.local/bin/screen-audio off");
    });

    test("says the sound is still missing when a retry finds nothing", async () => {
      const onRetry = vi.fn(async () => false);
      show("linux", { onRetry });
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledOnce();
      expect(await screen.findByRole("alert")).toHaveTextContent("I still cannot find the computer's sound");
    });
  });

  describe("in Chrome or Edge on Windows", () => {
    test("walks through the picker's tick box, with no command, and shares again from the guide", async () => {
      const onShareAgain = vi.fn();
      show("picker", { onShareAgain }, "pt-BR");
      expect(screen.getByText(/Marque Compartilhar áudio do sistema/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copiar" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Compartilhar de novo" }));
      expect(onShareAgain).toHaveBeenCalledOnce();
    });
  });

  test("folds down to its title and opens again", async () => {
    show("mac");
    const fold = screen.getByRole("button", { name: "Fold the guide" });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(fold);
    expect(screen.getByText(/macOS is 14.2 or later/)).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Show the guide" }));
    expect(screen.getByText(/macOS is 14.2 or later/)).toBeVisible();
  });

  test("closing asks first, and keeping it changes nothing", async () => {
    const onClose = vi.fn();
    show("none", { onClose });
    await userEvent.click(screen.getByRole("button", { name: "Close the guide" }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close the guide" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
