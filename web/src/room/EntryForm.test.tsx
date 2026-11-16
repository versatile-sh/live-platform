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
    test("says the room does not exist yet and that the visitor will own it", () => {
      setup(free);
      expect(screen.getByRole("heading", { name: "Create room demo" })).toBeInTheDocument();
      expect(screen.getByText(/does not exist yet. You will create it and own it/)).toBeInTheDocument();
    });

    test("starts public and unlisted, with no password field at all", () => {
      setup(free);
      expect(screen.getByRole("radio", { name: /Public/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Show in the lobby" })).not.toBeChecked();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    });

    test("creates a public listed room without deriving a password", async () => {
      const { onEnter, services } = setup(free);
      const derive = vi.spyOn(services, "derive");
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByLabelText("Show in the lobby"));
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      expect(onEnter).toHaveBeenCalledWith({ name: "Ana", listed: true });
      expect(derive).not.toHaveBeenCalled();
    });

    test("disables the lobby choice once Private is chosen and says why", async () => {
      setup(free);
      await userEvent.click(screen.getByLabelText("Private", { exact: false }));
      expect(screen.getByLabelText("Show in the lobby")).toBeDisabled();
      expect(screen.getByText("Private rooms are never listed.")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeEnabled();
    });

    test("creates a private room with the derived verifier and keeps the password for the share link", async () => {
      const { onEnter } = setup(free);
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByLabelText("Private", { exact: false }));
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalled());
      expect(onEnter).toHaveBeenCalledWith({ name: "Ana", verifier: "v:demo:Kq7mR2xP", password: "Kq7mR2xP" });
    });

    test("draws a new password on request", async () => {
      const generate = vi.fn().mockReturnValueOnce("Aa111111").mockReturnValueOnce("Zz222222");
      setup(free, { services: fakeServices({ generatePassword: generate }) });
      await userEvent.click(screen.getByLabelText("Private", { exact: false }));
      await userEvent.click(screen.getByRole("button", { name: "New password" }));
      expect(screen.getByLabelText("Password")).toHaveValue("Zz222222");
    });

    test("copies the password", async () => {
      const { services } = setup(free);
      await userEvent.click(screen.getByLabelText("Private", { exact: false }));
      await userEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(services.copied).toEqual(["Kq7mR2xP"]);
      expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    });

    test("warns in words when the typed password is weak but still lets it through", async () => {
      const { onEnter } = setup(free);
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByLabelText("Private", { exact: false }));
      await userEvent.clear(screen.getByLabelText("Password"));
      await userEvent.type(screen.getByLabelText("Password"), "abcd1234");
      expect(screen.getByText(/easy to guess/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalled());
    });

    test("refuses a typed password that is too short and focuses it", async () => {
      const { onEnter } = setup(free);
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByLabelText("Private", { exact: false }));
      await userEvent.clear(screen.getByLabelText("Password"));
      await userEvent.type(screen.getByLabelText("Password"), "abc1");
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInvalid();
      expect(onEnter).not.toHaveBeenCalled();
    });
  });

  describe("for an existing public room", () => {
    test("asks only for a name and shows how many are in it", async () => {
      const { onEnter } = setup(existing());
      expect(screen.getByRole("heading", { name: "Join room demo" })).toBeInTheDocument();
      expect(screen.getByText("3/10 people are in it.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      expect(onEnter).toHaveBeenCalledWith({ name: "Bia" });
    });

    test("explains a missing name and does not enter", async () => {
      const { onEnter } = setup(existing());
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      expect(screen.getByLabelText("Your name")).toBeInvalid();
      expect(screen.getByText("Type your name.")).toBeInTheDocument();
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("says the room is full when it is", () => {
      setup(existing({ count: 10 }));
      expect(screen.getByText(/This room is full \(10\/10\)/)).toBeInTheDocument();
    });

    test("remembers the name on this device", async () => {
      const { services } = setup(existing());
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      expect(services.nameMemory.read()).toBe("Bia");
    });

    test("starts with the remembered name", () => {
      const services = fakeServices();
      services.nameMemory.write("Caio");
      setup(existing(), { services });
      expect(screen.getByLabelText("Your name")).toHaveValue("Caio");
    });
  });

  describe("for an existing private room", () => {
    test("asks for the password and sends its verifier without strength rules", async () => {
      const { onEnter } = setup(existing({ private: true }));
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.type(screen.getByLabelText("Password"), "abc");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalled());
      expect(onEnter).toHaveBeenCalledWith({ name: "Bia", verifier: "v:demo:abc", password: "abc" });
    });

    test("requires a password", async () => {
      const { onEnter } = setup(existing({ private: true }));
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      expect(screen.getByText("Type the password.")).toBeInTheDocument();
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("prefills the password a share link carries", () => {
      setup(existing({ private: true }), { services: fakeServices({ readPasswordHash: () => "Kq7mR2xP" }) });
      expect(screen.getByLabelText("Password")).toHaveValue("Kq7mR2xP");
    });

    test("hides the typed password until asked", async () => {
      setup(existing({ private: true }));
      expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
      await userEvent.click(screen.getByRole("button", { name: "Show" }));
      expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    });

    test("tells a wrong password apart in words when the server refused it", () => {
      setup(existing({ private: true }), { refusal: "PERMISSION_DENIED" });
      expect(screen.getByRole("alert")).toHaveTextContent("That password did not open the room");
    });
  });

  test("speaks Portuguese with accents", () => {
    setup(existing({ private: true }), { locale: "pt-BR" });
    expect(screen.getByText("Esta sala é privada. Peça a senha ao dono.")).toBeInTheDocument();
  });
});
