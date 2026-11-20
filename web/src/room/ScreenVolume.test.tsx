import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderWithApp } from "../test-support/render";
import { FULL, heard, ScreenVolume, type Loudness } from "./ScreenVolume";

function show(loudness: Loudness) {
  const onChange = vi.fn();
  renderWithApp(<ScreenVolume name="Screen of Bia" loudness={loudness} onChange={onChange} />);
  return onChange;
}

describe("ScreenVolume", () => {
  test("the slider sets the level, from 0 to 100%", () => {
    const onChange = show(FULL);
    const slider = screen.getByRole("slider", { name: "Volume of Screen of Bia" });
    expect(slider).toHaveValue("100");
    fireEvent.change(slider, { target: { value: "35" } });
    expect(onChange).toHaveBeenCalledWith({ level: 0.35, muted: false });
  });

  test("the speaker silences the sound and keeps the level for when it comes back", async () => {
    const onChange = show({ level: 0.4, muted: false });
    await userEvent.click(screen.getByRole("button", { name: "Silence Screen of Bia" }));
    expect(onChange).toHaveBeenCalledWith({ level: 0.4, muted: true });
  });

  test("silenced, the slider reads 0 and the speaker brings the level back", async () => {
    const onChange = show({ level: 0.4, muted: true });
    expect(screen.getByRole("slider")).toHaveValue("0");
    await userEvent.click(screen.getByRole("button", { name: "Turn the sound of Screen of Bia back on" }));
    expect(onChange).toHaveBeenCalledWith({ level: 0.4, muted: false });
  });

  test("dragged to zero, the speaker brings it back to full", async () => {
    const onChange = show({ level: 0, muted: false });
    await userEvent.click(screen.getByRole("button", { name: "Turn the sound of Screen of Bia back on" }));
    expect(onChange).toHaveBeenCalledWith(FULL);
  });

  test("what is heard is the level, or nothing while silenced", () => {
    expect(heard({ level: 0.6, muted: false })).toBe(0.6);
    expect(heard({ level: 0.6, muted: true })).toBe(0);
  });
});
