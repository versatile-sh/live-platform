import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { renderWithApp } from "../test-support/render";
import { CommandPalette, searchCommands, type Command } from "./CommandPalette";

const make = (ran: string[]): Command[] => [
  { id: "mic", group: "Call", label: "Turn microphone on", keys: "Ctrl+D", run: () => ran.push("mic") },
  { id: "cam", group: "Call", label: "Turn camera on", run: () => ran.push("cam") },
  { id: "chat", group: "Panels", label: "Open the chat", run: () => ran.push("chat") },
  { id: "pt", group: "Language", label: "Português", run: () => ran.push("pt") },
];

describe("searchCommands", () => {
  test("keeps what holds every word typed, in any order, ignoring case and accents", () => {
    const all = make([]);
    expect(searchCommands(all, "").map((c) => c.id)).toEqual(["mic", "cam", "chat", "pt"]);
    expect(searchCommands(all, "ON turn").map((c) => c.id)).toEqual(["mic", "cam"]);
    expect(searchCommands(all, "portugues").map((c) => c.id)).toEqual(["pt"]);
    expect(searchCommands(all, "panels").map((c) => c.id)).toEqual(["chat"]);
    expect(searchCommands(all, "nothing like it")).toEqual([]);
  });
});

describe("CommandPalette", () => {
  function setup() {
    const ran: string[] = [];
    const onClose = vi.fn();
    renderWithApp(<CommandPalette commands={make(ran)} onClose={onClose} />);
    return { ran, onClose };
  }

  test("starts on the first command, moves with the arrows wrapping round, and runs with Enter", async () => {
    const { ran, onClose } = setup();
    expect(screen.getByRole("option", { name: /Turn microphone on/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: "Português" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(ran).toEqual(["cam"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("narrows as I type and says so when nothing is left", async () => {
    setup();
    await userEvent.type(screen.getByRole("combobox"), "chat");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("1 found")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
  });

  test("closes with Escape without running anything", async () => {
    const { ran, onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(ran).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
