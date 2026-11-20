import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

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

const pane = () => screen.getByRole("region", { name: "More options", hidden: true });

describe("EntryForm", () => {
  describe("from an invitation link", () => {
    test("a link with a room code to a free room creates it private with that code, and its query says whether it is shown", async () => {
      const services = fakeServices({ readPasswordHash: () => "8ABH-23HK", invite: { read: () => ({ listed: false, pass: undefined }), forget: () => undefined } });
      setup(free, { services });
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getByRole("radio", { name: /Private/ })).toBeChecked();
      expect(screen.getByLabelText("Room code")).toHaveValue("8ABH-23HK");
      expect(screen.getByRole("switch", { name: /Show in open rooms/ })).not.toBeChecked();
    });

    test("a guest pass fills in the name and the photo, chooses the access, and is asked for once; the query leaves the address", async () => {
      const faces: string[] = [];
      const forget = vi.fn();
      const takePass = vi.fn(async () => ({ name: "Ana Souza", face: "AQID", private: true, listed: true }));
      const services = fakeServices({ invite: { read: () => ({ listed: undefined, pass: "abcdefghijklmnopqrstuv" }), forget }, takePass, faceMemory: { read: () => "", write: (face) => void faces.push(face) } });
      setup(free, { services });
      await waitFor(() => expect(screen.getByLabelText("Your name")).toHaveValue("Ana Souza"));
      expect(takePass).toHaveBeenCalledWith("abcdefghijklmnopqrstuv");
      expect(faces).toEqual(["AQID"]);
      expect(forget).toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getByRole("radio", { name: /Private/ })).toBeChecked();
      expect(screen.getByRole("switch", { name: /Show in open rooms/ })).toBeChecked();
    });

    test("without a pass the person types their name as usual", async () => {
      const takePass = vi.fn(async () => undefined);
      setup(free, { services: fakeServices({ takePass }) });
      expect(screen.getByLabelText("Your name")).toHaveValue("");
      expect(takePass).not.toHaveBeenCalled();
    });
  });

  describe("for a free slug", () => {
    test("asks only for a name, and keeps the room public and out of the open rooms under More options", async () => {
      setup(free);
      expect(screen.getByRole("heading", { name: "Create demo" })).toBeInTheDocument();
      expect(screen.getByText(/This name is free/)).toBeInTheDocument();
      expect(screen.getByLabelText("Your name")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create and enter" })).toBeInTheDocument();
      const more = screen.getByRole("button", { name: "More options" });
      expect(more).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByLabelText("Room name").closest("[inert]")).not.toBeNull();
      await userEvent.click(more);
      expect(more).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("radio", { name: /Public/ })).toBeChecked();
      expect(screen.getByRole("switch", { name: /Show in open rooms/ })).not.toBeChecked();
      expect(screen.getByLabelText("Room code").closest("[inert]")).not.toBeNull();
    });

    test("shows the room name taken from the address, and a changed name opens that room instead, carrying what was chosen", async () => {
      const { onEnter, services } = setup(free);
      const put = vi.spyOn(services.entryIntent, "put");
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      const room = screen.getByLabelText("Room name");
      expect(room).toHaveValue("demo");
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.clear(room);
      await userEvent.type(room, "Sala-Nova ");
      expect(screen.getByRole("heading", { name: "Create sala-nova" })).toBeInTheDocument();
      await userEvent.click(within(pane()).getByRole("button", { name: "Create and enter" }));
      await waitFor(() => expect(put).toHaveBeenCalledWith("sala-nova", { name: "Ana", look: "ff9ec7-0e1116-0", face: "^_^", listed: false }));
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("refuses a room name the site cannot use", async () => {
      const { onEnter } = setup(free);
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.clear(screen.getByLabelText("Room name"));
      await userEvent.type(screen.getByLabelText("Room name"), "a");
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      expect(await screen.findByText("Use 2 to 40 characters.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "More options" })).toHaveAttribute("aria-expanded", "true");
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("keeps the options chosen when they are put away with Escape or Back, and gives focus back to the toggle", async () => {
      setup(free);
      const more = screen.getByRole("button", { name: "More options" });
      await userEvent.click(more);
      expect(screen.getByLabelText("Room name")).toHaveFocus();
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      await userEvent.keyboard("{Escape}");
      expect(more).toHaveAttribute("aria-expanded", "false");
      expect(more).toHaveFocus();
      await userEvent.click(more);
      await userEvent.click(within(pane()).getByRole("button", { name: "Back" }));
      expect(more).toHaveAttribute("aria-expanded", "false");
      expect(more).toHaveFocus();
      expect(screen.getByRole("radio", { name: /Private/, hidden: true })).toBeChecked();
    });

    test("puts the options away when their own button is pressed without a name, so the name's note shows", async () => {
      const { onEnter } = setup(free);
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(within(pane()).getByRole("button", { name: "Create and enter" }));
      expect(screen.getByRole("button", { name: "More options" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByLabelText("Your name")).toBeInvalid();
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("creates a public room out of the open rooms without deriving anything", async () => {
      const { onEnter, services } = setup(free);
      const derive = vi.spyOn(services, "derive");
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByRole("button", { name: "Create and enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Ana", look: "ff9ec7-0e1116-0", face: "^_^", listed: false }));
      expect(derive).not.toHaveBeenCalled();
    });

    test("a private room carries the room code it shows, and may still be shown in the open rooms or not", async () => {
      const { onEnter } = setup(free, { services: fakeServices({ generatePassword: () => "8ABH-23HK" }) });
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      expect(screen.getByLabelText("Room code")).toHaveTextContent("8ABH-23HK");
      await userEvent.click(screen.getByRole("switch", { name: /Show in open rooms/ }));
      await userEvent.click(within(pane()).getByRole("button", { name: "Create and enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Ana", look: "ff9ec7-0e1116-0", face: "^_^", verifier: "v:demo:8ABH-23HK", password: "8ABH-23HK", listed: true }));
    });

    test("draws a new code on request and copies the one shown", async () => {
      const codes = ["8ABH-23HK", "9XYZ-45QR"];
      const { services } = setup(free, { services: fakeServices({ generatePassword: () => codes.shift() ?? "none" }) });
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
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
      expect(screen.queryByRole("button", { name: "More options" })).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Bia", look: "ff9ec7-0e1116-0", face: "^_^" }));
    });

    test("explains a missing name and does not enter", async () => {
      const { onEnter } = setup(existing());
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
      expect(screen.getByLabelText("Your name")).toBeInvalid();
      expect(screen.getByText("Type your name.")).toBeInTheDocument();
      expect(onEnter).not.toHaveBeenCalled();
    });

    test("says the room is full and does not offer to enter", () => {
      setup(existing({ count: 10 }));
      expect(screen.getByText(/This room is full/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enter" })).toBeDisabled();
    });

    test("remembers the name on this device and starts with it next time", async () => {
      const services = fakeServices();
      setup(existing(), { services });
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
      await waitFor(() => expect(services.nameMemory.read()).toBe("Bia"));
    });
  });

  describe("for an existing private room", () => {
    test("asks for the room code and sends its verifier", async () => {
      const { onEnter } = setup(existing({ private: true }));
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.type(screen.getByLabelText("Room code"), "8abh-23hk");
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ name: "Bia", look: "ff9ec7-0e1116-0", face: "^_^", verifier: "v:demo:8abh-23hk", password: "8abh-23hk" }));
    });

    test("requires the code", async () => {
      const { onEnter } = setup(existing({ private: true }));
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
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

  describe("entering", () => {
    afterEach(() => {
      Reflect.deleteProperty(document, "startViewTransition");
    });

    test("moves the page forward into the room", async () => {
      const kinds: (string | undefined)[] = [];
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: (update: () => void) => {
          kinds.push(document.documentElement.dataset.motion);
          update();
          return { finished: Promise.resolve() };
        },
      });
      const { onEnter } = setup(existing());
      await userEvent.type(screen.getByLabelText("Your name"), "Bia");
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
      await waitFor(() => expect(onEnter).toHaveBeenCalled());
      expect(kinds).toEqual(["forward"]);
    });
  });

  test("speaks Portuguese with accents", () => {
    setup(free, { locale: "pt-BR" });
    expect(screen.getByRole("heading", { name: "Criar demo" })).toBeInTheDocument();
    expect(screen.getByText(/Este nome está livre/)).toBeInTheDocument();
  });
});
