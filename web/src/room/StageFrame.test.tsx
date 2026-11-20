import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { renderWithApp } from "../test-support/render";
import { StageFrame } from "./StageFrame";

function show(floating: boolean) {
  renderWithApp(
    <ul>
      <StageFrame mode="grid" name="Bia's screen" onFront={() => undefined} floating={floating}>
        <video />
      </StageFrame>
    </ul>,
  );
  return screen.queryByRole("button", { name: "Watch Bia's screen in a floating window" });
}

describe("StageFrame picture-in-picture", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("a screen floats in its own window and comes back on a second press, where the browser allows it", async () => {
    const request = vi.fn(async () => ({}) as PictureInPictureWindow);
    const exit = vi.fn(async () => undefined);
    let floating: Element | null = null;
    Object.defineProperty(HTMLVideoElement.prototype, "requestPictureInPicture", {
      configurable: true,
      value(this: HTMLVideoElement) {
        floating = this;
        return request();
      },
    });
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => floating });
    Object.defineProperty(document, "exitPictureInPicture", { configurable: true, value: exit });
    const button = show(true)!;
    await userEvent.click(button);
    expect(request).toHaveBeenCalledOnce();
    await userEvent.click(button);
    expect(exit).toHaveBeenCalledOnce();
  });

  test("offers nothing where the browser cannot, or for a frame that does not float", () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: false });
    expect(show(true)).toBeNull();
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    expect(show(false)).toBeNull();
  });
});
