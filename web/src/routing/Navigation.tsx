import { createContext, use, useSyncExternalStore, type ComponentProps, type MouseEvent, type ReactNode } from "react";

import type { PathnameStore } from "./pathname-store";

const NavigationContext = createContext<PathnameStore | undefined>(undefined);

/** Gives the pages below it the pathname store. */
export function NavigationProvider({ store, children }: { store: PathnameStore; children: ReactNode }) {
  return <NavigationContext value={store}>{children}</NavigationContext>;
}

function useStore(): PathnameStore {
  const store = use(NavigationContext);
  if (!store) throw new Error("navigation needs a NavigationProvider above it");
  return store;
}

/** The current pathname; the component re-renders when it changes. */
export function usePathname(): string {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Moves to another page of the app without a reload. */
export function useNavigate(): (path: string) => void {
  return useStore().navigate;
}

/** An anchor that navigates inside the app on a plain click and stays a normal link otherwise. */
export function AppLink({ href, onClick, ...rest }: ComponentProps<"a"> & { href: string }) {
  const navigate = useNavigate();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
