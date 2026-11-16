import { describe, expect, test, vi } from "vitest";

import { createTheme, type Theme } from "./theme";

function setup(kept: Theme | undefined, systemLight: boolean) {
  const root = { dataset: {} as Record<string, string | undefined> };
  const write = vi.fn();
  const theme = createTheme({ read: () => kept, write, systemPrefersLight: () => systemLight, root });
  return { theme, root, write };
}

describe("createTheme", () => {
  test("follows the system until the person chooses", () => {
    expect(setup(undefined, false).theme.getSnapshot()).toBe("dark");
    const light = setup(undefined, true);
    expect(light.theme.getSnapshot()).toBe("light");
    expect(light.root.dataset.theme).toBeUndefined();
  });

  test("a kept choice wins over the system and is applied at once", () => {
    const { theme, root } = setup("dark", true);
    expect(theme.getSnapshot()).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
  });

  test("toggling takes the other look, marks the page, keeps the choice and tells who listens", () => {
    const { theme, root, write } = setup(undefined, false);
    const heard = vi.fn();
    theme.subscribe(heard);
    theme.toggle();
    expect(theme.getSnapshot()).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(write).toHaveBeenCalledWith("light");
    expect(heard).toHaveBeenCalledTimes(1);
    theme.toggle();
    expect(theme.getSnapshot()).toBe("dark");
  });
});
