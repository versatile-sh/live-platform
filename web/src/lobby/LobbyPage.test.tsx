import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { fakePathname, fakeServices, renderWithApp, staticLobby } from "../test-support/render";
import { LobbyPage } from "./LobbyPage";

const room = (over: object) => ({ slug: "standup", exists: true, private: false, count: 3, capacity: 10, ...over });

describe("LobbyPage", () => {
  describe("with no listed rooms", () => {
    test("says how to start one", () => {
      renderWithApp(<LobbyPage />);
      expect(screen.getByText("No listed rooms right now.")).toBeInTheDocument();
      expect(screen.getByText(/type a name above and go/)).toBeInTheDocument();
    });

    test("speaks Portuguese for a pt-BR visitor", () => {
      renderWithApp(<LobbyPage />, { locale: "pt-BR" });
      expect(screen.getByText("Nenhuma sala listada agora.")).toBeInTheDocument();
    });
  });

  describe("with listed rooms", () => {
    const services = () => fakeServices({ lobby: staticLobby({ status: "ready", rooms: [room({ country: "BR" }), room({ slug: "crowd", count: 10, capacity: 10 })] }) });

    test("shows each room with its people and country", () => {
      renderWithApp(<LobbyPage />, { services: services() });
      const link = screen.getByRole("link", { name: "Enter room standup" });
      expect(link).toHaveAttribute("href", "/standup");
      expect(link).toHaveTextContent("BR");
      expect(link).toHaveTextContent("3/10 people");
    });

    test("marks a full room as full in text", () => {
      renderWithApp(<LobbyPage />, { services: services() });
      expect(screen.getByRole("link", { name: "Enter room crowd" })).toHaveTextContent("full");
    });
  });

  describe("when a refresh fails", () => {
    test("keeps the rooms and says so", () => {
      renderWithApp(<LobbyPage />, { services: fakeServices({ lobby: staticLobby({ status: "failed", rooms: [room({})] }) }) });
      expect(screen.getByRole("link", { name: "Enter room standup" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Could not reach the server. Trying again.");
    });
  });

  describe("the room name field", () => {
    test("goes to the room for a valid name, normalising case", async () => {
      const pathname = fakePathname();
      renderWithApp(<LobbyPage />, { pathname });
      await userEvent.type(screen.getByLabelText("Room name"), "  Stand-Up{enter}");
      expect(pathname.visited).toEqual(["/stand-up"]);
    });

    test("explains an invalid name and does not navigate", async () => {
      const pathname = fakePathname();
      renderWithApp(<LobbyPage />, { pathname });
      await userEvent.type(screen.getByLabelText("Room name"), "api{enter}");
      expect(screen.getByLabelText("Room name")).toBeInvalid();
      expect(screen.getByText("The site keeps that name. Pick another one.")).toBeInTheDocument();
      expect(pathname.visited).toEqual([]);
    });
  });
});
