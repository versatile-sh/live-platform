import { NotFoundPage } from "./NotFoundPage";
import { usePathname } from "./routing/Navigation";
import { resolveRoute } from "./routing/pathname-store";
import { FrontPage } from "./room/RoomPage";
import { Shell } from "./ui/Shell";

/** The pages of the product, chosen by the pathname: the home at `/`, the open rooms at `/lobby` and a room at `/{slug}`. */
export function App() {
  const route = resolveRoute(usePathname());
  if (route.kind === "room") return <FrontPage view="entry" slug={route.slug} />;
  if (route.kind === "home" || route.kind === "lobby") return <FrontPage view={route.kind} />;
  return (
    <Shell>
      <NotFoundPage kind={route.kind} />
    </Shell>
  );
}
