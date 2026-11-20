export type Box = { width: number; height: number };

export type StageFit = { columns: number; rows: number; tile: Box; scrolls: boolean };

type FitOptions = { gap: number; minWidth: number; ratio: number };

const DEFAULTS: FitOptions = { gap: 12, minWidth: 144, ratio: 16 / 9 };

function tileFor(stage: Box, columns: number, rows: number, { gap, ratio }: FitOptions): Box {
  const width = Math.min((stage.width - gap * (columns - 1)) / columns, ((stage.height - gap * (rows - 1)) / rows) * ratio);
  return { width: Math.floor(width), height: Math.floor(width / ratio) };
}

/**
 * The columns and tile size that give `count` tiles of one aspect ratio the most area inside the stage without overflowing it.
 * When the best tile would be narrower than `minWidth`, tiles keep that width, fill each row and the stage scrolls (`scrolls`).
 */
export function fitStage(stage: Box, count: number, options: Partial<FitOptions> = {}): StageFit {
  const settings = { ...DEFAULTS, ...options };
  const total = Math.max(1, count);
  let best: StageFit = { columns: 1, rows: total, tile: tileFor(stage, 1, total, settings), scrolls: false };
  for (let columns = 2; columns <= total; columns++) {
    const rows = Math.ceil(total / columns);
    const tile = tileFor(stage, columns, rows, settings);
    if (tile.width * tile.height > best.tile.width * best.tile.height) best = { columns, rows, tile, scrolls: false };
  }
  if (best.tile.width >= settings.minWidth) return best;
  const columns = Math.min(total, Math.max(1, Math.floor((stage.width + settings.gap) / (settings.minWidth + settings.gap))));
  const width = Math.floor((stage.width - settings.gap * (columns - 1)) / columns);
  return { columns, rows: Math.ceil(total / columns), tile: { width, height: Math.floor(width / settings.ratio) }, scrolls: true };
}
