// Sync service. Phase 1 implements only the initial pull:
//   validate token (/api/me) -> pull (/api/sync) -> reconcile local cache.
// The pending-queue push and retry/conflict logic belong to later phases.

import { apiGetMe, apiGetSync } from "@/src/services/api/endpoints";
import { localStore } from "@/src/database/store";

export interface InitialSyncResult {
  serverTime: string;
  counts: { boats: number; categories: number; parts: number };
}

export async function runInitialSync(token: string): Promise<InitialSyncResult> {
  // Validate the session first; a 401 here means re-login is required.
  await apiGetMe(token);

  const sync = await apiGetSync(token);

  await localStore.replaceInventory({
    boats: sync.boats ?? [],
    categories: sync.categories ?? [],
    parts: sync.parts ?? [],
  });
  await localStore.setLastSyncAt(sync.server_time);

  return {
    serverTime: sync.server_time,
    counts: {
      boats: (sync.boats ?? []).length,
      categories: (sync.categories ?? []).length,
      parts: (sync.parts ?? []).length,
    },
  };
}
