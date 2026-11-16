import { HomePage } from "./home/HomePage";
import { NotFoundPage } from "./NotFoundPage";
import { usePathname } from "./routing/Navigation";
import { resolveRoute } from "./routing/pathname-store";
import { RoomPage } from "./room/RoomPage";
import { Shell } from "./ui/Shell";

/** The pages of the product, chosen by the pathname: the home at `/`, the open rooms at `/lobby` and a room at `/{slug}`. */
export function App() {
  const route = resolveRoute(usePathname());
  return (
    <Shell bare={route.kind === "home" || route.kind === "lobby"}>
      {route.kind === "home" || route.kind === "lobby" ? <HomePage view={route.kind} /> : route.kind === "room" ? <RoomPage key={route.slug} slug={route.slug} /> : <NotFoundPage kind={route.kind} />}
    </Shell>
  );
}
