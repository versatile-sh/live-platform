import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { NavigationProvider } from "../routing/Navigation";
import { ServicesProvider } from "../services";
import { fakePathname, fakeServices, renderWithApp } from "../test-support/render";
import { EntryForm } from "../room/EntryForm";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  test("says what the product is and shows the address a room will have", () => {
    renderWithApp(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Share anything.Watch anywhere.be live");
    expect(screen.getAllByText("live.test").length).toBeGreaterThan(0);
  });

  test("speaks Portuguese for a pt-BR visitor", () => {
    renderWithApp(<HomePage />, { locale: "pt-BR" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Compartilhe qualquer coisa.Assista de qualquer lugar.");
  });

  describe("the create button", () => {
    const drawn = /^\/[2-9a-hj-np-z]{4}-[2-9a-hj-np-z]{4}$/;

    test("with a remembered name, one click enters a new room with a name drawn for it", async () => {
      const pathname = fakePathname();
      const services = fakeServices({ nameMemory: { read: () => "Ana", write: () => undefined } });
      renderWithApp(<HomePage />, { pathname, services });
      await userEvent.click(screen.getByRole("button", { name: "Create room" }));
      await waitFor(() => expect(pathname.visited).toHaveLength(1));
      const [path = ""] = pathname.visited;
      expect(path).toMatch(drawn);
      expect(services.entryIntent.read(path.slice(1))).toEqual({ name: "Ana", look: "ff9ec7-0e1116-0", face: "^_^", listed: true });
    });

    test("without a name, one click opens the new room's door, which asks for it", async () => {
      const pathname = fakePathname();
      const services = fakeServices();
      renderWithApp(<HomePage />, { pathname, services });
      await userEvent.click(screen.getByRole("button", { name: "Create room" }));
      expect(pathname.visited).toHaveLength(1);
      expect(pathname.visited[0]).toMatch(drawn);
      expect(services.entryIntent.read(pathname.visited[0]!.slice(1))).toBeUndefined();
    });
  });

  describe("More options", () => {
    const more = () => screen.getByRole("button", { name: "More options" });
    const pane = () => screen.getByRole("region", { name: "More options" });
    const stage = () => document.querySelector("[data-stop]")!;

    test("push the page one stop, show the options beside the form and move focus to the first of them", async () => {
      renderWithApp(<HomePage />);
      expect(pane()).toHaveAttribute("inert");
      expect(more()).toHaveAttribute("aria-controls", pane().id);
      await userEvent.click(more());
      expect(stage()).toHaveAttribute("data-stop", "1");
      expect(stage()).toHaveAttribute("data-more");
      expect(pane()).not.toHaveAttribute("inert");
      expect(screen.getByLabelText("Your name")).toHaveFocus();
      expect(screen.getByRole("button", { name: "Create room" }).closest("[inert]")).toBeNull();
    });

    test("keep what was chosen while hidden and shown again", async () => {
      renderWithApp(<HomePage />);
      await userEvent.click(more());
      await userEvent.type(screen.getByLabelText("Room name"), "standup");
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      await userEvent.click(more());
      await userEvent.click(more());
      expect(screen.getByLabelText("Room name")).toHaveValue("standup");
      expect(screen.getByRole("radio", { name: /Private/ })).toBeChecked();
    });

    test("hide on Escape and return focus to the toggle", async () => {
      renderWithApp(<HomePage />);
      await userEvent.click(more());
      await userEvent.keyboard("{Escape}");
      expect(more()).toHaveAttribute("aria-expanded", "false");
      expect(more()).toHaveFocus();
      expect(stage()).toHaveAttribute("data-stop", "0");
      expect(pane()).toHaveAttribute("inert");
    });

    test("hide on Back and return focus to the toggle", async () => {
      renderWithApp(<HomePage />);
      await userEvent.click(more());
      await userEvent.click(within(pane()).getByRole("button", { name: "Back" }));
      expect(more()).toHaveAttribute("aria-expanded", "false");
      expect(more()).toHaveFocus();
    });

    test("start closed and open on a click, with the room's name and who may enter", async () => {
      renderWithApp(<HomePage />);
      expect(more()).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByLabelText("Room name").closest("[inert]")).not.toBeNull();
      await userEvent.click(more());
      expect(more()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByLabelText("Room name").closest("[inert]")).toBeNull();
      expect(screen.getByRole("radio", { name: /Public/ })).toBeChecked();
    });

    test("remember the name typed there for the room it leads to", async () => {
      const pathname = fakePathname();
      const services = fakeServices();
      renderWithApp(<HomePage />, { pathname, services });
      await userEvent.click(more());
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.type(screen.getByLabelText("Room name"), "standup{enter}");
      await waitFor(() => expect(pathname.visited).toEqual(["/standup"]));
      expect(services.nameMemory.read()).toBe("Ana");
      expect(services.entryIntent.read("standup")).toEqual({ name: "Ana", look: "ff9ec7-0e1116-0", face: "^_^", listed: true });
    });

    test("ask for a name before a private room is made", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.click(more());
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      await userEvent.click(screen.getByRole("button", { name: "Create room" }));
      expect(screen.getByLabelText("Your name")).toBeInvalid();
      expect(pathname.visited).toEqual([]);
    });

    test("a private room carries the room code shown, and is shown in the open rooms unless turned off", async () => {
      const pathname = fakePathname();
      const services = fakeServices({ generatePassword: () => "8ABH-23HK" });
      renderWithApp(<HomePage />, { pathname, services });
      expect(screen.getByLabelText("Room code").closest("[inert]")).not.toBeNull();
      await userEvent.click(more());
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.type(screen.getByLabelText("Room name"), "secret");
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      expect(screen.getByLabelText("Room code")).toHaveTextContent("8ABH-23HK");
      await userEvent.click(screen.getByRole("button", { name: "Create room" }));
      await waitFor(() => expect(pathname.visited).toEqual(["/secret"]));
      expect(services.entryIntent.read("secret")).toEqual({ name: "Ana", look: "ff9ec7-0e1116-0", face: "^_^", listed: true, verifier: "v:secret:8ABH-23HK", password: "8ABH-23HK" });
    });

    test("a room can be kept out of the open rooms", async () => {
      const pathname = fakePathname();
      const services = fakeServices();
      renderWithApp(<HomePage />, { pathname, services });
      await userEvent.click(more());
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.type(screen.getByLabelText("Room name"), "quiet");
      await userEvent.click(screen.getByRole("switch", { name: /Show in open rooms/ }));
      await userEvent.click(screen.getByRole("button", { name: "Create room" }));
      await waitFor(() => expect(pathname.visited).toEqual(["/quiet"]));
      expect(services.entryIntent.read("quiet")).toEqual({ name: "Ana", look: "ff9ec7-0e1116-0", face: "^_^", listed: false });
    });

    test("go to the room typed, normalising case", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.click(more());
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.type(screen.getByLabelText("Room name"), "  Stand-Up{enter}");
      await waitFor(() => expect(pathname.visited).toEqual(["/stand-up"]));
    });

    test("explain a room name the site cannot use, and open to show it", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.click(more());
      await userEvent.type(screen.getByLabelText("Room name"), "api");
      await userEvent.click(more());
      await userEvent.click(screen.getByRole("button", { name: "Create room" }));
      expect(more()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByLabelText("Room name")).toBeInvalid();
      expect(screen.getByText("The site keeps that name. Pick another one.")).toBeInTheDocument();
      expect(pathname.visited).toEqual([]);
    });
  });

  describe("joining from a link", () => {
    test("goes to the room of a pasted link, keeping its room code", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.type(screen.getByLabelText("Link or room name"), "https://live.test/standup#8ABH-23HK{enter}");
      expect(pathname.visited).toEqual(["/standup#8ABH-23HK"]);
    });

    test("goes to a room by its name alone", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.type(screen.getByLabelText("Link or room name"), "Standup");
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
      expect(pathname.visited).toEqual(["/standup"]);
    });

    test("explains what cannot be a room and stays", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.type(screen.getByLabelText("Link or room name"), "live.test/lobby{enter}");
      expect(screen.getByLabelText("Link or room name")).toBeInvalid();
      expect(screen.getByText("The site keeps that name. Pick another one.")).toBeInTheDocument();
      expect(pathname.visited).toEqual([]);
    });
  });

  test("leads to the open rooms without asking the server for them", () => {
    renderWithApp(<HomePage />);
    expect(screen.getByRole("link", { name: "See open rooms" })).toHaveAttribute("href", "/lobby");
  });

  describe("the conveyor", () => {
    const stage = () => document.querySelector("[data-stop]")!;
    const wrap = (view: "home" | "lobby" | "entry", panel: ReactNode = <p>the doorway</p>) => (
      <I18nProvider locale="en">
        <ServicesProvider services={services}>
          <NavigationProvider store={pathname}>
            <HomePage view={view} panel={panel} />
          </NavigationProvider>
        </ServicesProvider>
      </I18nProvider>
    );
    const services = fakeServices();
    const pathname = fakePathname();

    test("moves one stop for the open rooms and one more for a room entered from them, and the back button leads one stop back", () => {
      const { rerender } = render(wrap("home"));
      expect(stage()).toHaveAttribute("data-stop", "0");
      expect(screen.getByRole("link", { name: "See open rooms" })).toHaveAttribute("href", "/lobby");
      rerender(wrap("lobby"));
      expect(stage()).toHaveAttribute("data-stop", "1");
      expect(screen.getByRole("link", { name: "Back to enter" })).toHaveAttribute("href", "/");
      rerender(wrap("entry"));
      expect(stage()).toHaveAttribute("data-stop", "2");
      expect(screen.getByText("the doorway")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/lobby");
    });

    test("coming back from the open rooms lets them slide out before they leave", () => {
      const { rerender } = render(wrap("lobby"));
      rerender(wrap("home"));
      const rooms = screen.getByRole("heading", { name: "Open rooms" });
      expect(rooms.closest("[inert]")).not.toBeNull();
      fireEvent(rooms.closest(".slide-out-right")!, new Event("webkitAnimationEnd", { bubbles: true }));
      expect(screen.queryByRole("heading", { name: "Open rooms" })).not.toBeInTheDocument();
    });

    test("a doorway's options push it one stop further, and leaving the stop puts them away", async () => {
      const door = <EntryForm slug="demo" room={{ slug: "demo", exists: false, private: false, count: 0, capacity: 10 }} onEnter={() => undefined} />;
      const { rerender } = render(wrap("lobby"));
      rerender(wrap("entry", door));
      expect(stage()).toHaveAttribute("data-stop", "2");
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(stage()).toHaveAttribute("data-stop", "3");
      rerender(wrap("lobby"));
      expect(stage()).toHaveAttribute("data-stop", "1");
      expect(stage()).not.toHaveAttribute("data-more");
    });

    test("a room opened from its link starts at the first stop and leads back to the start", () => {
      render(wrap("entry"));
      expect(stage()).toHaveAttribute("data-stop", "0");
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
    });
  });
});
