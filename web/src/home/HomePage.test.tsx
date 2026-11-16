import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { NavigationProvider } from "../routing/Navigation";
import { ServicesProvider } from "../services";
import { fakePathname, fakeServices, renderWithApp } from "../test-support/render";
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

  test("remembers the name typed here for the room it leads to", async () => {
    const pathname = fakePathname();
    const services = fakeServices();
    renderWithApp(<HomePage />, { pathname, services });
    await userEvent.type(screen.getByLabelText("Your name"), "Ana");
    await userEvent.type(screen.getByLabelText("Room name"), "standup{enter}");
    await waitFor(() => expect(pathname.visited).toEqual(["/standup"]));
    expect(services.nameMemory.read()).toBe("Ana");
    expect(services.entryIntent.read("standup")).toEqual({ name: "Ana", look: 34, listed: true });
  });

  test("asks for a name before going anywhere", async () => {
    const pathname = fakePathname();
    renderWithApp(<HomePage />, { pathname });
    await userEvent.type(screen.getByLabelText("Room name"), "standup{enter}");
    expect(screen.getByLabelText("Your name")).toBeInvalid();
    expect(pathname.visited).toEqual([]);
  });

  test("a private room carries the room code shown, and is shown in the open rooms unless turned off", async () => {
    const pathname = fakePathname();
    const services = fakeServices({ generatePassword: () => "8ABH-23HK" });
    renderWithApp(<HomePage />, { pathname, services });
    await userEvent.type(screen.getByLabelText("Your name"), "Ana");
    await userEvent.type(screen.getByLabelText("Room name"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByLabelText("Room code")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
    expect(screen.getByLabelText("Room code")).toHaveTextContent("8ABH-23HK");
    await userEvent.click(screen.getByRole("button", { name: /Enter/ }));
    await waitFor(() => expect(pathname.visited).toEqual(["/secret"]));
    expect(services.entryIntent.read("secret")).toEqual({ name: "Ana", look: 34, listed: true, verifier: "v:secret:8ABH-23HK", password: "8ABH-23HK" });
  });

  test("a room can be kept out of the open rooms", async () => {
    const pathname = fakePathname();
    const services = fakeServices();
    renderWithApp(<HomePage />, { pathname, services });
    await userEvent.type(screen.getByLabelText("Your name"), "Ana");
    await userEvent.type(screen.getByLabelText("Room name"), "quiet");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("switch", { name: /Show in open rooms/ }));
    await userEvent.click(screen.getByRole("button", { name: /Enter/ }));
    await waitFor(() => expect(pathname.visited).toEqual(["/quiet"]));
    expect(services.entryIntent.read("quiet")).toEqual({ name: "Ana", look: 34, listed: false });
  });

  test("leads to the open rooms without asking the server for them", () => {
    renderWithApp(<HomePage />);
    expect(screen.getByRole("link", { name: "See open rooms" })).toHaveAttribute("href", "/lobby");
  });

  describe("the room name field", () => {
    test("goes to the room for a valid name, normalising case", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.type(screen.getByLabelText("Your name"), "Ana");
      await userEvent.type(screen.getByLabelText("Room name"), "  Stand-Up{enter}");
      await waitFor(() => expect(pathname.visited).toEqual(["/stand-up"]));
    });

    test("explains an invalid name and does not navigate", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.type(screen.getByLabelText("Room name"), "api{enter}");
      expect(screen.getByLabelText("Room name")).toBeInvalid();
      expect(screen.getByText("The site keeps that name. Pick another one.")).toBeInTheDocument();
      expect(pathname.visited).toEqual([]);
    });
  });

  describe("the conveyor", () => {
    const stage = () => document.querySelector("[data-stop]")!;
    const wrap = (view: "home" | "lobby" | "entry") => (
      <I18nProvider locale="en">
        <ServicesProvider services={services}>
          <NavigationProvider store={pathname}>
            <HomePage view={view} panel={<p>the doorway</p>} />
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

    test("a room opened from its link starts at the first stop and leads back to the start", () => {
      render(wrap("entry"));
      expect(stage()).toHaveAttribute("data-stop", "0");
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
    });
  });
});
