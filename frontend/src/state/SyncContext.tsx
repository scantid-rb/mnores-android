// Sync orchestration for the UI. Holds sync status, pending count, a neutral
// conflict notice, an accurate error message and the last attempt diagnostics.
// Triggers a sync pass on app start (if online), on connectivity regain, and
// on demand. It does not block the inventory while the queue is processed.

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
import { runSync, SyncDiagnostics, SyncSummary } from "@/src/services/sync/syncEngine";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";

type SyncStatus = "idle" | "syncing" | "error";

interface SyncContextValue {
  status: SyncStatus;
  pendingCount: number;
  lastError: string | null;
  conflictNotice: boolean;
  diagnostics: SyncDiagnostics | null;
  syncNow: () => Promise<void>;
  refreshPending: () => Promise<void>;
  clearConflictNotice: () => void;
  receivedParts: number;
  receivedActiveParts: number;
  receivedDeletedParts: number;
  cachedParts: number;
  protectedIds: number[];
  missingActiveIds: number[];
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

function invalidateInventory() {
  queryClient.invalidateQueries({ queryKey: ["parts"] });
  queryClient.invalidateQueries({ queryKey: ["categories"] });
  queryClient.invalidateQueries({ queryKey: ["boats"] });
  queryClient.invalidateQueries({ queryKey: ["counts"] });
}

function messageFor(s: SyncSummary): string | null {
  if (s.networkError) return "Sin conexión con el servidor. Reintentaremos automáticamente.";
  if (s.serverError || s.failed > 0) {
    const code = s.diagnostics?.httpStatus ? ` (HTTP ${s.diagnostics.httpStatus})` : "";
    return `El servidor rechazó una o más operaciones${code}. Revisa el diagnóstico más abajo.`;
  }
  return null;
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { token, signOut, refreshSession } = useSession();
  const { online } = useConnectivity();

  const [status, setStatus] = useState<SyncStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);
  const [receivedParts, setReceivedParts] = useState(0);
  const [receivedActiveParts, setReceivedActiveParts] = useState(0);
  const [receivedDeletedParts, setReceivedDeletedParts] = useState(0);
  const [cachedParts, setCachedParts] = useState(0);
  const [protectedIds, setProtectedIds] = useState<number[]>([]);
  const [missingActiveIds, setMissingActiveIds] = useState<number[]>([]);

  const running = useRef(false);
  const rerunRequested = useRef(false);
  const prevOnline = useRef(online);

  const refreshPending = useCallback(async () => {
    setPendingCount(await localStore.getPendingCount());
  }, []);

  const syncNow = useCallback(async () => {
    if (!token) return;
    if (running.current) {
      // A mutation may finish while an automatic sync is still running.
      // Do not silently discard the requested refresh; queue one extra pass.
      rerunRequested.current = true;
      return;
    }
    if (!online) {
      await refreshPending();
      return;
    }
    running.current = true;
    setStatus("syncing");
    setLastError(null);
    try {
      const summary: SyncSummary = await runSync(token);
      setReceivedParts(summary.receivedParts);
      setReceivedActiveParts(summary.receivedActiveParts);
      setReceivedDeletedParts(summary.receivedDeletedParts);
      setCachedParts(summary.cachedParts);
      setProtectedIds(summary.protectedIds);
      setMissingActiveIds(summary.missingActiveIds);
      if (summary.diagnostics) {
        setDiagnostics(summary.diagnostics);
      } else if (summary.serverError || summary.failed > 0) {
        setDiagnostics({
          path: "/api/parts/push",
          method: "POST",
          httpStatus: null,
          kind: "unexpected",
          timeout: false,
          fetchError: false,
          parseOk: true,
          bodySnippet: "La sincronización terminó con error pero no devolvió diagnóstico.",
          classification: "missing_diagnostic",
          at: new Date().toISOString(),
        });
      }
      if (summary.authError) {
        await signOut();
        return;
      }
      // runSync persists the server cursor in SQLite. Refresh the session
      // context so the Sync screen immediately shows the new timestamp.
      await refreshSession();
      if (summary.conflicts > 0) setConflictNotice(true);
      const msg = messageFor(summary);
      setLastError(msg);
      setStatus(msg ? "error" : "idle");
      invalidateInventory();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Error de sincronización");
      setStatus("error");
    } finally {
      running.current = false;
      await refreshPending();
    }
  }, [token, online, signOut, refreshSession, refreshPending]);

  // If a sync request arrived while another pass was running, execute one
  // additional pass after the current pass has returned to idle.
  useEffect(() => {
    if (status !== "idle" || !rerunRequested.current || !token || !online) return;
    rerunRequested.current = false;
    void syncNow();
  }, [status, token, online, syncNow]);

  // Initial pass on mount (once we have a token and are online).
  useEffect(() => {
    // Initial async hydration/sync is intentionally started from the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPending();
    if (token && online) void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Auto-sync when connectivity is regained (offline -> online).
  useEffect(() => {
    if (online && !prevOnline.current && token) void syncNow();
    prevOnline.current = online;
  }, [online, token, syncNow]);

  const value = useMemo(
    () => ({
      status,
      pendingCount,
      lastError,
      conflictNotice,
      diagnostics,
      receivedParts,
      receivedActiveParts,
      receivedDeletedParts,
      cachedParts,
      protectedIds,
      missingActiveIds,
      syncNow,
      refreshPending,
      clearConflictNotice: () => setConflictNotice(false),
    }),
    [status, pendingCount, lastError, conflictNotice, diagnostics, receivedParts, receivedActiveParts, receivedDeletedParts, cachedParts, protectedIds, missingActiveIds, syncNow, refreshPending],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
