import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const from = resolve(import.meta.dirname, "../node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const to = resolve(import.meta.dirname, "../public/assets/board/fonts");
const SKIPPED = new Set(["Xiaolai"]);

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const family of readdirSync(from)) if (!SKIPPED.has(family)) cpSync(resolve(from, family), resolve(to, family), { recursive: true });

const vision = resolve(import.meta.dirname, "../node_modules/@mediapipe/tasks-vision/wasm");
const visionTo = resolve(import.meta.dirname, "../public/assets/vision");
rmSync(visionTo, { recursive: true, force: true });
mkdirSync(visionTo, { recursive: true });
for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) cpSync(resolve(vision, file), resolve(visionTo, file));
