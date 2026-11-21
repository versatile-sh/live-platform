import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const opentype = require("opentype.js");
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..");
const spec = JSON.parse(readFileSync(join(here, "readme.assets.json"), "utf8"));

const font = (pkg, file) => {
  const buf = readFileSync(join(here, "node_modules/@fontsource", pkg, "files", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const serif = font("instrument-serif", "instrument-serif-latin-400-normal.woff");
const italic = font("instrument-serif", "instrument-serif-latin-400-italic.woff");
const mono = font("jetbrains-mono", "jetbrains-mono-latin-400-normal.woff");
const monoMedium = font("jetbrains-mono", "jetbrains-mono-latin-500-normal.woff");

const THEMES = {
  dark: { bg: "#0e1116", ink: "#f5f5f2", muted: "#8a919c", accent: "#c6f432", accentText: "#c6f432", box: "#12161d", line: "#f5f5f2", grid: 0.04, glow: 0.09 },
  light: { bg: "#f5f5f2", ink: "#0e1116", muted: "#586070", accent: "#c6f432", accentText: "#4a6a00", box: "#ffffff", line: "#0e1116", grid: 0.05, glow: 0 },
};

const width = (f, t, size) => f.getAdvanceWidth(t, size);
const r = (n) => Math.round(n * 10) / 10;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fit = (f, s, size, max, what) => {
  if (width(f, s, size) > max) throw new Error(`${what}: "${s}" overflows its box (${r(width(f, s, size))} > ${max})`);
  return s;
};

let glyphs;
const reset = () => {
  glyphs = new Map();
};
const glyphId = (f, glyph, size) => {
  const key = `${f.names.fullName.en}|${size}|${glyph.index}`;
  if (!glyphs.has(key)) glyphs.set(key, { id: `g${glyphs.size}`, d: glyph.getPath(0, 0, size).toPathData(size >= 30 ? 0 : 1) });
  return glyphs.get(key);
};
const defs = () => [...glyphs.values()].filter((g) => g.d).map((g) => `<path id="${g.id}" d="${g.d}"/>`).join("");
const text = (f, s, x, y, size, fill) => {
  const uses = [];
  f.forEachGlyph(s, x, y, size, { kerning: true }, (glyph, gx, gy) => {
    const g = glyphId(f, glyph, size);
    if (g.d) uses.push(`<use href="#${g.id}" x="${r(gx)}" y="${r(gy)}"/>`);
  });
  return `<g fill="${fill}">${uses.join("")}</g>`;
};
const runs = (parts, x, y) => {
  let cx = x;
  return parts
    .map(([f, s, size, fill]) => {
      const p = text(f, s, cx, y, size, fill);
      cx += width(f, s, size);
      return p;
    })
    .join("");
};

const mark = (x, y, s) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><rect width="1024" height="1024" rx="160" fill="#151a22"/><rect width="1024" height="190" fill="#1a1f27"/><rect y="190" width="1024" height="4" fill="#2a313c"/><circle cx="320" cy="96" r="22" fill="#3a424e"/><circle cx="392" cy="96" r="22" fill="#3a424e"/><circle cx="464" cy="96" r="22" fill="#c6f432"/><path d="M158 467L310 541V581L158 655V617L287 561L158 505Z" fill="#3a424e"/><path d="M376 432H441L521 688H532L612 432H677L578 732H477Z" fill="#f5f5f2"/><rect x="716" y="694.5" width="149" height="37.5" rx="9" fill="#c6f432"/></g>`;

const frame = (t, w, h, label, body) => {
  const grid = [];
  for (let x = 64; x < w; x += 64) grid.push(`M${x} 0V${h}`);
  for (let y = 64; y < h; y += 64) grid.push(`M0 ${y}H${w}`);
  const glow = t.glow ? `<rect width="${w}" height="${h}" fill="url(#l)"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs><radialGradient id="l" cx="0.5" cy="0" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="${t.glow}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><clipPath id="c"><rect width="${w}" height="${h}" rx="16"/></clipPath>${defs()}</defs><g clip-path="url(#c)"><rect width="${w}" height="${h}" fill="${t.bg}"/><path d="${grid.join("")}" stroke="${t.line}" stroke-opacity="${t.grid}" fill="none"/>${glow}${body}</g><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="15.5" fill="none" stroke="${t.line}" stroke-opacity="0.18"/></svg>\n`;
};

const wordmark = (t, x, y) => runs([[mono, "versatile", 18, t.ink], [mono, ".sh", 18, t.accentText]], x, y);

const hero = (t) => {
  reset();
  const w = 1280;
  const h = 480;
  const max = w - 144;
  let size = 112;
  while (width(serif, spec.name, size) > max && size > 72) size -= 4;
  fit(serif, spec.name, size, max, "hero name");
  const [lead, accent, tail] = spec.pitch;
  const pitchW = width(serif, lead, 46) + width(italic, accent, 46) + width(serif, tail ?? "", 46);
  if (pitchW > max) throw new Error(`hero pitch overflows (${r(pitchW)} > ${max})`);
  fit(serif, spec.sub, 34, max, "hero sub");
  let tx = 72;
  const pills = (spec.tags ?? [])
    .map((tag) => {
      const tw = width(mono, tag, 15);
      const p = `<rect x="${tx}" y="388" width="${(tw + 32).toFixed(1)}" height="36" rx="18" fill="none" stroke="${t.line}" stroke-opacity="0.18"/>${text(mono, tag, tx + 16, 411, 15, t.muted)}`;
      tx += tw + 44;
      return p;
    })
    .join("");
  if (tx - 44 > w - 72) throw new Error("hero tags overflow");
  const badge = spec.badge ?? "";
  const body = [
    mark(72, 56, 48 / 1024),
    wordmark(t, 136, 87),
    badge ? text(mono, badge, w - 72 - width(mono, badge, 14), 86, 14, t.muted) : "",
    text(serif, spec.name, 68, 214, size, t.ink),
    runs([[serif, lead, 46, t.ink], [italic, accent, 46, t.accentText], [serif, tail ?? "", 46, t.ink]], 72, 284),
    text(serif, spec.sub, 72, 334, 34, t.muted),
    `<path d="M72 364H${w - 72}" stroke="${t.line}" stroke-opacity="0.1"/>`,
    pills,
  ].join("");
  return frame(t, w, h, spec.heroLabel ?? `${spec.name}: ${lead}${accent}${tail ?? ""} ${spec.sub}`, body);
};

const section = (t, kicker, plain, accent) => {
  reset();
  const w = 1280;
  const h = 150;
  fit(serif, plain, 54, 1000, "section title");
  const body = [
    mark(56, 47, 56 / 1024),
    text(mono, `${spec.name}  /  ${kicker}`, 136, 58, 14, t.muted),
    runs([[serif, plain, 54, t.ink], [italic, accent, 54, t.accentText]], 134, 114),
  ].join("");
  return frame(t, w, h, `${plain}${accent}`.trim(), body);
};

const diagram = (t, d) => {
  reset();
  const w = 1200;
  const n = d.cards.length;
  const top = 48;
  const gap = d.gap ?? 80;
  const pad = 24;
  const maxRows = Math.max(...d.cards.map((c) => c.rows.length));
  const boxH = d.height ?? Math.max(210, 146 + maxRows * 38);
  const weights = d.cards.map((c) => c.weight ?? 1);
  const unit = (w - 112 - gap * (n - 1)) / weights.reduce((a, b) => a + b, 0);
  const xs = [];
  const ws = [];
  let cx0 = 56;
  weights.forEach((wt, i) => {
    xs.push(cx0);
    ws.push(unit * wt);
    cx0 += unit * wt + gap;
  });
  const box = (x, y, bw, bh) => `<rect x="${x}" y="${y}" width="${r(bw)}" height="${bh}" rx="12" fill="${t.box}" stroke="${t.line}" stroke-opacity="0.18"/>`;
  const card = (c, x, bw) =>
    [
      box(x, top, bw, boxH),
      text(monoMedium, fit(monoMedium, c.title, 26, bw - 2 * pad, `card title`), x + pad, top + 50, 26, t.ink),
      text(monoMedium, fit(monoMedium, c.sub, 16, bw - 2 * pad, `card subtitle`), x + pad, top + 80, 16, t.muted),
      `<path d="M${r(x + pad)} ${top + 104}H${r(x + bw - pad)}" stroke="${t.line}" stroke-opacity="0.1"/>`,
      ...c.rows.map((row, i) => {
        const [s, tone] = Array.isArray(row) ? row : [row, ""];
        const fill = tone === "muted" ? t.muted : tone === "accent" ? t.accentText : t.ink;
        return text(monoMedium, fit(monoMedium, s, 18, bw - 2 * pad, `row`), x + pad, top + 146 + i * 38, 18, fill);
      }),
    ].join("");
  const arrow = (x1, x2, y, color, label) => {
    if (width(monoMedium, label, 16) > x2 - x1 - 8) throw new Error(`arrow label "${label}" does not fit the gap`);
    return `<path d="M${r(x1 + 12)} ${y}H${r(x2 - 14)}" stroke="${color}" stroke-width="1.5"/><path d="M${r(x2 - 22)} ${y - 5}L${r(x2 - 12)} ${y}L${r(x2 - 22)} ${y + 5}Z" fill="${color}"/>` +
      text(monoMedium, label, (x1 + x2) / 2 - width(monoMedium, label, 16) / 2, y - 14, 16, color);
  };
  const parts = d.cards.map((c, i) => card(c, xs[i], ws[i]));
  (d.arrows ?? []).forEach((a, i) => {
    if (!a) return;
    const color = a.accent ? t.accentText : t.muted;
    parts.push(arrow(xs[i] + ws[i], xs[i + 1], top + boxH / 2, color, a.label));
  });
  let h = top + boxH + 48;
  if (d.footer) {
    const f = d.footer;
    const at = f.under ?? Math.floor(n / 2);
    const fx = xs[at];
    const fw = ws[at];
    const cy = top + boxH + 48;
    const mid = fx + fw / 2;
    parts.push(
      `<path d="M${r(mid)} ${top + boxH + 8}V${cy - 14}" stroke="${t.muted}" stroke-width="1.5" stroke-dasharray="4 4"/><path d="M${r(mid - 5)} ${cy - 18}L${r(mid)} ${cy - 8}L${r(mid + 5)} ${cy - 18}Z" fill="${t.muted}"/>`,
      f.label ? text(monoMedium, f.label, mid + 14, top + boxH + 30, 16, t.muted) : "",
      box(fx, cy, fw, 96),
      `<circle cx="${r(fx + pad + 5)}" cy="${cy + 35}" r="5" fill="${t.accent}"/>`,
      text(monoMedium, fit(monoMedium, f.title, 26, fw - 2 * pad - 22, "footer title"), fx + pad + 22, cy + 44, 26, t.ink),
      text(monoMedium, fit(monoMedium, f.sub, 16, fw - 2 * pad - 22, "footer sub"), fx + pad + 22, cy + 76, 16, t.muted),
    );
    h = cy + 96 + 48;
  }
  return frame(t, w, h, d.label, parts.join(""));
};

let count = 0;
const emit = (name, fn) => {
  for (const [variant, t] of Object.entries(THEMES)) {
    writeFileSync(join(out, `${name}-${variant}.svg`), fn(t));
    count++;
  }
};
emit("banner-hero", hero);
for (const [slug, kicker, plain, accent] of spec.sections ?? []) emit(`section-${slug}`, (t) => section(t, kicker, plain, accent));
for (const d of spec.diagrams ?? []) emit(`diagram-${d.slug}`, (t) => diagram(t, d));
console.log(`wrote ${count} images to ${out}`);
