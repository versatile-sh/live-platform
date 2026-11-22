import { afterEach, describe, expect, test, vi } from "vitest";

import { createBrowserServices } from "./browser-services";

function pagehide(persisted: boolean) {
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

afterEach(() => {
  Reflect.deleteProperty(window, "navigation");
});

describe("createBrowserServices pagehide", () => {
  test("reports a page that is going away for good", () => {
    const listener = vi.fn();
    createBrowserServices().pageLifecycle.onPageHide(listener);
    pagehide(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("ignores a page that goes into the back-forward cache", () => {
    const listener = vi.fn();
    createBrowserServices().pageLifecycle.onPageHide(listener);
    pagehide(true);
    expect(listener).not.toHaveBeenCalled();
  });

  describe("when the Navigation API says the page is reloading", () => {
    test("does not report it so the place can be resumed", () => {
      const navigation = new EventTarget();
      Object.defineProperty(window, "navigation", { value: navigation, configurable: true });
      const listener = vi.fn();
      createBrowserServices().pageLifecycle.onPageHide(listener);
      navigation.dispatchEvent(Object.assign(new Event("navigate"), { navigationType: "reload" }));
      pagehide(false);
      expect(listener).not.toHaveBeenCalled();
    });

    test("reports a navigation to another page", () => {
      const navigation = new EventTarget();
      Object.defineProperty(window, "navigation", { value: navigation, configurable: true });
      const listener = vi.fn();
      createBrowserServices().pageLifecycle.onPageHide(listener);
      navigation.dispatchEvent(Object.assign(new Event("navigate"), { navigationType: "push" }));
      pagehide(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  test("unsubscribes", () => {
    const listener = vi.fn();
    createBrowserServices().pageLifecycle.onPageHide(listener)();
    pagehide(false);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createBrowserServices share link", () => {
  test("reads the password from the fragment", () => {
    window.location.hash = "#Kq7mR2xP";
    expect(createBrowserServices().readPasswordHash()).toBe("Kq7mR2xP");
    window.location.hash = "";
  });
});

describe("createBrowserServices takePass", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("asks the server again after a failed fetch", async () => {
    const fetchPass = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "Ana", face: "", private: false, listed: false }) });
    vi.stubGlobal("fetch", fetchPass);
    const services = createBrowserServices();
    expect(await services.takePass("retry-pass-id-0000000")).toBeUndefined();
    expect(await services.takePass("retry-pass-id-0000000")).toMatchObject({ name: "Ana" });
    expect(fetchPass).toHaveBeenCalledTimes(2);
  });

  test("shares one fetch between two asks while it is in flight", async () => {
    const fetchPass = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "Ana", face: "", private: false, listed: false }) });
    vi.stubGlobal("fetch", fetchPass);
    const services = createBrowserServices();
    await Promise.all([services.takePass("shared-pass-id-000000"), services.takePass("shared-pass-id-000000")]);
    expect(fetchPass).toHaveBeenCalledTimes(1);
  });
});
