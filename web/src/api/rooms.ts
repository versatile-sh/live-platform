/** What anyone may know about a room. */
export type RoomSummary = { slug: string; exists: boolean; private: boolean; country?: string; count: number; capacity: number };

/** The outcome of asking about one room; it never throws. */
export type StatusResult = { kind: "ok"; room: RoomSummary } | { kind: "invalid" } | { kind: "unreachable" };

/** The outcome of asking for the lobby; it never throws. */
export type LobbyResult = { kind: "ok"; rooms: RoomSummary[] } | { kind: "unreachable" };

export type RoomsApi = {
  status(slug: string, signal?: AbortSignal): Promise<StatusResult>;
  lobby(signal?: AbortSignal): Promise<LobbyResult>;
};

function parseRoom(raw: unknown): RoomSummary | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { slug, exists, private: isPrivate, country, count, capacity } = raw as Record<string, unknown>;
  if (typeof slug !== "string" || typeof exists !== "boolean" || typeof isPrivate !== "boolean" || typeof count !== "number" || typeof capacity !== "number") return undefined;
  const base = { slug, exists, private: isPrivate, count, capacity };
  return typeof country === "string" && /^[A-Z]{2}$/.test(country) ? { ...base, country } : base;
}

/** The room status and lobby calls of the server, over `fetch`. */
export function createRoomsApi(fetcher: typeof fetch = (...args) => fetch(...args)): RoomsApi {
  return {
    async status(slug, signal) {
      try {
        const response = await fetcher(`/api/rooms/${encodeURIComponent(slug)}`, { signal, headers: { accept: "application/json" } });
        if (response.status === 400) return { kind: "invalid" };
        if (!response.ok) return { kind: "unreachable" };
        const room = parseRoom(await response.json());
        return room ? { kind: "ok", room } : { kind: "unreachable" };
      } catch {
        return { kind: "unreachable" };
      }
    },
    async lobby(signal) {
      try {
        const response = await fetcher("/api/lobby", { signal, headers: { accept: "application/json" } });
        if (!response.ok) return { kind: "unreachable" };
        const body: unknown = await response.json();
        const list = typeof body === "object" && body !== null ? (body as { rooms?: unknown }).rooms : undefined;
        if (!Array.isArray(list)) return { kind: "unreachable" };
        const rooms = list.map(parseRoom);
        return rooms.every((room) => room !== undefined) ? { kind: "ok", rooms } : { kind: "unreachable" };
      } catch {
        return { kind: "unreachable" };
      }
    },
  };
}

/** The two-letter country code as a flag emoji, or an empty string when it is not a code. */
export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}
