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
