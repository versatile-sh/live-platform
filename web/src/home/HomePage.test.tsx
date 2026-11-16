import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

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
    expect(services.nameMemory.read()).toBe("Ana");
    expect(pathname.visited).toEqual(["/standup"]);
  });

  test("leads to the open rooms without asking the server for them", () => {
    renderWithApp(<HomePage />);
    expect(screen.getByRole("link", { name: "See open rooms" })).toHaveAttribute("href", "/lobby");
  });

  describe("the room name field", () => {
    test("goes to the room for a valid name, normalising case", async () => {
      const pathname = fakePathname();
      renderWithApp(<HomePage />, { pathname });
      await userEvent.type(screen.getByLabelText("Room name"), "  Stand-Up{enter}");
      expect(pathname.visited).toEqual(["/stand-up"]);
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
});
