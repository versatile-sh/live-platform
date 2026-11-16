import { HomePage } from "./home/HomePage";
import { NotFoundPage } from "./NotFoundPage";
import { usePathname } from "./routing/Navigation";
import { resolveRoute } from "./routing/pathname-store";
import { RoomPage } from "./room/RoomPage";
import { Shell } from "./ui/Shell";

/** The pages of the product, chosen by the pathname: the home at `/`, the open rooms at `/lobby` and a room at `/{slug}`. */
export function App() {
  const route = resolveRoute(usePathname());
  if (route.kind === "room") return <RoomPage key={route.slug} slug={route.slug} />;
  if (route.kind === "home" || route.kind === "lobby") {
    return (
      <Shell bare>
        <HomePage view={route.kind} />
      </Shell>
    );
  }
  return (
    <Shell>
      <NotFoundPage kind={route.kind} />
    </Shell>
  );
}
