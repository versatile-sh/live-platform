import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources(join(dir, entry.name)) : /(?<!\.test)\.tsx$/.test(entry.name) ? [join(dir, entry.name)] : []));
}

test("components take their corners from the bubble family, never from a loose radius", () => {
  const loose = sources(resolve(import.meta.dirname, "..")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/rounded-(?:\[[^\]]*\]|[a-z]{1,2}-\[[^\]]*\]|sm|lg|xl|3xl)(?![\w-])/g)].map((match) => `${file}: ${match[0]}`));
  expect(loose).toEqual([]);
});
