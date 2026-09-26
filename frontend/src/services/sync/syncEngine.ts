// First functional Sync Engine.
//   processQueue: push pending_changes to POST /api/parts/push, then apply the
//                 per-item result exactly as the server reports it.
//   pullAndReconcile: GET /api/sync and merge, protecting rows that still have
//                 pending changes.
// The engine only runs on triggers (app start, reconnect, manual). It never
// loops aggressively and never loses or duplicates operations.

import { ApiError } from "@/src/services/api/client";
import { apiGetSync, apiPush } from "@/src/services/api/endpoints";
import { localStore } from "@/src/database/store";
import { PendingChange, PushChange, PushResult } from "@/src/types";

export interface SyncSummary {
  pushed: number;
  ok: number;
  conflicts: number;
  failed: number;
  notFound: number;
  authError: boolean;
  networkError: boolean;
}

function buildChange(entry: PendingChange): PushChange {
  const payload = JSON.parse(entry.payload || "{}");
  if (entry.action === "create") {
    return {
      action: "create",
      local_id: entry.client_local_id ?? undefined,
      boat_id: payload.boat_id,
      name: payload.name,
      reference: payload.reference ?? null,
      category_id: payload.category_id ?? null,
      location: payload.location ?? null,
      quantity: payload.quantity ?? 0,
      notes: payload.notes ?? null,
    };
  }
  if (entry.action === "update") {
    return {
      action: "update",
      id: entry.entity_id ?? undefined,
      base_updated_at: entry.base_updated_at,
      ...payload,
    };
  }
  return {
    action: "delete",
    id: entry.entity_id ?? undefined,
    base_updated_at: entry.base_updated_at,
  };
}

function matchResult(entry: PendingChange, results: PushResult[]): PushResult | undefined {
  if (entry.action === "create") {
    return results.find((r) => r.action === "create" && r.local_id === entry.client_local_id);
  }
  return results.find((r) => r.action === entry.action && r.id === entry.entity_id);
}

async function processQueue(token: string): Promise<SyncSummary> {
  const summary: SyncSummary = {
    pushed: 0, ok: 0, conflicts: 0, failed: 0, notFound: 0, authError: false, networkError: false,
  };

  const pending = await localStore.getPendingChanges();
  if (pending.length === 0) return summary;

  const queueIds = pending.map((e) => e.queue_id);
  await localStore.markSyncing(queueIds);
  const changes = pending.map(buildChange);
  summary.pushed = changes.length;

  let response;
  try {
    response = await apiPush(token, changes);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      summary.authError = true;
      await localStore.revertSyncing(queueIds);
      return summary;
    }
    // Transient network/server error: keep everything, retry later.
    summary.networkError = true;
    await localStore.revertSyncing(queueIds);
    return summary;
  }

  const results = response.results ?? [];

  for (const entry of pending) {
    const res = matchResult(entry, results);

    if (!res) {
      // No individual result -> keep it for the next round (bounded retry).
      await localStore.markRetry(entry.queue_id, "sin resultado del servidor");
      continue;
    }

    switch (res.status) {
      case "ok": {
        summary.ok++;
        if (entry.action === "create" && res.id != null) {
          await localStore.applyCreateOk(entry.queue_id, entry.row_uid, res.id, res.updated_at ?? new Date().toISOString());
        } else if (entry.action === "update" && entry.entity_id != null) {
          await localStore.applyUpdateOk(entry.queue_id, entry.entity_id, res.updated_at ?? new Date().toISOString());
        } else if (entry.action === "delete" && entry.entity_id != null) {
          await localStore.applyDeleteOk(entry.queue_id, entry.entity_id);
        }
        break;
      }
      case "conflict_overwritten": {
        // Server applied its decision. Complete the op; /api/sync reconcile
        // brings the authoritative state. Flag it neutrally for the UI.
        summary.conflicts++;
        if (entry.action === "delete" && entry.entity_id != null) {
          await localStore.applyDeleteOk(entry.queue_id, entry.entity_id);
        } else if (entry.action === "update" && entry.entity_id != null) {
          await localStore.applyUpdateOk(entry.queue_id, entry.entity_id, res.updated_at ?? new Date().toISOString());
        } else if (entry.action === "create" && res.id != null) {
          await localStore.applyCreateOk(entry.queue_id, entry.row_uid, res.id, res.updated_at ?? new Date().toISOString());
        }
        break;
      }
      case "not_found": {
        // Safe outcome (already gone on the server). Reconcile locally.
        summary.notFound++;
        if (entry.entity_id != null) {
          await localStore.applyDeleteOk(entry.queue_id, entry.entity_id);
        } else {
          await localStore.markFailed(entry.queue_id, entry.row_uid, "not_found");
        }
        break;
      }
      case "forbidden":
      case "invalid":
      default: {
        // Permanent rejection: stop retrying, surface an error state.
        summary.failed++;
        await localStore.markFailed(entry.queue_id, entry.row_uid, res.status);
        break;
      }
    }
  }

  return summary;
}

export async function pullAndReconcile(token: string): Promise<void> {
  const protectedIds = await localStore.getProtectedServerIds();
  const sync = await apiGetSync(token);
  await localStore.reconcileInventory(
    { boats: sync.boats ?? [], categories: sync.categories ?? [], parts: sync.parts ?? [] },
    protectedIds,
  );
  await localStore.setLastSyncAt(sync.server_time);
}

// Full sync pass: push the queue, then pull & reconcile.
export async function runSync(token: string): Promise<SyncSummary> {
  const summary = await processQueue(token);
  if (summary.authError) return summary; // needs re-login; skip pull
  await pullAndReconcile(token);
  return summary;
}
