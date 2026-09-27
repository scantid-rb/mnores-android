// Sync Engine.
// Pushes pending changes, then pulls either the initial full snapshot or an
// incremental /api/sync?since=<last_server_time> delta and reconciles it with
// the existing local cache.

import { ApiError } from "@/src/services/api/client";
import { apiGetSync, apiPush } from "@/src/services/api/endpoints";
import { localStore } from "@/src/database/store";
import { PendingChange, PushChange, PushResult } from "@/src/types";

export interface SyncDiagnostics {
  path: string;
  method: string;
  httpStatus: number | null;
  kind: string;
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

function errorDiag(e: ApiError, path = "/api/parts/push", method = "POST"): SyncDiagnostics {
  const isAuth = e.status === 401 || e.status === 403;
  return {
    path,
    method,
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

function unknownDiag(e: unknown, path = "/api/parts/push", method = "POST"): SyncDiagnostics {
  const message = e instanceof Error ? e.message : String(e);
  return {
    path,
    method,
    httpStatus: null,
    kind: "unexpected",
    timeout: false,
    fetchError: false,
    parseOk: true,
    bodySnippet: message ? message.slice(0, 300) : "Error desconocido sin mensaje.",
    classification: "unexpected",
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
          break;
        }
        if (e.kind === "network" || e.kind === "timeout") {
          summary.networkError = true;
          await localStore.revertSyncing([entry.queue_id]);
          break;
        }
        summary.serverError = true;
        await localStore.markRetry(entry.queue_id, `HTTP ${e.status} (${e.kind})`);
        continue;
      }
      summary.serverError = true;
      summary.diagnostics = unknownDiag(e);
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
        summary.diagnostics = {
          path: "/api/parts/push",
          method: "POST",
          httpStatus: 200,
          kind: "api_result",
          timeout: false,
          fetchError: false,
          parseOk: true,
          bodySnippet: JSON.stringify({
            action: res.action,
            id: res.id ?? null,
            local_id: res.local_id ?? null,
            status: res.status,
          }),
          classification: res.status,
          at: new Date().toISOString(),
        };
        await localStore.markFailed(entry.queue_id, entry.row_uid, res.status);
        break;
    }
  }

  // Preserve a logical API rejection diagnostic; a later HTTP-200 success must not overwrite it.\n  summary.diagnostics = errDiag ?? summary.diagnostics ?? lastDiag;
  return summary;
}

function mergeById<T extends { id: number }>(current: T[], delta: T[]): T[] {
  const merged = new Map<number, T>();
  for (const row of current) merged.set(row.id, row);
  for (const row of delta) merged.set(row.id, row);
  return Array.from(merged.values());
}

export async function pullAndReconcile(token: string): Promise<void> {
  const session = await localStore.getSession();
  const lastSyncAt = session?.last_sync_at ?? null;

  const protectedIds = await localStore.getProtectedServerIds();
  const sync = await apiGetSync(token, lastSyncAt);

  if (!lastSyncAt) {
    // First sync: the API returns the complete visible dataset.
    await localStore.reconcileInventory(
      { boats: sync.boats ?? [], categories: sync.categories ?? [], parts: sync.parts ?? [] },
      protectedIds,
    );
  } else {
    // Incremental sync: /api/sync returns only changed rows. Merge those
    // changes with the local cache before calling the existing reconciliation
    // logic, otherwise unchanged local rows would be mistaken for deletions.
    const [currentBoats, currentCategories, currentParts] = await Promise.all([
      localStore.getBoats(),
      localStore.getCategories(),
      localStore.searchParts({}),
    ]);

    const boats = mergeById(currentBoats, sync.boats ?? []);
    const categories = mergeById(currentCategories, sync.categories ?? []);
    const parts = mergeById(currentParts, sync.parts ?? []);

    await localStore.reconcileInventory(
      { boats, categories, parts },
      protectedIds,
    );
  }

  // Advance the cursor only after the complete reconciliation transaction
  // succeeds. The cursor is the server-provided time, never the device clock.
  await localStore.setLastSyncAt(sync.server_time);
}

export async function runSync(token: string): Promise<SyncSummary> {
  const summary = await processQueue(token);
  if (summary.authError || summary.networkError) return summary;

  // A logical rejection is an API-level result inside HTTP 200. Keep a
  // diagnostic even if a future queue-path change fails to attach one.
  if (summary.failed > 0 && !summary.diagnostics) {
    summary.diagnostics = {
      path: "/api/parts/push",
      method: "POST",
      httpStatus: 200,
      kind: "api_result",
      timeout: false,
      fetchError: false,
      parseOk: true,
      bodySnippet: "El servidor devolvió al menos un resultado con status no aceptado.",
      classification: "api_result",
      at: new Date().toISOString(),
    };
  }

  try {
    await pullAndReconcile(token);
  } catch (e) {
    if (e instanceof ApiError && (e.kind === "network" || e.kind === "timeout")) {
      summary.networkError = true;
    } else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      summary.authError = true;
    } else {
      summary.serverError = true;
      if (e instanceof ApiError) {
        summary.diagnostics = errorDiag(e, "/api/sync", "GET");
      } else {
        summary.diagnostics = unknownDiag(e, "/api/sync", "GET");
      }
    }
  }
  return summary;
}
