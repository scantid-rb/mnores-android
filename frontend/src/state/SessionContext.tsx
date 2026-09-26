// Session state + the offline gate. On launch it initializes the local DB and
// restores any stored session (token from secure storage + metadata from
// SQLite). If a session exists the app goes straight to the inventory, even
// without Internet — the login screen is NOT shown just because the device is
// offline.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { queryClient } from "@/src/query-client";
import { localStore } from "@/src/database/store";
import { sessionRepository } from "@/src/repositories/sessionRepository";
import { SessionRow, SessionUser } from "@/src/types";

interface SessionContextValue {
  loading: boolean;
  token: string | null;
  user: SessionUser | null;
  session: SessionRow | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [session, setSession] = useState<SessionRow | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await localStore.init();
      const restored = await sessionRepository.restore();
      if (!mounted) return;
      setToken(restored.token);
      setSession(restored.session);
      if (restored.session) {
        setUser({
          id: restored.session.id,
          username: restored.session.username,
          role: restored.session.role,
          boat_id: restored.session.boat_id,
        });
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const { token: t, user: u } = await sessionRepository.login(username, password);
    const fresh = await localStore.getSession();
    setToken(t);
    setUser(u);
    setSession(fresh);
  }, []);

  const signOut = useCallback(async () => {
    await sessionRepository.logout();
    setToken(null);
    setUser(null);
    setSession(null);
    queryClient.clear();
  }, []);

  const value = useMemo(
    () => ({ loading, token, user, session, signIn, signOut }),
    [loading, token, user, session, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
