import { describe, expect, test } from "vitest";

import { irisFrames } from "./motion";

describe("irisFrames", () => {
  test("opens from the point as shares of the screen, so a zoomed page keeps it under the pointer", () => {
    const [from] = irisFrames({ x: 1728, y: 72 }, { width: 1920, height: 960 });
    expect(from).toBe("circle(0% at 90% 7.5%)");
  });

  test("ends large enough to cover the farthest corner", () => {
    const view = { width: 1000, height: 1000 };
    const [, to] = irisFrames({ x: 0, y: 0 }, view);
    const radius = (Number(to.match(/circle\(([\d.]+)%/)![1]) / 100) * (Math.hypot(view.width, view.height) / Math.SQRT2);
    expect(radius).toBeCloseTo(Math.hypot(1000, 1000));
  });
});
