import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { fakeServices, renderWithApp, staticLobby } from "../test-support/render";
import { LobbyPage } from "./LobbyPage";

const room = (over: object) => ({ slug: "standup", exists: true, private: false, count: 3, capacity: 10, ...over });

describe("LobbyPage", () => {
  describe("with no listed rooms", () => {
    test("says how to start one", () => {
      renderWithApp(<LobbyPage />);
      expect(screen.getByText("No listed rooms right now.")).toBeInTheDocument();
      expect(screen.getByText(/Go back and type a name/)).toBeInTheDocument();
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
});
