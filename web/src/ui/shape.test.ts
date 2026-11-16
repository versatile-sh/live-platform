import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources(join(dir, entry.name)) : /(?<!\.test)\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []));
}

test("components take their corners from the bubble family, never from a loose radius", () => {
  const loose = sources(resolve(import.meta.dirname, "..")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/rounded-(?:\[[^\]]*\]|[a-z]{1,2}-\[[^\]]*\]|sm|lg|xl|3xl)(?![\w-])/g)].map((match) => `${file}: ${match[0]}`));
  expect(loose).toEqual([]);
});

test("outside the component folder no button builds its own skin: shapes and fills come from ui/styles", () => {
  const root = resolve(import.meta.dirname, "..");
  const handmade = sources(root)
    .filter((file) => !file.startsWith(import.meta.dirname))
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/<(?:button|AppLink|a)\b[^>]*?className=(?:"([^"]*)"|\{`([^`$]*)[`$])/gs)].filter((match) => /rounded-full|bubble-word/.test(match[1] ?? match[2] ?? "")).map((match) => `${file}: ${(match[1] ?? match[2] ?? "").slice(0, 60)}`));
  expect(handmade).toEqual([]);
});
