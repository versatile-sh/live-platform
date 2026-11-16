import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const from = resolve(import.meta.dirname, "../node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const to = resolve(import.meta.dirname, "../public/assets/board/fonts");
const SKIPPED = new Set(["Xiaolai"]);

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const family of readdirSync(from)) if (!SKIPPED.has(family)) cpSync(resolve(from, family), resolve(to, family), { recursive: true });
