import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import type { RoomSummary, StatusResult } from "../api/rooms";
import { writeSeat } from "../session/seat";
import type { FakeSocket } from "../signal/fake-socket";
import type { Person } from "../signal/protocol";
import { fakePathname, fakeServices, renderWithAppSettled } from "../test-support/render";
import { RoomPage } from "./RoomPage";

const free: RoomSummary = { slug: "demo", exists: false, private: false, count: 0, capacity: 10 };
const person = (pid: number, name: string, over: Partial<Person> = {}): Person => ({ pid, slot: pid - 1, name, state: "connecting", flags: 0, ...over });

async function setup(status: StatusResult = { kind: "ok", room: free }, extra: Partial<Parameters<typeof fakeServices>[0]> = {}) {
  const services = fakeServices({ roomsApi: { status: async () => status, lobby: async () => ({ kind: "unreachable" }) }, ...extra });
  const pathname = fakePathname("/demo");
  await renderWithAppSettled(<RoomPage slug="demo" />, { services, pathname });
  return { services, pathname };
}

async function submitName(name = "Ana", button = "Create and enter") {
  await userEvent.type(await screen.findByLabelText("Your name"), name);
  await userEvent.click(screen.getByRole("button", { name: button }));
}

async function socketOf(services: { sockets: FakeSocket[] }, index = 0): Promise<FakeSocket> {
  await waitFor(() => expect(services.sockets.length).toBeGreaterThan(index));
  return services.sockets[index]!;
}

const send = (socket: FakeSocket, frame: unknown) => act(() => socket.serverSend(frame));
const joinAs = (socket: FakeSocket, pid = 1, secret = "s1") =>
  act(() => {
    socket.serverOpen();
    socket.serverSend({ t: "joined", pid, gen: 1, secret });
  });

