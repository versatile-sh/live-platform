import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ServicesProvider } from "../services";
import { fakeServices } from "../test-support/render";
import { useCopy } from "./useCopy";

function withClipboard(write: (text: string) => Promise<boolean>) {
  const services = fakeServices({ clipboard: { write } });
  return ({ children }: { children: ReactNode }) => <ServicesProvider services={services}>{children}</ServicesProvider>;
}

describe("useCopy", () => {
  afterEach(() => vi.useRealTimers());

  describe("when the browser copies", () => {
    test("says copied, then goes quiet after a few seconds", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCopy(), { wrapper: withClipboard(async () => true) });
      expect(result.current.result).toBe("idle");
      await act(() => result.current.copy("https://live.test/demo"));
      expect(result.current.result).toBe("copied");
      act(() => vi.advanceTimersByTime(2500));
      expect(result.current.result).toBe("idle");
    });
  });

  describe("when the browser refuses", () => {
    test("says it failed", async () => {
      const { result } = renderHook(() => useCopy(), { wrapper: withClipboard(async () => false) });
      await act(() => result.current.copy("https://live.test/demo"));
      expect(result.current.result).toBe("failed");
    });
  });
});
