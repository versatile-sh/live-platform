import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { fakeServices, renderWithApp, staticLobby } from "../test-support/render";
import { LobbyPage } from "./LobbyPage";

const room = (over: object) => ({ slug: "standup", exists: true, private: false, count: 3, capacity: 10, ...over });

describe("LobbyPage", () => {
  describe("with no listed rooms", () => {
    test("says how to start one", () => {
      renderWithApp(<LobbyPage />);
      expect(screen.getByText("No open rooms right now.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create a room" })).toHaveAttribute("href", "/");
    });

    test("speaks Portuguese for a pt-BR visitor", () => {
      renderWithApp(<LobbyPage />, { locale: "pt-BR" });
      expect(screen.getByText("Nenhuma sala aberta agora.")).toBeInTheDocument();
    });
  });

  describe("on the map with no rooms", () => {
    test("says so over the map and offers to create one", async () => {
      renderWithApp(<LobbyPage />);
      await userEvent.click(screen.getByRole("button", { name: "Map" }));
      expect(screen.getByText("No open rooms right now.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create a room" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Larger map" })).not.toBeInTheDocument();
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

  describe("the map", () => {
    const services = () => fakeServices({ lobby: staticLobby({ status: "ready", rooms: [room({ country: "BR" }), room({ slug: "tokyo", country: "JP" }), room({ slug: "nowhere" })] }) });

    test("draws the countries that have open rooms and filters the list by the one picked", async () => {
      renderWithApp(<LobbyPage />, { services: services() });
      await userEvent.click(screen.getByRole("button", { name: "Map" }));
      const brazil = await screen.findByRole("button", { name: "Brazil, 1 open rooms" });
      expect(screen.getByRole("button", { name: "Japan, 1 open rooms" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Enter room standup" })).not.toBeInTheDocument();
      await userEvent.click(brazil);
      expect(brazil).toHaveAttribute("aria-pressed", "true");
      const country = screen.getByRole("dialog", { name: "Open rooms in Brazil." });
      expect(within(country).getByRole("link", { name: "Enter room standup" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Enter room tokyo" })).not.toBeInTheDocument();
      await userEvent.click(within(country).getByRole("button", { name: "Close this country" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("can be worked from the keyboard", async () => {
      renderWithApp(<LobbyPage />, { services: services() });
      await userEvent.click(screen.getByRole("button", { name: "Map" }));
      const japan = await screen.findByRole("button", { name: "Japan, 1 open rooms" });
      japan.focus();
      await userEvent.keyboard("{Enter}");
      expect(screen.getByRole("link", { name: "Enter room tokyo" })).toBeInTheDocument();
    });
  });
});
