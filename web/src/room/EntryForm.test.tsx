import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { RoomSummary } from "../api/rooms";
import type { JoinEntry } from "../session/session";
import { fakeServices, renderWithApp } from "../test-support/render";
import { EntryForm } from "./EntryForm";

const free: RoomSummary = { slug: "demo", exists: false, private: false, count: 0, capacity: 10 };
const existing = (over: Partial<RoomSummary> = {}): RoomSummary => ({ slug: "demo", exists: true, private: false, count: 3, capacity: 10, ...over });

function setup(room: RoomSummary, extra: { refusal?: "PERMISSION_DENIED"; services?: ReturnType<typeof fakeServices>; locale?: "en" | "pt-BR" } = {}) {
  const onEnter = vi.fn<(entry: JoinEntry) => void>();
  const services = extra.services ?? fakeServices();
  renderWithApp(<EntryForm slug="demo" room={room} {...(extra.refusal ? { refusal: extra.refusal } : {})} onEnter={onEnter} />, { services, ...(extra.locale ? { locale: extra.locale } : {}) });
  return { onEnter, services };
}

describe("EntryForm", () => {
  describe("for a free slug", () => {
    test("says the name is free and offers to create the room, public and shown in the open rooms", () => {
      setup(free);
      expect(screen.getByRole("heading", { name: "Create demo" })).toBeInTheDocument();
      expect(screen.getByText(/This name is free/)).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Public/ })).toBeChecked();
      expect(screen.getByRole("switch", { name: /Show in open rooms/ })).toBeChecked();
      expect(screen.queryByLabelText("Room code")).not.toBeInTheDocument();
    });

    test("creates a public listed room without deriving anything", async () => {
      const { onEnter, services } = setup(free);
      const derive = vi.spyOn(services, "derive");
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Ana", look: 34, face: "^_^", listed: true }));
      expect(derive).not.toHaveBeenCalled();
    });

    test("a private room carries the room code it shows, and may still be shown in the open rooms or not", async () => {
      const { onEnter } = setup(free, { services: fakeServices({ generatePassword: () => "8ABH-23HK" }) });
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      expect(screen.getByLabelText("Room code")).toHaveTextContent("8ABH-23HK");
      await userEvent.click(screen.getByRole("switch", { name: /Show in open rooms/ }));
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Ana", look: 34, face: "^_^", verifier: "v:demo:8ABH-23HK", password: "8ABH-23HK", listed: false }));
    });

    test("draws a new code on request and copies the one shown", async () => {
      const codes = ["8ABH-23HK", "9XYZ-45QR"];
      const { services } = setup(free, { services: fakeServices({ generatePassword: () => codes.shift() ?? "none" }) });
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      await userEvent.click(screen.getByRole("button", { name: "New" }));
      expect(screen.getByLabelText("Room code")).toHaveTextContent("9XYZ-45QR");
      await userEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(services.copied).toEqual(["9XYZ-45QR"]);
    });
  });

  describe("for an existing public room", () => {
    test("asks only for a name and shows how many are in it", async () => {
      const { onEnter } = setup(existing());
      expect(screen.getByRole("heading", { name: "Join demo" })).toBeInTheDocument();
      expect(screen.getByText("3/10 people are in it.")).toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Bia", look: 34, face: "^_^" }));
    });

    test("explains a missing name and does not enter", async () => {
      const { onEnter } = setup(existing());
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      expect(screen.getByLabelText("Your name")).toBeInvalid();
      expect(screen.getByText("Type your name.")).toBeInTheDocument();
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("says the room is full and does not offer to enter", () => {
      setup(existing({ count: 10 }));
      expect(screen.getByText(/This room is full/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enter room" })).toBeDisabled();
    });

    test("remembers the name on this device and starts with it next time", async () => {
      const services = fakeServices();
      setup(existing(), { services });
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      await waitFor(() => expect(services.nameMemory.read()).toBe("Bia"));
    });
  });

  describe("for an existing private room", () => {
    test("asks for the room code and sends its verifier", async () => {
      const { onEnter } = setup(existing({ private: true }));
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.type(screen.getByLabelText("Room code"), "8abh-23hk");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Bia", look: 34, face: "^_^", verifier: "v:demo:8abh-23hk", password: "8abh-23hk" }));
    });

    test("requires the code", async () => {
      const { onEnter } = setup(existing({ private: true }));
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      expect(screen.getByLabelText("Room code")).toBeInvalid();
      expect(screen.getByText("Type the room code.")).toBeInTheDocument();
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("prefills the code a share link carries", () => {
      setup(existing({ private: true }), { services: fakeServices({ readPasswordHash: () => "8ABH-23HK" }) });
      expect(screen.getByLabelText("Room code")).toHaveValue("8ABH-23HK");
    });

    test("tells a wrong code apart in words when the server refused it", () => {
      setup(existing({ private: true }), { refusal: "PERMISSION_DENIED" });
      expect(screen.getByRole("alert")).toHaveTextContent(/did not open the room/);
    });
  });

  test("speaks Portuguese with accents", () => {
    setup(free, { locale: "pt-BR" });
    expect(screen.getByRole("heading", { name: "Criar demo" })).toBeInTheDocument();
    expect(screen.getByText(/Este nome está livre/)).toBeInTheDocument();
  });
});
