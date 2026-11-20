import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { screenToFloat, useAutoFloat } from "./auto-float";

function stage(html: string) {
  const root = document.createElement("ul");
  root.innerHTML = html;
  return root;
}

describe("screenToFloat", () => {
  test("picks the screen in front, else someone else's, else mine", () => {
    const front = stage('<li data-float="mine"><video id="m"></video></li><li data-float="other" data-mode="front"><video id="f"></video></li>');
    expect(screenToFloat(front)?.id).toBe("f");
    const other = stage('<li data-float="mine"><video id="m"></video></li><li data-float="other"><video id="o"></video></li>');
    expect(screenToFloat(other)?.id).toBe("o");
    expect(screenToFloat(stage('<li data-float="mine"><video id="m"></video></li>'))?.id).toBe("m");
    expect(screenToFloat(stage("<li><video></video></li>"))).toBeNull();
  });
});

describe("useAutoFloat", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("registers the browser's picture-in-picture action while a screen is shared, and removes it after", () => {
    const setActionHandler = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, mediaSession: { setActionHandler } });
    const { rerender, unmount } = renderHook(({ on }) => useAutoFloat(on), { initialProps: { on: false } });
    expect(setActionHandler).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(setActionHandler).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
    rerender({ on: false });
    expect(setActionHandler).toHaveBeenLastCalledWith("enterpictureinpicture", null);
    unmount();
  });

  test("a browser without the action changes nothing and throws nothing", () => {
    vi.stubGlobal("navigator", { ...navigator, mediaSession: { setActionHandler: () => { throw new TypeError("unsupported"); } } });
    expect(() => renderHook(() => useAutoFloat(true))).not.toThrow();
  });
});
