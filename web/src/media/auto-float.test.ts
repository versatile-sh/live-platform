import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useAutoFloat } from "./auto-float";

describe("useAutoFloat", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("registers the browser's picture-in-picture action while a screen is shared, calls the latest float, and removes it after", () => {
    const setActionHandler = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, mediaSession: { setActionHandler } });
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(({ on, float }) => useAutoFloat(on, float), { initialProps: { on: false, float: first } });
    expect(setActionHandler).not.toHaveBeenCalled();
    rerender({ on: true, float: first });
    expect(setActionHandler).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
    rerender({ on: true, float: latest });
    setActionHandler.mock.calls[0]![1]();
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    rerender({ on: false, float: latest });
    expect(setActionHandler).toHaveBeenLastCalledWith("enterpictureinpicture", null);
  });

  test("a browser without the action changes nothing and throws nothing", () => {
    vi.stubGlobal("navigator", { ...navigator, mediaSession: { setActionHandler: () => { throw new TypeError("unsupported"); } } });
    expect(() => renderHook(() => useAutoFloat(true, () => undefined))).not.toThrow();
  });
});
