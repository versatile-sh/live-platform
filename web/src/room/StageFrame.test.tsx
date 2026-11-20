import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { renderWithApp } from "../test-support/render";
import { StageFrame } from "./StageFrame";

function show(onFloat?: (video: HTMLVideoElement | null) => void) {
  renderWithApp(
    <ul>
      <StageFrame mode="grid" name="Bia's screen" onFront={() => undefined} onFloat={onFloat}>
        <video />
      </StageFrame>
    </ul>,
  );
  return screen.queryByRole("button", { name: "Watch Bia's screen in a floating window" });
}

describe("StageFrame picture-in-picture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: false });
  });

  test("the float button hands over the frame's video, where the browser can float a page", async () => {
    vi.stubGlobal("documentPictureInPicture", { requestWindow: vi.fn() });
    const onFloat = vi.fn();
    await userEvent.click(show(onFloat)!);
    expect(onFloat).toHaveBeenCalledWith(expect.any(HTMLVideoElement));
  });

  test("also where the browser can float only a video", () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    expect(show(vi.fn())).not.toBeNull();
  });

  test("offers nothing where the browser cannot, or for a frame that does not float", () => {
    expect(show(vi.fn())).toBeNull();
    vi.stubGlobal("documentPictureInPicture", { requestWindow: vi.fn() });
    expect(show()).toBeNull();
  });
});
