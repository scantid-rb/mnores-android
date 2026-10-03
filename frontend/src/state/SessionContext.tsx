// Session state + offline access mode. A valid authenticated session opens the
// normal app. If there is cached inventory but no session, the user may enter
// a local read-only mode without contacting the server.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { backgroundBridge } from "@/src/services/sync/nativeBackground";
import { queryClient } from "@/src/query-client";
import { localStore } from "@/src/database/store";
import { initializeServerConfig, setServerUrl } from "@/src/services/serverConfig";
import { sessionRepository } from "@/src/repositories/sessionRepository";
import { SessionRow, SessionUser } from "@/src/types";

export type AppAccessMode = "none" | "authenticated" | "readonly";

interface SessionContextValue {
  loading: boolean;
  token: string | null;
  user: SessionUser | null;
  session: SessionRow | null;
  cacheAvailable: boolean;
  mode: AppAccessMode;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterReadonly: () => Promise<void>;
  exitReadonly: () => void;
  refreshSession: () => Promise<void>;
  updateIdentity: (user: SessionUser) => Promise<void>;
  switchServer: (url: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [session, setSession] = useState<SessionRow | null>(null);
  const [cacheAvailable, setCacheAvailable] = useState(false);
  const [mode, setMode] = useState<AppAccessMode>("none");

  useEffect(() => {
    let mounted = true;
    (async () => {
      await initializeServerConfig();
      await localStore.init();
      const restored = await sessionRepository.restore();
      const counts = await localStore.getCounts();
      if (!mounted) return;
      setToken(restored.token);
      setSession(restored.session);
      setCacheAvailable(counts.parts > 0);
      if (restored.session && restored.token) {
        await backgroundBridge?.resumeAuth();
        if (!mounted) return;
        setUser({
          id: restored.session.id,
          username: restored.session.username,
          role: restored.session.role,
          boat_id: restored.session.boat_id,
        });
        setMode("authenticated");
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const { token: t, user: u } = await sessionRepository.login(username, password);
    const fresh = await localStore.getSession();
    const counts = await localStore.getCounts();
    setToken(t);
    setUser(u);
    setSession(fresh);
    setCacheAvailable(counts.parts > 0);
    setMode("authenticated");
  }, []);

  const refreshSession = useCallback(async () => {
    const fresh = await localStore.getSession();
    setSession(fresh);
  }, []);

  const updateIdentity = useCallback(async (nextUser: SessionUser) => {
    await localStore.updateSessionIdentity(nextUser);
    const fresh = await localStore.getSession();
    setUser(nextUser);
    setSession(fresh);
  }, []);

  const signOut = useCallback(async () => {
    await sessionRepository.logout();
    setToken(null);
    setUser(null);
    setSession(null);
    setMode("none");
    queryClient.clear();
  }, []);

  const enterReadonly = useCallback(async () => {
    const counts = await localStore.getCounts();
    if (counts.parts <= 0) return;
    await sessionRepository.logout();
    queryClient.clear();
    setToken(null);
    setUser(null);
    setSession(null);
    setCacheAvailable(true);
    setMode("readonly");
  }, []);

  const exitReadonly = useCallback(() => {
    queryClient.clear();
    setMode("none");
  }, []);

  const switchServer = useCallback(async (url: string) => {
    await sessionRepository.logout();
    await localStore.clearUserData();
    await setServerUrl(url);
    queryClient.clear();
    setToken(null);
    setUser(null);
    setSession(null);
    setCacheAvailable(false);
    setMode("none");
  }, []);

  const value = useMemo(
    () => ({ loading, token, user, session, cacheAvailable, mode, signIn, signOut, enterReadonly, exitReadonly, refreshSession, updateIdentity, switchServer }),
    [loading, token, user, session, cacheAvailable, mode, signIn, signOut, enterReadonly, exitReadonly, refreshSession, updateIdentity, switchServer],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
