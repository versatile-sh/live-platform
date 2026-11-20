import { describe, expect, test } from "vitest";

import { fitStage } from "./stage-fit";

const GAP = 12;
const stages = [
  { width: 1920, height: 900 },
  { width: 1280, height: 640 },
  { width: 1024, height: 520 },
  { width: 768, height: 600 },
  { width: 390, height: 560 },
  { width: 360, height: 520 },
  { width: 900, height: 300 },
  { width: 300, height: 900 },
];
const counts = Array.from({ length: 30 }, (_, index) => index + 1);

function extent(fit: ReturnType<typeof fitStage>) {
  return {
    width: fit.columns * fit.tile.width + GAP * (fit.columns - 1),
    height: fit.rows * fit.tile.height + GAP * (fit.rows - 1),
  };
}

describe("fitStage", () => {
  describe("with a stage large enough for the tiles to keep the minimum width", () => {
    test.each(stages.flatMap((stage) => counts.map((count) => [stage, count] as const)))("%j with %i tiles stays inside the stage", (stage, count) => {
      const fit = fitStage(stage, count);
      if (fit.scrolls) return;
      expect(extent(fit).width).toBeLessThanOrEqual(stage.width);
      expect(extent(fit).height).toBeLessThanOrEqual(stage.height);
      expect(fit.columns * fit.rows).toBeGreaterThanOrEqual(count);
      expect(fit.tile.width).toBeGreaterThanOrEqual(144);
    });

    test.each(stages.flatMap((stage) => counts.map((count) => [stage, count] as const)))("%j with %i tiles has no column count with a larger tile", (stage, count) => {
      const fit = fitStage(stage, count);
      if (fit.scrolls) return;
      for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const width = Math.min((stage.width - GAP * (columns - 1)) / columns, ((stage.height - GAP * (rows - 1)) / rows) * (16 / 9));
        expect(Math.floor(width) * Math.floor(width / (16 / 9))).toBeLessThanOrEqual(fit.tile.width * fit.tile.height);
      }
    });

    test("keeps the 16:9 aspect of every tile", () => {
      const { tile } = fitStage({ width: 1280, height: 640 }, 5);
      expect(Math.abs(tile.width / tile.height - 16 / 9)).toBeLessThan(0.05);
    });
  });

  describe("with a handful of people on a wide stage", () => {
    test("puts one person alone as large as the height allows", () => {
      expect(fitStage({ width: 1600, height: 450 }, 1)).toMatchObject({ columns: 1, rows: 1, tile: { width: 800, height: 450 }, scrolls: false });
    });

    test("puts two people side by side", () => {
      expect(fitStage({ width: 1600, height: 450 }, 2).columns).toBe(2);
    });

    test("stacks people in one column on a tall narrow stage", () => {
      expect(fitStage({ width: 360, height: 700 }, 3)).toMatchObject({ columns: 1, rows: 3 });
    });
  });

  describe("with more people than the minimum tile can hold", () => {
    test.each([
      [{ width: 1280, height: 640 }, 60],
      [{ width: 390, height: 560 }, 20],
      [{ width: 300, height: 400 }, 20],
    ])("%j with %i tiles keeps the minimum width, fits the width and scrolls", (stage, count) => {
      const fit = fitStage(stage, count);
      expect(fit.scrolls).toBe(true);
      expect(fit.tile.width).toBeGreaterThanOrEqual(Math.min(144, stage.width));
      expect(extent(fit).width).toBeLessThanOrEqual(stage.width);
      expect(extent(fit).height).toBeGreaterThan(stage.height);
    });
  });

  describe("with an empty or degenerate input", () => {
    test("treats no frames as one", () => {
      expect(fitStage({ width: 800, height: 450 }, 0).columns).toBe(1);
    });
  });
});
