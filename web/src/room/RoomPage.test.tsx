import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../media/settings";

vi.mock("../board/Whiteboard", () => ({ default: ({ readOnly }: { readOnly?: boolean }) => (readOnly ? "the drawing surface, to look at" : "the drawing surface") }));
vi.mock("../board/BoardPreview", () => ({ default: () => "a small picture of the board" }));

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
  await userEvent.click(within(screen.getByRole("form", { name: /^(Create|Join) demo$/ })).getByRole("button", { name: button }));
}

async function socketOf(services: { sockets: FakeSocket[] }, index = 0): Promise<FakeSocket> {
  await waitFor(() => expect(services.sockets.length).toBeGreaterThan(index));
  return services.sockets[index]!;
}

async function fromMore(name: string | RegExp, role: "menuitem" | "menuitemcheckbox" = "menuitem") {
  await userEvent.click(screen.getByRole("button", { name: "More options" }));
  await userEvent.click(screen.getByRole(role, { name }));
}

function screenWidth(start: "phone" | "wide") {
  const changes = new Set<() => void>();
  let phone = start === "phone";
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return phone && query.includes("max-width");
    },
    addEventListener: (_type: string, change: () => void) => changes.add(change),
    removeEventListener: (_type: string, change: () => void) => changes.delete(change),
  }));
  return {
    narrow: () =>
      act(() => {
        phone = true;
        changes.forEach((change) => change());
      }),
  };
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
      await userEvent.click(await screen.findByRole("switch", { name: /Show in open rooms/ }));
      await submitName("Ana");
      const socket = await socketOf(services);
      act(() => socket.serverOpen());
      expect(JSON.parse(socket.sent[0]!)).toEqual({ t: "join", slug: "demo", name: "Ana", listed: true, look: "ff9ec7-0e1116-0", face: "^_^" });
    });
  });

  describe("when I am alone in the room", () => {
    async function alone() {
      const ctx = await setup();
      await submitName("Ana");
      const socket = await socketOf(ctx.services);
      await joinAs(socket);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32, state: "active" })], gone: [] });
      return { ...ctx, socket };
    }

    test("the stage invites someone with the room's link, and copies it on a click", async () => {
      const { services } = await alone();
      expect(screen.getByRole("heading", { name: "Nobody else is here yet" })).toBeInTheDocument();
      expect(screen.getByText("https://live.test/demo")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
      expect(services.copied).toEqual(["https://live.test/demo"]);
      expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument();
    });

    test("the invitation gives way when someone arrives", async () => {
      const { socket } = await alone();
      await send(socket, { t: "roster", v: 3, people: [person(1, "Ana", { flags: 32, state: "active" }), person(2, "Bia", { state: "active" })], gone: [] });
      expect(screen.queryByRole("heading", { name: "Nobody else is here yet" })).not.toBeInTheDocument();
      expect(screen.getByRole("listitem", { name: /Bia, connected/ })).toBeInTheDocument();
    });
  });

  describe("when people change", () => {
    async function inRoom() {
      const ctx = await setup({ kind: "ok", room: { ...free, exists: true, count: 1 } });
      await submitName("Ana", "Enter");
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
      await userEvent.type(screen.getByLabelText("Room code"), "wrongpass1");
      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
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

    test("kick, ban and transfer are offered in the people panel, on other people only", async () => {
      const { socket } = await asOwner();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      expect(screen.queryByRole("button", { name: "Kick Ana" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Ban Ana" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Kick Bia" }));
      await userEvent.click(screen.getByRole("button", { name: "Ban Bia" }));
      await userEvent.click(screen.getByRole("button", { name: "Make Bia the owner" }));
      expect(sent(socket, 3)).toEqual([
        { t: "owner", op: "remove", pid: 2 },
        { t: "owner", op: "ban", pid: 2 },
        { t: "owner", op: "transfer", pid: 2 },
      ]);
    });

    test("do not appear for someone who is not the owner", async () => {
      const ctx = await setup({ kind: "ok", room: { ...free, exists: true, count: 1 } });
      await submitName("Bia", "Enter");
      const socket = await socketOf(ctx.services);
      await joinAs(socket, 2);
      await send(socket, { t: "roster", v: 2, people: [person(1, "Ana", { flags: 32 }), person(2, "Bia")], gone: [] });
      await screen.findAllByText("Ana");
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.queryByRole("menuitem", { name: "Room settings" })).not.toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    });

    test("a public room has a plain link, and the open rooms switch sends the listing", async () => {
      const { socket, services } = await asOwner();
      await fromMore("Room settings");
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
      expect(services.copied.at(-1)).toBe("https://live.test/demo");
      expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("switch", { name: /Show in open rooms/ }));
      expect(sent(socket, 1)).toEqual([{ t: "owner", op: "listed", listed: true }]);
    });

    test("making it private locks it with a room code that the link carries, without touching the listing", async () => {
      const { socket, services } = await asOwner();
      await fromMore("Room settings");
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      await waitFor(() => expect(sent(socket, 1)).toEqual([{ t: "owner", op: "password", verifier: "v:demo:8ABH-23HK" }]));
      expect(await screen.findByLabelText("Room code")).toHaveTextContent("8ABH-23HK");
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
      expect(services.copied.at(-1)).toBe("https://live.test/demo#8ABH-23HK");
      expect(screen.getByText(/after the # sign/)).toBeInTheDocument();
    });

    test("a new code sends its verifier, and going back to public sends an owner frame with none", async () => {
      const { socket, services } = await asOwner();
      await fromMore("Room settings");
      await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
      services.generatePassword = () => "9XYZ-45QR";
      await userEvent.click(await screen.findByRole("button", { name: "New" }));
      await waitFor(() => expect(sent(socket, 1)).toEqual([{ t: "owner", op: "password", verifier: "v:demo:9XYZ-45QR" }]));
      await userEvent.click(screen.getByRole("radio", { name: /Public/ }));
      expect(sent(socket, 1)).toEqual([{ t: "owner", op: "password" }]);
    });

    test("show a refusal in words when the server will not do it", async () => {
      const { socket } = await asOwner();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      await userEvent.click(screen.getByRole("button", { name: "Kick Bia" }));
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

    const panels = () => within(screen.getByRole("group", { name: "Side panels" }));

    test("keeps the microphone, the camera, the screen, the hand, visibility and leave on the bar, with invite apart", async () => {
      await inCall();
      const bar = within(screen.getByRole("toolbar", { name: "Call controls" }));
      expect(bar.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
        "Turn microphone on",
        "Microphone options",
        "Turn camera on",
        "Camera options",
        "Share your screen",
        "Screen options",
        "Raise your hand",
        "Visibility options",
        "Leave",
      ]);
      expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
    });

    test("groups everything else under More options, with the owner's room settings", async () => {
      await inCall();
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      const menu = within(screen.getByRole("menu", { name: "More options" }));
      expect(menu.getByRole("menuitemcheckbox", { name: "Whiteboard" })).toBeInTheDocument();
      for (const name of ["Room settings", "Sound and video settings", "How you appear", "Visibility options", "Connection quality", "Keyboard shortcuts", /Search for something to do/]) {
        expect(menu.getByRole("menuitem", { name })).toBeInTheDocument();
      }
    });

    test("closes More options on Escape and gives the focus back to its button", async () => {
      await inCall();
      const more = screen.getByRole("button", { name: "More options" });
      await userEvent.click(more);
      expect(screen.getByRole("menuitemcheckbox", { name: "Whiteboard" })).toHaveFocus();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(more).toHaveAttribute("aria-expanded", "false");
      expect(more).toHaveFocus();
    });

    test("invite copies the room's link and says so where it can be seen", async () => {
      const { services } = await inCall();
      await userEvent.click(screen.getByRole("button", { name: "Invite" }));
      expect(services.copied.at(-1)).toBe("https://live.test/demo");
      expect(screen.getByText("Link copied")).toBeVisible();
    });

    test("invite shows the link to copy by hand when the browser will not copy", async () => {
      await inCall({ clipboard: { write: async () => false } });
      await userEvent.click(screen.getByRole("button", { name: "Invite" }));
      expect(screen.getByText("The browser did not copy it. Copy this link: https://live.test/demo")).toBeInTheDocument();
    });

    describe("on a phone", () => {
      afterEach(() => vi.unstubAllGlobals());

      test("starts with the side panel closed so the stage shows", async () => {
        screenWidth("phone");
        await inCall();
        expect(panels().getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      test("opens the chat as a window over the stage that closes on its button and gives focus back", async () => {
        screenWidth("phone");
        await inCall();
        await userEvent.click(panels().getByRole("button", { name: "Chat" }));
        const chat = within(screen.getByRole("dialog", { name: "Chat" }));
        expect(chat.getByLabelText("Message to the room")).toBeInTheDocument();
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
        await userEvent.click(chat.getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(panels().getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "false");
        expect(panels().getByRole("button", { name: "Chat" })).toHaveFocus();
      });

      test("closes the open side panel when the window narrows to a phone", async () => {
        const width = screenWidth("wide");
        await inCall();
        expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();
        await width.narrow();
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(panels().getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "false");
      });
    });

    test("shows the room name, the chat open, and no way to other rooms", async () => {
      await inCall();
      expect(screen.getByRole("heading", { level: 1, name: "demo" })).toBeInTheDocument();
      expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();
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
      expect(panels().getByRole("button", { name: "Chat" })).toHaveTextContent("1");
      await userEvent.click(panels().getByRole("button", { name: "Chat" }));
      expect(panels().getByRole("button", { name: "Chat" })).not.toHaveTextContent("1");
    });

    test("shows the last two new messages in a balloon while the chat is hidden, until it is closed or the chat opens", async () => {
      const { socket } = await inCall();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "one", at: 1_700_000_001_000 });
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "two", at: 1_700_000_002_000 });
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "three", at: 1_700_000_003_000 });
      await waitFor(() => expect(screen.queryByText("one")).not.toBeInTheDocument());
      expect(screen.getByText("two")).toBeInTheDocument();
      expect(screen.getByText("three")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Close the new messages" }));
      await waitFor(() => expect(screen.queryByText("three")).not.toBeInTheDocument());
      expect(panels().getByRole("button", { name: "Chat" })).toHaveTextContent("3");
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "four", at: 1_700_000_004_000 });
      expect(screen.getByText("four")).toBeInTheDocument();
      expect(screen.queryByText("three")).not.toBeInTheDocument();
      await userEvent.click(screen.getByText("four"));
      expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("button", { name: "Close the new messages" })).not.toBeInTheDocument());
    });

    test("the balloon leaves by itself ten seconds after the newest message, leaving the count on the chat button", async () => {
      const { socket } = await inCall();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await send(socket, { t: "chat", pid: 2, name: "Bia", text: "one", at: 1_700_000_001_000 });
        await act(() => vi.advanceTimersByTimeAsync(9_000));
        expect(screen.getByText("one")).toBeInTheDocument();
        await act(() => vi.advanceTimersByTimeAsync(1_500));
        await act(() => vi.advanceTimersByTimeAsync(300));
        expect(screen.queryByText("one")).not.toBeInTheDocument();
        expect(panels().getByRole("button", { name: "Chat" })).toHaveTextContent("1");
      } finally {
        vi.useRealTimers();
      }
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
          list: async () => [{ kind: "audioinput", deviceId: "mic-2", label: "Desk microphone" } as MediaDeviceInfo],
        },
      });
      await userEvent.click(screen.getByRole("button", { name: "Turn microphone on" }));
      await waitFor(() => expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "media", flags: 1 }));
      expect(asked[0]).toHaveProperty("audio");
      expect(screen.getByRole("button", { name: "Turn microphone off" })).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(within(screen.getByRole("toolbar", { name: "Call controls" })).getByRole("button", { name: "Raise your hand" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "media", flags: 17 });
    });

    test("the microphone options list the devices and change the voice filter", async () => {
      const track = { stop: () => undefined, addEventListener: () => undefined };
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
      const asked: MediaStreamConstraints[] = [];
      await inCall({
        mediaDevices: {
          user: async (constraints) => {
            asked.push(constraints);
            return stream;
          },
          display: async () => stream,
          list: async () => [{ kind: "audioinput", deviceId: "mic-1", label: "Built-in microphone" } as MediaDeviceInfo, { kind: "audioinput", deviceId: "mic-2", label: "Desk microphone" } as MediaDeviceInfo],
        },
      });
      await userEvent.click(screen.getByRole("button", { name: "Turn microphone on" }));
      await userEvent.click(screen.getByRole("button", { name: "Microphone options" }));
      const options = within(screen.getByRole("dialog", { name: "Microphone options" }));
      await userEvent.click(await options.findByRole("radio", { name: "Desk microphone" }));
      await waitFor(() => expect(asked.at(-1)).toMatchObject({ audio: { deviceId: { exact: "mic-2" }, noiseSuppression: true } }));
      await userEvent.click(options.getByRole("button", { name: "Off" }));
      await waitFor(() => expect(asked.at(-1)).toMatchObject({ audio: { noiseSuppression: false, echoCancellation: false } }));
    });

    test("the look is edited freely and the room is told once, when I save", async () => {
      const { socket } = await inCall();
      await send(socket, { t: "roster", v: 3, people: [person(1, "Ana", { flags: 32, state: "active", look: "ff9ec7-0e1116-0", face: "^_^" }), person(2, "Bia", { state: "active" })], gone: [] });
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      const sentBefore = socket.sent.length;
      await userEvent.click(within(screen.getByRole("radiogroup", { name: "Disc colour" })).getByRole("radio", { name: "#c6f432" }));
      await userEvent.click(within(screen.getByRole("radiogroup", { name: "Face colour" })).getByRole("radio", { name: "#f5f5f2" }));
      await userEvent.click(screen.getByRole("button", { name: "Tilt to the left" }));
      await userEvent.click(screen.getByRole("button", { name: "(•‿•)" }));
      await userEvent.type(screen.getByLabelText("Face"), "!");
      expect(socket.sent.length).toBe(sentBefore);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(socket.sent.length).toBe(sentBefore + 1);
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "look", look: "c6f432-f5f5f2-345", face: "(•‿•)!" });
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      await userEvent.click(screen.getByRole("button", { name: ":D" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(socket.sent.length).toBe(sentBefore + 1);
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    });

    test("a photo is shrunk, sent to the room, shown when the room echoes it, and can be removed", async () => {
      const { socket } = await inCall();
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(screen.getByRole("menuitem", { name: /How you appear/ }));
      await userEvent.upload(screen.getByLabelText("Select a photo"), new File(["x"], "me.png", { type: "image/png" }));
      await waitFor(() => expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "photo", data: "/9j/4AAQ" }));
      await send(socket, { t: "photo", pid: 1, data: "/9j/4AAQ" });
      expect(document.querySelector('img[src="data:image/jpeg;base64,/9j/4AAQ"]')).not.toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Remove" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "photo", data: "" });
      await send(socket, { t: "photo", pid: 1, data: "" });
      expect(document.querySelector("img")).toBeNull();
    });

    test("the connection card opens from more options, stays while the call goes on, moves with the arrow keys and is put away with the minus", async () => {
      await inCall();
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(screen.getByRole("menuitem", { name: /Connection quality/ }));
      const card = screen.getByRole("group", { name: "Connection quality" });
      expect(within(card).getAllByText("measuring").length).toBeGreaterThan(0);
      for (const figure of ["Route", "Ping", "Loss", "Jitter", "Receiving", "Sending", "Video codec", "Audio codec"]) expect(within(card).getByText(figure)).toBeInTheDocument();
      expect(screen.getByLabelText("Message to the room")).toBeInTheDocument();
      const before = card.style.left;
      card.focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(card.style.left).not.toBe(before);
      await userEvent.click(within(card).getByRole("button", { name: "Put the connection card away" }));
      expect(screen.queryByRole("group", { name: "Connection quality" })).not.toBeInTheDocument();
    });

    test("sound and video settings open from more options and each choice is kept", async () => {
      const written: object[] = [];
      await inCall({ settingsMemory: { read: () => DEFAULT_SETTINGS, write: (settings: object) => void written.push(settings) } });
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(screen.getByRole("menuitem", { name: /Sound and video settings/ }));
      const sheet = within(screen.getByRole("dialog", { name: "Sound and video settings" }));
      await userEvent.click(sheet.getByRole("switch", { name: /Share the computer's sound/ }));
      await userEvent.click(sheet.getByRole("button", { name: "Advanced" }));
      await userEvent.click(sheet.getByRole("switch", { name: /Talk only while holding a key/ }));
      await userEvent.click(sheet.getByRole("radio", { name: "Left Alt" }));
      await userEvent.click(sheet.getByRole("radio", { name: "1440p · 60 fps" }));
      await userEvent.click(sheet.getByRole("switch", { name: /Cut the noise when you are not talking/ }));
      expect(written.at(-1)).toMatchObject({ screenAudio: false, pushToTalk: true, talkKey: "AltLeft", screenQuality: "1440p60", gate: true });
      expect(sheet.getByRole("radio", { name: "1440p · 60 fps" })).toHaveAttribute("aria-checked", "true");
      expect(sheet.getByRole("slider", { name: "How loud you must talk to be heard" })).toBeEnabled();
    });

    test("the screen options ask for the whole computer's sound, and the choice is kept", async () => {
      const written: object[] = [];
      await inCall({ settingsMemory: { read: () => DEFAULT_SETTINGS, write: (settings: object) => void written.push(settings) } });
      await userEvent.click(screen.getByRole("button", { name: "Screen options" }));
      const menu = within(screen.getByRole("dialog", { name: "Screen options" }));
      const option = menu.getByRole("switch", { name: /The whole computer's sound/ });
      expect(option).not.toBeChecked();
      await userEvent.click(option);
      expect(option).toBeChecked();
      expect(written.at(-1)).toMatchObject({ pcSound: true });
    });

    test("settings show the basics first, with the devices, and keep the finer controls under Advanced", async () => {
      const chosen: MediaStreamConstraints[] = [];
      const track = { stop: () => undefined, addEventListener: () => undefined };
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
      await inCall({
        mediaDevices: {
          user: async (constraints) => (chosen.push(constraints), stream),
          display: async () => stream,
          list: async () => [{ kind: "audioinput", deviceId: "mic-1", label: "Built-in microphone" } as MediaDeviceInfo, { kind: "audioinput", deviceId: "mic-2", label: "Desk microphone" } as MediaDeviceInfo],
        },
      });
      await fromMore("Sound and video settings");
      const sheet = within(screen.getByRole("dialog", { name: "Sound and video settings" }));
      expect(sheet.getByRole("heading", { name: "Basic" })).toBeInTheDocument();
      expect(sheet.getByRole("radiogroup", { name: "Clean up background noise" })).toBeInTheDocument();
      const advanced = sheet.getByRole("button", { name: "Advanced" });
      expect(advanced).toHaveAttribute("aria-expanded", "false");
      expect(sheet.getByRole("switch", { name: /Cut the noise when you are not talking/ }).closest("[inert]")).not.toBeNull();
      await userEvent.click(await sheet.findByRole("radio", { name: "Desk microphone" }));
      await userEvent.click(sheet.getByRole("button", { name: "Close" }));
      await userEvent.click(screen.getByRole("button", { name: "Turn microphone on" }));
      await waitFor(() => expect(chosen.at(-1)).toMatchObject({ audio: { deviceId: { exact: "mic-2" } } }));
    });

    test("the keyboard shortcuts are listed and work", async () => {
      const { socket } = await inCall();
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
      expect(within(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).getByText("Ctrl+Alt+H")).toBeInTheDocument();
      await userEvent.keyboard("{Control>}{Alt>}h{/Alt}{/Control}");
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "media", flags: 16 });
    });

    test("the eye beside the raised hand opens the visibility options and closes them again", async () => {
      await inCall();
      const eye = screen.getByRole("button", { name: "Visibility options" });
      expect(eye).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(eye);
      expect(screen.getByRole("group", { name: "What to see of Bia" })).toBeInTheDocument();
      expect(eye).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(eye);
      expect(screen.queryByRole("group", { name: "What to see of Bia" })).not.toBeInTheDocument();
    });

    test("visibility options choose, per person, the tile, the camera and the screen, on my screen only", async () => {
      const { socket } = await inCall();
      const sentBefore = socket.sent.length;
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      await userEvent.click(screen.getByRole("menuitem", { name: /Visibility options/ }));
      const bia = within(screen.getByRole("group", { name: "What to see of Bia" }));
      expect(bia.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(bia.getByRole("button", { name: "Camera" }));
      expect(bia.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("listitem", { name: /Bia, connected/ })).toBeInTheDocument();
      await userEvent.click(bia.getByRole("button", { name: "Tile" }));
      expect(screen.queryByRole("listitem", { name: /Bia, connected/ })).not.toBeInTheDocument();
      await userEvent.click(within(screen.getByRole("group", { name: "What to see of Ana" })).getByRole("button", { name: "Tile" }));
      expect(screen.getByText(/You hid everyone/)).toBeInTheDocument();
      expect(socket.sent.length).toBe(sentBefore);
    });

    test("the whiteboard is offered in the menu and what the others draw is heard even while it is closed", async () => {
      const { socket } = await inCall();
      await send(socket, { t: "board", pid: 2, data: { k: "els", els: [{ id: "a", version: 1, versionNonce: 1 }] } });
      await userEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getByRole("menuitemcheckbox", { name: "Whiteboard" })).toHaveAttribute("aria-checked", "false");
    });

    test("a click on a person brings them to the front with the others beside, and another click sends them back", async () => {
      await inCall();
      const bia = () => screen.getByRole("listitem", { name: /Bia, connected/ });
      expect(bia()).toHaveAttribute("data-mode", "grid");
      await userEvent.click(bia());
      expect(bia()).toHaveAttribute("data-mode", "front");
      expect(screen.getByRole("listitem", { name: /Ana, connected/ })).toHaveAttribute("data-mode", "strip");
      expect(within(bia()).getByRole("button", { name: "Show Bia on the whole screen" })).toBeInTheDocument();
      await userEvent.click(within(bia()).getByRole("button", { name: "Send Bia back to the grid" }));
      expect(bia()).toHaveAttribute("data-mode", "grid");
    });

    test("with someone in front, the others beside can be hidden and shown again, by the button or by Ctrl+Alt+O", async () => {
      await inCall();
      await userEvent.click(screen.getByRole("listitem", { name: /Bia, connected/ }));
      const ana = () => screen.queryByRole("listitem", { name: /Ana, connected/ });
      expect(ana()).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Hide everyone else" }));
      expect(screen.queryByRole("list", { name: "Everyone else" })).toBeNull();
      const show = screen.getByRole("button", { name: "Show everyone else (1)" });
      expect(show).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(show);
      expect(ana()).toBeVisible();
      await userEvent.keyboard("{Control>}{Alt>}o{/Alt}{/Control}");
      expect(screen.getByRole("button", { name: "Show everyone else (1)" })).toBeInTheDocument();
    });

    test("the handle of the others folds them into a thin rail with how many there are, which opens them again, and says so to assistive technology", async () => {
      await inCall();
      await userEvent.click(screen.getByRole("listitem", { name: /Bia, connected/ }));
      const handle = screen.getByRole("button", { name: "Hide everyone else" });
      expect(handle).toHaveAttribute("aria-expanded", "true");
      expect(handle).toHaveAttribute("aria-controls", "stage-others");
      expect(handle).toHaveAttribute("aria-keyshortcuts", "Control+Alt+O");
      await userEvent.click(handle);
      const rail = screen.getByRole("button", { name: "Show everyone else (1)" });
      expect(rail).toHaveAttribute("aria-expanded", "false");
      expect(rail).toHaveTextContent("1");
      expect(screen.queryByRole("button", { name: "Hide everyone else" })).toBeNull();
      await userEvent.click(rail);
      expect(screen.getByRole("button", { name: "Hide everyone else" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("list", { name: "Everyone else" })).toBeVisible();
    });

    test("with twelve people the grid sizes its tiles to the stage and, with one in front, the strip holds the other eleven", async () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private readonly report: (entries: { contentRect: { width: number; height: number } }[]) => void) {}
          observe() {
            this.report([{ contentRect: { width: 1280, height: 640 } }]);
          }
          disconnect() {}
        },
      );
      try {
        const { socket } = await inCall();
        const names = Array.from({ length: 12 }, (_, index) => (index === 0 ? "Ana" : `Guest${index}`));
        await send(socket, { t: "roster", v: 3, people: names.map((name, index) => person(index + 1, name, { flags: index === 0 ? 32 : 0, state: "active" })), gone: [] });
        const grid = screen.getByRole("listitem", { name: /Guest1, connected/ }).parentElement!;
        expect(within(grid).getAllByRole("listitem", { name: /connected/ })).toHaveLength(12);
        expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(\d+, \d+px\)$/);
        expect(Number.parseInt(grid.style.gridAutoRows)).toBeGreaterThanOrEqual(81);
        await userEvent.click(screen.getByRole("listitem", { name: /Guest1, connected/ }));
        expect(within(screen.getByRole("list", { name: "Everyone else" })).getAllByRole("listitem", { name: /connected/ })).toHaveLength(11);
        expect(screen.getByRole("button", { name: "Hide everyone else" })).toBeInTheDocument();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    test("the whiteboard someone opens comes to the front for me too, and I can close it for myself or open it for the room", async () => {
      const { socket } = await inCall();
      expect(screen.queryByRole("listitem", { name: "Whiteboard" })).not.toBeInTheDocument();
      await send(socket, { t: "roster", v: 3, people: [person(1, "Ana", { flags: 32, state: "active" }), person(2, "Bia", { flags: 128, state: "active" })], gone: [] });
      const boardFrame = screen.getByRole("listitem", { name: "Whiteboard" });
      expect(boardFrame).toHaveAttribute("data-mode", "front");
      expect(within(boardFrame).getByRole("heading", { name: "Whiteboard, opened by Bia" })).toBeInTheDocument();
      expect(await within(boardFrame).findByText("the drawing surface")).toBeInTheDocument();
      const sentBefore = socket.sent.length;
      await userEvent.click(within(boardFrame).getByRole("button", { name: "Close the whiteboard for me" }));
      expect(screen.queryByRole("listitem", { name: "Whiteboard" })).not.toBeInTheDocument();
      expect(socket.sent.length).toBe(sentBefore);
      await fromMore("Whiteboard", "menuitemcheckbox");
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "media", flags: 128 });
      expect(screen.getByRole("listitem", { name: "Whiteboard" })).toBeInTheDocument();
    });

    test("the owner mutes everyone, sees who asks to speak, and lets them", async () => {
      const { socket } = await inCall();
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      await userEvent.click(screen.getByRole("button", { name: "Mute everyone" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "owner", op: "mute-all" });
      await send(socket, { t: "roster", v: 9, people: [person(1, "Ana", { flags: 32, state: "active" }), person(2, "Bia", { flags: 256 | 16, state: "active" })], gone: [], quiet: true });
      expect(screen.getByText(/asks to speak/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Let everyone speak" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Let Bia speak" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "owner", op: "allow", pid: 2 });
    });

    test("a muted participant is told why the microphone stays off, and is asked when they may speak again", async () => {
      const { socket } = await inCall();
      await send(socket, { t: "roster", v: 3, people: [person(1, "Ana", { flags: 256, state: "active" }), person(2, "Bia", { flags: 32, state: "active" })], gone: [] });
      await userEvent.click(screen.getByRole("button", { name: "Turn microphone on" }));
      expect(screen.getByText("The owner muted the room. Raise your hand to ask to speak.")).toBeInTheDocument();
      await userEvent.click(screen.getAllByRole("button", { name: "Raise your hand" })[0]!);
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "media", flags: 16 });
      await send(socket, { t: "roster", v: 4, people: [person(1, "Ana", { flags: 0, state: "active" }), person(2, "Bia", { flags: 32, state: "active" })], gone: [] });
      expect(screen.getByText("The owner let you speak. Your microphone is still off.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(screen.queryByText(/The owner let you speak/)).not.toBeInTheDocument();
    });

    test("the owner keeps the whiteboard to those they let draw, and the others see it read only", async () => {
      const { socket } = await inCall();
      await fromMore("Whiteboard", "menuitemcheckbox");
      await userEvent.click(screen.getByRole("button", { name: "Only who I let draws" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "owner", op: "lock-board" });
      await send(socket, { t: "roster", v: 5, people: [person(1, "Ana", { flags: 32 | 128, state: "active" }), person(2, "Bia", { flags: 512, state: "active" })], gone: [], locked: true });
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      await userEvent.click(screen.getByRole("button", { name: "Let Bia draw" }));
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "owner", op: "draw-allow", pid: 2 });
    });

    test("whoever may not draw sees the whiteboard read only and is told so", async () => {
      const { socket } = await inCall();
      await send(socket, { t: "roster", v: 5, people: [person(1, "Ana", { flags: 512, state: "active" }), person(2, "Bia", { flags: 32 | 128, state: "active" })], gone: [], locked: true });
      const frame = screen.getByRole("listitem", { name: "Whiteboard" });
      expect(await within(frame).findByText("the drawing surface, to look at")).toBeInTheDocument();
      expect(within(frame).getByText("view only")).toBeInTheDocument();
      expect(within(frame).queryByRole("button", { name: "Only who I let draws" })).not.toBeInTheDocument();
    });

    test("a muted participant always sees why, and the whiteboard shows as a small picture when it is not in front", async () => {
      const { socket } = await inCall();
      await send(socket, { t: "roster", v: 5, people: [person(1, "Ana", { flags: 256, state: "active" }), person(2, "Bia", { flags: 32 | 128, state: "active" })], gone: [], quiet: true });
      expect(screen.getByText("The owner muted everyone. Raise your hand to ask to speak.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("listitem", { name: /Bia, connected/ }));
      expect(await within(screen.getByRole("listitem", { name: "Whiteboard" })).findByText("a small picture of the board")).toBeInTheDocument();
    });

    test("a private message is announced as private, with who sent it, and opens that conversation", async () => {
      const { socket } = await inCall();
      await send(socket, { t: "chat", pid: 2, to: 1, name: "Bia", text: "só pra você", at: 1_700_000_000_000 });
      expect(screen.getByText("Bia wrote only to you (1)")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Private · 1" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(within(screen.getByRole("list", { name: "Messages" })).getByText("só pra você")).toBeInTheDocument();
      expect(screen.queryByText(/wrote only to you/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    });

    test("an address in a message is a link that opens elsewhere, and a picture sent is shown", async () => {
      const { socket } = await inCall();
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "entra https://live.versatile.sh/meet", at: 1_700_000_000_000, img: "R0lGODlhAQABAAAAACw=" });
      const link = screen.getByRole("link", { name: "https://live.versatile.sh/meet" });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer noopener");
      expect(screen.getByRole("img", { name: "Picture from Bia" })).toHaveAttribute("src", "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
      await userEvent.click(screen.getByRole("button", { name: "Emoji" }));
      await userEvent.click(screen.getByRole("button", { name: "🔥" }));
      expect(screen.getByLabelText("Message to the room")).toHaveValue("🔥");
    });

    test("a right click on a person offers what can be done about them, starting with a private message", async () => {
      const { socket } = await inCall();
      await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("listitem", { name: /Bia, connected/ }) });
      const menu = within(screen.getByRole("menu", { name: "Options for Bia" }));
      expect(menu.getByRole("menuitem", { name: "Make owner" })).toBeInTheDocument();
      await userEvent.click(menu.getByRole("menuitem", { name: "Send a private message" }));
      await userEvent.type(screen.getByLabelText("Message to the room"), "psst{enter}");
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ t: "chat", text: "psst", to: 2 });
      await send(socket, { t: "chat", pid: 1, to: 2, name: "Ana", text: "psst", at: 1_700_000_000_000 });
      await send(socket, { t: "chat", pid: 2, name: "Bia", text: "to everyone", at: 1_700_000_001_000 });
      const log = within(screen.getByRole("list", { name: "Messages" }));
      expect(log.getByText("psst")).toBeInTheDocument();
      expect(log.queryByText("to everyone")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Back to the people" }));
      expect(screen.queryByLabelText("Message to the room")).not.toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Messages" })).not.toBeInTheDocument();
      await userEvent.click(within(screen.getByRole("list", { name: "Private with" })).getByRole("button", { name: /Bia/ }));
      expect(within(screen.getByRole("list", { name: "Messages" })).getByText("psst")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Chat", pressed: false }));
      expect(within(screen.getByRole("list", { name: "Messages" })).getByText("to everyone")).toBeInTheDocument();
    });

    test("the people button always shows how many are in the call", async () => {
      await inCall();
      expect(panels().getByRole("button", { name: "People" })).toHaveTextContent("2");
    });

    test("the side panel closes and reopens, and switches between the chat and the people", async () => {
      await inCall();
      const panel = () => screen.getByRole("complementary");
      expect(panel()).toHaveAccessibleName("Chat");
      await userEvent.click(screen.getByRole("button", { name: "People" }));
      expect(panel()).toHaveAccessibleName("People");
      await userEvent.click(screen.getByRole("button", { name: "Minimize the panel" }));
      expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(screen.getByRole("button", { name: "Chat" }));
      expect(panel()).toHaveAccessibleName("Chat");
    });

    test("says in words when the browser refuses the camera", async () => {
      await inCall({
        mediaDevices: {
          user: async () => Promise.reject(new DOMException("no", "NotAllowedError")),
          display: async () => Promise.reject(new DOMException("no", "NotAllowedError")),
          list: async () => [],
        },
      });
      await userEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
      expect(await screen.findByText(/The browser refused the camera/)).toBeInTheDocument();
    });
  });
});
