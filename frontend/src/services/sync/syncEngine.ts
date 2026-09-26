// First functional Sync Engine.
//   processQueue: push each pending_change to POST /api/parts/push (one item
//                 per request so a poison item cannot block the others), then
//                 apply the per-item result exactly as the server reports it.
//   pullAndReconcile: GET /api/sync and merge, protecting rows that still have
//                 pending changes.
// It only runs on triggers (app start, reconnect, manual). It never loops
// aggressively and never loses or duplicates operations. Errors are classified
// precisely (connectivity vs HTTP/parse/API) and captured for diagnostics.

import { ApiError } from "@/src/services/api/client";
import { apiGetSync, apiPush } from "@/src/services/api/endpoints";
import { localStore } from "@/src/database/store";
import { PendingChange, PushChange, PushResult } from "@/src/types";

export interface SyncDiagnostics {
  path: string;
  method: string;
  httpStatus: number | null;
  kind: string; // ok | network | timeout | http | parse | api | auth
  timeout: boolean;
  fetchError: boolean;
  parseOk: boolean;
  bodySnippet: string | null;
  classification: string;
  at: string;
}

export interface SyncSummary {
  pushed: number;
  ok: number;
  conflicts: number;
  failed: number;
  notFound: number;
  authError: boolean;
  networkError: boolean;
  serverError: boolean;
  diagnostics: SyncDiagnostics | null;
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
    return { action: "update", id: entry.entity_id ?? undefined, base_updated_at: entry.base_updated_at, ...payload };
  }
  return { action: "delete", id: entry.entity_id ?? undefined, base_updated_at: entry.base_updated_at };
}

function matchResult(entry: PendingChange, results: PushResult[]): PushResult | undefined {
  if (entry.action === "create") {
    return results.find((r) => r.action === "create" && r.local_id === entry.client_local_id);
  }
  return results.find((r) => r.action === entry.action && r.id === entry.entity_id);
}

function successDiag(): SyncDiagnostics {
  return {
    path: "/api/parts/push",
    method: "POST",
    httpStatus: 200,
    kind: "ok",
    timeout: false,
    fetchError: false,
    parseOk: true,
    bodySnippet: null,
    classification: "ok",
    at: new Date().toISOString(),
  };
}

function errorDiag(e: ApiError): SyncDiagnostics {
  const isAuth = e.status === 401 || e.status === 403;
  return {
    path: "/api/parts/push",
    method: "POST",
    httpStatus: e.status || null,
    kind: e.kind,
    timeout: e.kind === "timeout",
    fetchError: e.kind === "network",
    parseOk: e.kind !== "parse",
    bodySnippet: e.bodySnippet,
    classification: isAuth ? "auth" : e.kind,
    at: new Date().toISOString(),
  };
}

async function applyOk(entry: PendingChange, res: PushResult): Promise<void> {
  const updatedAt = res.updated_at ?? new Date().toISOString();
  if (entry.action === "create" && res.id != null) {
    await localStore.applyCreateOk(entry.queue_id, entry.row_uid, res.id, updatedAt);
  } else if (entry.action === "update" && entry.entity_id != null) {
    await localStore.applyUpdateOk(entry.queue_id, entry.entity_id, updatedAt);
  } else if (entry.action === "delete" && entry.entity_id != null) {
    await localStore.applyDeleteOk(entry.queue_id, entry.entity_id);
  }
}

async function processQueue(token: string): Promise<SyncSummary> {
  const summary: SyncSummary = {
    pushed: 0, ok: 0, conflicts: 0, failed: 0, notFound: 0,
    authError: false, networkError: false, serverError: false, diagnostics: null,
  };

  const pending = await localStore.getPendingChanges();
  if (pending.length === 0) return summary;

  let errDiag: SyncDiagnostics | null = null;
  let lastDiag: SyncDiagnostics | null = null;

  for (const entry of pending) {
    summary.pushed++;
    await localStore.markSyncing([entry.queue_id]);

    let response;
    try {
      response = await apiPush(token, [buildChange(entry)]);
      lastDiag = successDiag();
    } catch (e) {
      if (e instanceof ApiError) {
        const d = errorDiag(e);
        lastDiag = d;
        if (!errDiag) errDiag = d;

        if (e.status === 401 || e.status === 403) {
          summary.authError = true;
          await localStore.revertSyncing([entry.queue_id]);
          break; // needs re-login
        }
        if (e.kind === "network" || e.kind === "timeout") {
          // Genuine connectivity problem: keep everything, stop early.
          summary.networkError = true;
          await localStore.revertSyncing([entry.queue_id]);
          break;
        }
        // HTTP / parse / API rejection of THIS operation. Do not block others.
        summary.serverError = true;
        await localStore.markRetry(entry.queue_id, `HTTP ${e.status} (${e.kind})`);
        continue;
      }
      // Unexpected client error: keep the op, stop.
      summary.serverError = true;
      await localStore.revertSyncing([entry.queue_id]);
      break;
    }

    const results = response?.results ?? [];
    const res = matchResult(entry, results);

    if (!res) {
      await localStore.markRetry(entry.queue_id, "sin resultado del servidor");
      continue;
    }

    switch (res.status) {
      case "ok":
        summary.ok++;
        await applyOk(entry, res);
        break;
      case "conflict_overwritten":
        // Server applied its decision; complete and reconcile via /api/sync.
        summary.conflicts++;
        await applyOk(entry, res);
        break;
      case "not_found":
        summary.notFound++;
        if (entry.entity_id != null) await localStore.applyDeleteOk(entry.queue_id, entry.entity_id);
        else await localStore.markFailed(entry.queue_id, entry.row_uid, "not_found");
        break;
      case "forbidden":
      case "invalid":
      default:
        summary.failed++;
        await localStore.markFailed(entry.queue_id, entry.row_uid, res.status);
        break;
    }
  }

  summary.diagnostics = errDiag ?? lastDiag;
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
  if (summary.authError || summary.networkError) return summary; // skip pull
  try {
    await pullAndReconcile(token);
  } catch (e) {
    if (e instanceof ApiError && (e.kind === "network" || e.kind === "timeout")) {
      summary.networkError = true;
    } else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      summary.authError = true;
    } else {
      summary.serverError = true;
      if (e instanceof ApiError) summary.diagnostics = { ...errorDiag(e), path: "/api/sync", method: "GET" };
    }
  }
  return summary;
}