describe("RoomPage", () => {
  describe("while asking about the room", () => {
    test("says it is checking", async () => {
      await renderWithAppSettled(<RoomPage slug="demo" />, { services: fakeServices({ roomsApi: { status: () => new Promise(() => undefined), lobby: async () => ({ kind: "unreachable" }) } }) });
      expect(screen.getByRole("status")).toHaveTextContent("Checking the room");
    });
  });

  describe("when the server cannot be reached", () => {
    test("offers to try again", async () => {
      await setup({ kind: "unreachable" });
      expect(await screen.findByRole("heading", { name: "Could not reach the server" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });
  });

  describe("when a free slug is entered", () => {
    test("shows the roster as tiles, marks me and the owner, and labels a connecting person", async () => {
      const { services } = await setup();
      await submitName("Ana");
      const socket = await socketOf(services);
      await joinAs(socket);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32 })], gone: [] });
      const tile = (await screen.findByText("Ana")).closest("li")!;
      expect(within(tile).getByText("you")).toBeInTheDocument();
      expect(within(tile).getByText("owner")).toBeInTheDocument();
      expect(within(tile).getByText("connecting")).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("Connected");
    });

    test("tells the visitor that what they capture stays on their device for now", async () => {
      const { services } = await setup();
      await submitName("Ana");
      await joinAs(await socketOf(services));
      expect(await screen.findByText(/stay on this device for now/)).toBeInTheDocument();
    });

    test("lists people in slot order", async () => {
      const { services } = await setup();
      await submitName("Ana");
      const socket = await socketOf(services);
      await joinAs(socket);
      await send(socket, { t: "roster", v: 2, people: [person(2, "Bia"), person(1, "Ana", { flags: 32 })], gone: [] });
      const names = (await screen.findAllByRole("listitem")).map((li) => li.textContent).filter((text) => /Ana|Bia/.test(text ?? ""));
      expect(names[0]).toContain("Ana");
      expect(names[1]).toContain("Bia");
    });

    test("sends the join with the listed choice", async () => {
      const { services } = await setup();
      await userEvent.click(await screen.findByLabelText("Show in the lobby"));
      await submitName("Ana");
      const socket = await socketOf(services);
      act(() => socket.serverOpen());
      expect(JSON.parse(socket.sent[0]!)).toEqual({ t: "join", slug: "demo", name: "Ana", listed: true });
    });
  });

  describe("when people change", () => {
    async function inRoom() {
      const ctx = await setup({ kind: "ok", room: { ...free, exists: true, count: 1 } });
      await submitName("Ana", "Enter room");
      const socket = await socketOf(ctx.services);
      await joinAs(socket, 2);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32 }), person(2, "Bia")], gone: [] });
      await screen.findByText("Bia");
      return { ...ctx, socket };
    }

    test("announces an arrival", async () => {
      const { socket } = await inRoom();
      await send(socket, { t: "roster", v: 3, people: [person(1, "Ana", { flags: 32 }), person(2, "Bia"), person(3, "Caio")], gone: [] });
      expect(await screen.findByText("Caio joined")).toBeInTheDocument();
    });

    test("announces a departure with the reason in plain words", async () => {
      const { socket } = await inRoom();
      await send(socket, { t: "roster", v: 3, people: [person(2, "Bia")], gone: [{ pid: 1, reason: "media-timeout" }] });
      expect(await screen.findByText("Ana never got audio and video connected")).toBeInTheDocument();
    });

    test("labels a reconnecting person at once and dims the tile", async () => {
      const { socket } = await inRoom();
      await send(socket, { t: "roster", v: 3, people: [person(1, "Ana", { flags: 32 }), person(2, "Bia", { state: "reconnecting" })], gone: [] });
      const tile = screen.getByText("Bia").closest("li")!;
      await waitFor(() => expect(within(tile).getByText("reconnecting")).toBeInTheDocument());
      expect(tile).toHaveAttribute("data-tone", "dim");
    });

    test("labels an unstable person", async () => {
      const { socket } = await inRoom();
      await send(socket, { t: "roster", v: 3, people: [person(1, "Ana", { flags: 32 }), person(2, "Bia", { flags: 64 })], gone: [] });
      const tile = screen.getByText("Bia").closest("li")!;
      await waitFor(() => expect(within(tile).getByText("unstable")).toBeInTheDocument());
    });
  });

  describe("when my connection drops", () => {
    test("says so at once and keeps the roster", async () => {
      const { services } = await setup();
      await submitName("Ana");
      const socket = await socketOf(services);
      await joinAs(socket);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32 })], gone: [] });
      await screen.findByText("Ana");
      act(() => socket.serverClose(1006));
      expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("Your connection dropped, trying to return.");
      expect(screen.getByText("Ana")).toBeInTheDocument();
      const retry = await socketOf(services, 1);
      act(() => retry.serverOpen());
      expect(JSON.parse(retry.sent[0]!)).toEqual({ t: "resume", slug: "demo", pid: 1, secret: "s1" });
    });

    test.each([
      [4001, "You opened this room somewhere else"],
      [4403, "You were removed from the room"],
      [4429, "Disconnected for sending too much"],
    ] as const)("code %i ends with its own message and a way back", async (code, title) => {
      const { services } = await setup();
      await submitName("Ana");
      const socket = await socketOf(services);
      await joinAs(socket);
      act(() => socket.serverClose(code));
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Rejoin" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to the start" })).toHaveAttribute("href", "/");
    });

    test("rejoin enters again with the same name", async () => {
      const { services } = await setup();
      await submitName("Ana");
      const socket = await socketOf(services);
      await joinAs(socket);
      act(() => socket.serverClose(4001));
      await userEvent.click(await screen.findByRole("button", { name: "Rejoin" }));
      const next = await socketOf(services, 1);
      act(() => next.serverOpen());
      expect(JSON.parse(next.sent[0]!)).toMatchObject({ t: "join", name: "Ana" });
    });
  });

  describe("when the entry is refused", () => {
    test("returns to the form with the reason and keeps the typed name", async () => {
      const { services } = await setup({ kind: "ok", room: { ...free, exists: true, private: true, count: 1 } });
      await userEvent.type(await screen.findByLabelText("Your name"), "Eve");
      await userEvent.type(screen.getByLabelText("Password"), "wrongpass1");
      await userEvent.click(screen.getByRole("button", { name: "Enter room" }));
      const socket = await socketOf(services);
      act(() => socket.serverOpen());
      await send(socket, { t: "error", code: "PERMISSION_DENIED", message: "needs password" });
      act(() => socket.serverClose(4400));
      expect(await screen.findByRole("alert")).toHaveTextContent("That password did not open the room");
      expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    });
  });

  describe("when the page reloads inside the grace", () => {
    test("resumes the stored seat without asking again", async () => {
      const services = fakeServices({ roomsApi: { status: async () => ({ kind: "ok", room: { ...free, exists: true, count: 1 } }), lobby: async () => ({ kind: "unreachable" }) } });
      writeSeat(services.seatStorage, "demo", { pid: 4, secret: "abc", private: false });
      await renderWithAppSettled(<RoomPage slug="demo" />, { services });
      const socket = await socketOf(services);
      act(() => socket.serverOpen());
      expect(JSON.parse(socket.sent[0]!)).toEqual({ t: "resume", slug: "demo", pid: 4, secret: "abc" });
      expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    });

    test("falls back to the form when the place is gone", async () => {
      const services = fakeServices({ roomsApi: { status: async () => ({ kind: "ok", room: { ...free, exists: true, count: 1 } }), lobby: async () => ({ kind: "unreachable" }) } });
      writeSeat(services.seatStorage, "demo", { pid: 4, secret: "abc", private: false });
      await renderWithAppSettled(<RoomPage slug="demo" />, { services });
      const socket = await socketOf(services);
      act(() => socket.serverOpen());
      await send(socket, { t: "error", code: "NOT_FOUND", message: "participant not found" });
      act(() => socket.serverClose(4400));
      expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
      expect(screen.getByText(/the room let your place go/)).toBeInTheDocument();
    });
  });

  describe("when the page is hidden for good", () => {
    test("leaves the room", async () => {
      let hide: () => void = () => undefined;
      const { services } = await setup(undefined, { pageLifecycle: { onPageHide: (listener) => ((hide = listener), () => undefined) } });
      await submitName("Ana");
      const socket = await socketOf(services);
      await joinAs(socket);
      act(() => hide());
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "leave" });
    });
  });

  describe("the leave button", () => {
    test("tells the server, then goes to the lobby", async () => {
      const { services, pathname } = await setup();
      await submitName("Ana");
      const socket = await socketOf(services);
      await joinAs(socket);
      await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "leave" });
      expect(pathname.visited).toEqual(["/"]);
    });
  });

  describe("the owner's controls", () => {
    async function asOwner(status: StatusResult = { kind: "ok", room: free }) {
      const ctx = await setup(status, { generatePassword: () => "8ABH-23HK" });
      await submitName("Ana");
      const socket = await socketOf(ctx.services);
      await joinAs(socket);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32 }), person(2, "Bia")], gone: [] });
      await screen.findAllByText("Bia");
      return { ...ctx, socket };
    }
    const sent = (socket: FakeSocket, count: number) => socket.sent.slice(-count).map((frame) => JSON.parse(frame) as unknown);

    test("remove and transfer are offered in the people panel, on other people only", async () => {
      const { socket } = await asOwner();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      expect(screen.queryByRole("button", { name: "Remove Ana" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Remove Bia" }));
      await userEvent.click(screen.getByRole("button", { name: "Make Bia the owner" }));
      expect(sent(socket, 2)).toEqual([
        { t: "owner", op: "remove", pid: 2 },
        { t: "owner", op: "transfer", pid: 2 },
      ]);
    });

    test("do not appear for someone who is not the owner", async () => {
      const ctx = await setup({ kind: "ok", room: { ...free, exists: true, count: 1 } });
      await submitName("Bia", "Enter room");
      const socket = await socketOf(ctx.services);
      await joinAs(socket, 2);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32 }), person(2, "Bia")], gone: [] });
      await screen.findAllByText("Ana");
      expect(screen.queryByRole("button", { name: "Room settings" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    });

    test("making the room public lists it, and its link is plain", async () => {
      const { socket, services } = await asOwner();
      await userEvent.click(screen.getByRole("button", { name: "Room settings" }));
      await userEvent.click(screen.getByRole("radio", { name: /Public/ }));
      expect(sent(socket, 1)).toEqual([{ t: "owner", op: "listed", listed: true }]);
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
      expect(services.copied.at(-1)).toBe("https://live.test/demo");
    });

    test("making it private again unlists it and locks it with a room code that the link carries", async () => {
      const { socket, services } = await asOwner();
      await userEvent.click(screen.getByRole("button", { name: "Room settings" }));
      await userEvent.click(screen.getByRole("radio", { name: /Public/ }));
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      await waitFor(() =>
        expect(sent(socket, 2)).toEqual([
          { t: "owner", op: "listed", listed: false },
          { t: "owner", op: "password", verifier: "v:demo:8ABH-23HK" },
        ]),
      );
      expect(await screen.findByLabelText("Password")).toHaveTextContent("8ABH-23HK");
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
      expect(services.copied.at(-1)).toBe("https://live.test/demo#8ABH-23HK");
      expect(screen.getByText(/after the # sign/)).toBeInTheDocument();
    });

    test("turning the password off sends an owner frame with no verifier, and a new code sends its verifier", async () => {
      const { socket, services } = await asOwner();
      await userEvent.click(screen.getByRole("button", { name: "Room settings" }));
      await userEvent.click(screen.getByRole("switch", { name: "Ask for a password" }));
      await waitFor(() => expect(sent(socket, 1)).toEqual([{ t: "owner", op: "password", verifier: "v:demo:8ABH-23HK" }]));
      services.generatePassword = () => "9XYZ-45QR";
      await userEvent.click(await screen.findByRole("button", { name: "New" }));
      await waitFor(() => expect(sent(socket, 1)).toEqual([{ t: "owner", op: "password", verifier: "v:demo:9XYZ-45QR" }]));
      await userEvent.click(screen.getByRole("switch", { name: "Ask for a password" }));
      expect(sent(socket, 1)).toEqual([{ t: "owner", op: "password" }]);
    });

    test("show a refusal in words when the server will not do it", async () => {
      const { socket } = await asOwner();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      await userEvent.click(screen.getByRole("button", { name: "Remove Bia" }));
      await send(socket, { t: "error", code: "INVARIANT_VIOLATION", message: "only the active owner may do this" });
      expect(await screen.findByText(/Only the owner can do it, and only once their own connection is fully up/)).toBeInTheDocument();
    });
  });

  describe("the call", () => {
    async function inCall(extra: Partial<Parameters<typeof fakeServices>[0]> = {}) {
      const ctx = await setup({ kind: "ok", room: free }, extra);
      await submitName("Ana");
      const socket = await socketOf(ctx.services);
      await joinAs(socket);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32, state: "active" }), person(2, "Bia", { state: "active" })], gone: [] });
      return { ...ctx, socket };
    }

    test("shows the room name, the chat with how many are here, and no way to other rooms", async () => {
      await inCall();
      expect(screen.getByRole("heading", { level: 1, name: "demo" })).toBeInTheDocument();
      expect(within(screen.getByRole("complementary", { name: "Chat" })).getByText("2 here")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /open rooms/i })).not.toBeInTheDocument();
    });

    test("sends what I type to the room and shows what the room says, mine and theirs", async () => {
      const { socket } = await inCall();
      await userEvent.type(screen.getByLabelText("Message to the room"), "hello{enter}");
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "chat", text: "hello" });
      expect(screen.getByLabelText("Message to the room")).toHaveValue("");
      await send(socket, { t: "chat", pid: 1, name: "Ana", text: "hello", at: 1_700_000_000_000 });
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "hi Ana", at: 1_700_000_001_000 });
      const log = within(screen.getByRole("list", { name: "Messages" }));
      expect(log.getByText("hello")).toBeInTheDocument();
      expect(log.getByText("hi Ana")).toBeInTheDocument();
      expect(log.getByText("Bia")).toBeInTheDocument();
    });

    test("counts unread messages on the chat button while the panel shows something else", async () => {
      const { socket } = await inCall();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "anyone?", at: 1_700_000_001_000 });
      expect(screen.getByRole("button", { name: "Chat" })).toHaveTextContent("1");
      await userEvent.click(screen.getByRole("button", { name: "Chat" }));
      expect(screen.getByRole("button", { name: "Chat" })).not.toHaveTextContent("1");
    });

    test("turning the microphone on asks the browser and tells the room, and raising a hand tells it too", async () => {
      const track = { stop: () => undefined, addEventListener: () => undefined };
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
      const asked: MediaStreamConstraints[] = [];
      const { socket } = await inCall({
        mediaDevices: {
          user: async (constraints) => {
            asked.push(constraints);
            return stream;
          },
          display: async () => stream,
        },
      });
      await userEvent.click(screen.getByRole("button", { name: "Turn microphone on" }));
      await waitFor(() => expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "media", flags: 1 }));
      expect(asked[0]).toHaveProperty("audio");
      expect(screen.getByRole("button", { name: "Turn microphone off" })).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(screen.getByRole("button", { name: "Raise your hand" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "media", flags: 17 });
    });

    test("says in words when the browser refuses the camera", async () => {
      await inCall({
        mediaDevices: {
          user: async () => Promise.reject(new DOMException("no", "NotAllowedError")),
          display: async () => Promise.reject(new DOMException("no", "NotAllowedError")),
        },
      });
      await userEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
      expect(await screen.findByText(/The browser refused the camera/)).toBeInTheDocument();
    });
  });
});
