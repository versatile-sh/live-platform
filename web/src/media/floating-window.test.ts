import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { canFloatPage, dressLike, useFloatingWindow } from "./floating-window";

describe("dressLike", () => {
  test("copies the html attributes, the body classes and the styles", () => {
    document.documentElement.setAttribute("lang", "pt-BR");
    document.body.className = "bg-canvas";
    const style = document.createElement("style");
    style.textContent = ".x { color: red; }";
    document.head.append(style);
    const target = document.implementation.createHTMLDocument("");
    dressLike(target);
    expect(target.documentElement.getAttribute("lang")).toBe("pt-BR");
    expect(target.body.className).toBe("bg-canvas");
    expect(target.head.textContent).toContain(".x");
    style.remove();
  });

  test("links a stylesheet file instead of copying it, which the site's CSP would refuse", () => {
    const target = document.implementation.createHTMLDocument("");
    const sheet = { href: "https://live.versatile.sh/assets/index.css", get cssRules(): CSSRuleList { throw new Error("must not be read"); } };
    dressLike(target, { documentElement: document.documentElement, body: document.body, styleSheets: [sheet] as unknown as StyleSheetList });
    const link = target.head.querySelector("link");
    expect(link?.rel).toBe("stylesheet");
    expect(link?.href).toBe("https://live.versatile.sh/assets/index.css");
    expect(target.head.querySelector("style")).toBeNull();
  });
});

describe("useFloatingWindow", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("opens a floating window where the browser can, and forgets it when it closes", async () => {
    const win = { document: document.implementation.createHTMLDocument(""), close: vi.fn(), listeners: {} as Record<string, () => void>, addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; } };
    vi.stubGlobal("documentPictureInPicture", { requestWindow: vi.fn(async () => win) });
    expect(canFloatPage()).toBe(true);
    const { result } = renderHook(() => useFloatingWindow());
    await act(async () => expect(await result.current.open()).toBe(true));
    expect(result.current.floating).toBe(win);
    act(() => win.listeners.pagehide!());
    expect(result.current.floating).toBeNull();
  });

  test("says no where the browser cannot", async () => {
    expect(canFloatPage()).toBe(false);
    const { result } = renderHook(() => useFloatingWindow());
    await act(async () => expect(await result.current.open()).toBe(false));
  });
});
