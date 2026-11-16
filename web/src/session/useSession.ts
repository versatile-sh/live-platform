import { useSyncExternalStore } from "react";

import { IDLE } from "./connection";
import type { Session, SessionSnapshot } from "./session";

const NO_SUBSCRIPTION = () => () => undefined;
const NO_SESSION: SessionSnapshot = { connection: IDLE, chat: [], slug: "", private: false, listed: undefined, password: undefined };

/** The snapshot of a session, or an idle one when there is none yet. */
export function useSession(session: Session | undefined): SessionSnapshot {
  return useSyncExternalStore(session?.subscribe ?? NO_SUBSCRIPTION, session?.getSnapshot ?? (() => NO_SESSION));
}
