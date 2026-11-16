import { NotFoundPage } from "./NotFoundPage";
import { LobbyPage } from "./lobby/LobbyPage";
import { usePathname } from "./routing/Navigation";
import { resolveRoute } from "./routing/pathname-store";
import { RoomPage } from "./room/RoomPage";
import { Shell } from "./ui/Shell";

/** The two pages of the product, chosen by the pathname: the lobby at `/` and a room at `/{slug}`. */
export function App() {
  const route = resolveRoute(usePathname());
  return (
    <Shell>
      {route.kind === "lobby" ? <LobbyPage /> : route.kind === "room" ? <RoomPage key={route.slug} slug={route.slug} /> : <NotFoundPage kind={route.kind} />}
    </Shell>
  );
}
