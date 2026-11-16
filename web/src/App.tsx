import { HomePage } from "./home/HomePage";
import { LobbyPage } from "./lobby/LobbyPage";
import { NotFoundPage } from "./NotFoundPage";
import { usePathname } from "./routing/Navigation";
import { resolveRoute } from "./routing/pathname-store";
import { RoomPage } from "./room/RoomPage";
import { Shell } from "./ui/Shell";

/** The pages of the product, chosen by the pathname: the home at `/`, the open rooms at `/lobby` and a room at `/{slug}`. */
export function App() {
  const route = resolveRoute(usePathname());
  return (
    <Shell bare={route.kind === "home"}>
      {route.kind === "home" ? (
        <HomePage />
      ) : route.kind === "lobby" ? (
        <LobbyPage />
      ) : route.kind === "room" ? (
        <RoomPage key={route.slug} slug={route.slug} />
      ) : (
        <NotFoundPage kind={route.kind} />
      )}
    </Shell>
  );
}
