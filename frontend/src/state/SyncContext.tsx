// Sync orchestration for the UI. Holds sync status, pending count and a
// neutral conflict notice. Triggers a sync pass on app start (if online),
// whenever connectivity is regained, and on demand via syncNow(). It does not
// block the inventory; the UI stays usable while the queue is processed.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { queryClient } from "@/src/query-client";
import { localStore } from "@/src/database/store";
import { runSync, SyncSummary } from "@/src/services/sync/syncEngine";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";

type SyncStatus = "idle" | "syncing" | "error";

interface SyncContextValue {
  status: SyncStatus;
  pendingCount: number;
  lastError: string | null;
  conflictNotice: boolean;
  syncNow: () => Promise<void>;
  refreshPending: () => Promise<void>;
  clearConflictNotice: () => void;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

function invalidateInventory() {
  queryClient.invalidateQueries({ queryKey: ["parts"] });
  queryClient.invalidateQueries({ queryKey: ["categories"] });
  queryClient.invalidateQueries({ queryKey: ["boats"] });
  queryClient.invalidateQueries({ queryKey: ["counts"] });
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { token, signOut } = useSession();
  const { online } = useConnectivity();

  const [status, setStatus] = useState<SyncStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState(false);

  const running = useRef(false);
  const prevOnline = useRef(online);

  const refreshPending = useCallback(async () => {
    setPendingCount(await localStore.getPendingCount());
  }, []);

  const syncNow = useCallback(async () => {
    if (!token) return;
    if (running.current) return; // guard against concurrent passes
    if (!online) {
      await refreshPending();
      return;
    }
    running.current = true;
    setStatus("syncing");
    setLastError(null);
    try {
      const summary: SyncSummary = await runSync(token);
      if (summary.authError) {
        await signOut();
        return;
      }
      if (summary.conflicts > 0) setConflictNotice(true);
      if (summary.networkError) setLastError("Sin conexión con el servidor. Reintentaremos.");
      else if (summary.failed > 0) setLastError("Algunas operaciones fueron rechazadas por el servidor.");
      setStatus(summary.networkError || summary.failed > 0 ? "error" : "idle");
      invalidateInventory();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Error de sincronización");
      setStatus("error");
    } finally {
      running.current = false;
      await refreshPending();
    }
  }, [token, online, signOut, refreshPending]);

  // Initial pass on mount (once we have a token and are online).
  useEffect(() => {
    refreshPending();
    if (token && online) void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Auto-sync when connectivity is regained (offline -> online).
  useEffect(() => {
    if (online && !prevOnline.current && token) {
      void syncNow();
    }
    prevOnline.current = online;
  }, [online, token, syncNow]);

  const value = useMemo(
    () => ({
      status,
      pendingCount,
      lastError,
      conflictNotice,
      syncNow,
      refreshPending,
      clearConflictNotice: () => setConflictNotice(false),
    }),
    [status, pendingCount, lastError, conflictNotice, syncNow, refreshPending],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
