// Sync Engine.
// Pushes pending changes, then pulls either the initial full snapshot or an
// incremental /api/sync?since=<last_server_time> delta and reconciles it with
// the existing local cache.

import { ApiError } from "@/src/services/api/client";
import { uploadPartPhoto } from "@/src/services/photos/photoService";
import * as FileSystem from "expo-file-system/legacy";
import { apiGetBoats, apiGetSync, apiPush } from "@/src/services/api/endpoints";
import { localStore } from "@/src/database/store";
import { LocalPart, Part, PendingChange, PushChange, PushResult } from "@/src/types";

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
  receivedParts: number;
  receivedActiveParts: number;
  receivedDeletedParts: number;
  cachedParts: number;
  protectedIds: number[];
  missingActiveIds: number[];
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
    receivedParts: 0, receivedActiveParts: 0, receivedDeletedParts: 0, cachedParts: 0,
  };

  const pending = await localStore.getPendingChanges();
  if (pending.length === 0) return summary;

  let errDiag: SyncDiagnostics | null = null;

  for (const entry of pending) {
    summary.pushed++;
    await localStore.markSyncing([entry.queue_id]);

    let response;
    try {
      response = await apiPush(token, [buildChange(entry)]);
    } catch (e) {
      if (e instanceof ApiError) {
        const d = errorDiag(e);
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

async function processPhotoQueue(token: string, summary: SyncSummary): Promise<void> {
  const photos = await localStore.getPendingPhotos();
  for (const photo of photos) {
    if (photo.server_id == null) continue;
    const info = await FileSystem.getInfoAsync(photo.local_path);
    if (!info.exists) {
      await localStore.markPhotoRetry(photo.queue_id, "archivo local de foto no encontrado");
      summary.serverError = true;
      summary.diagnostics = {
        path: `/api/photos/${photo.server_id}`,
        method: "POST",
        httpStatus: null,
        kind: "local_file",
        timeout: false,
        fetchError: false,
        parseOk: true,
        bodySnippet: "Archivo local de foto no encontrado.",
        classification: "local_file",
        at: new Date().toISOString(),
      };
      continue;
    }
    try {
      const result = await uploadPartPhoto(token, photo.server_id, photo.local_path);
      await localStore.applyPhotoOk(photo.row_uid, result.updated_at);
    } catch (e) {
      if (e instanceof ApiError) {
        const d = errorDiag(e, `/api/photos/${photo.server_id}`, "POST");
        summary.diagnostics = summary.diagnostics ?? d;
        if (e.status === 401 || e.status === 403) {
          summary.authError = true;
          return;
        }
        if (e.kind === "network" || e.kind === "timeout") {
          summary.networkError = true;
          return;
        }
        summary.serverError = true;
        await localStore.markPhotoRetry(photo.queue_id, `HTTP ${e.status} (${e.kind})`);
      } else {
        summary.serverError = true;
        summary.diagnostics = summary.diagnostics ?? unknownDiag(e, `/api/photos/${photo.server_id}`, "POST");
        await localStore.markPhotoRetry(photo.queue_id, "error inesperado al subir foto");
      }
    }
  }
}

function mergeById<T extends { id: number }>(current: T[], delta: T[]): T[] {
  const merged = new Map<number, T>();
  for (const row of current) merged.set(row.id, row);
  for (const row of delta) merged.set(row.id, row);
  return Array.from(merged.values());
}

function localPartToServerPart(part: LocalPart): Part | null {
  if (part.server_id == null) return null;
  return {
    id: part.server_id,
    boat_id: part.boat_id,
    name: part.name,
    reference: part.reference,
    category_id: part.category_id,
    location: part.location,
    quantity: part.quantity,
    notes: part.notes,
    photo_path: part.photo_path,
    updated_at: part.updated_at,
    deleted_at: part.deleted_at,
  };
}

function mergeParts(current: LocalPart[], delta: Part[]): Part[] {
  // Incremental reconciliation uses the server_id as the canonical identity.
  // row_uid is a local persistence key and must never be used as the server id.
  const currentServerParts = current
    .map(localPartToServerPart)
    .filter((part): part is Part => part !== null);
  return mergeById(currentServerParts, delta);
}

export async function pullAndReconcile(token: string): Promise<{ receivedParts: number; cachedParts: number }> {
  const session = await localStore.getSession();
  const lastSyncAt = session?.last_sync_at ?? null;

  const protectedIds = await localStore.getProtectedServerIds();
  const sync = await apiGetSync(token, lastSyncAt);

  // Boats are a small administrative catalog and physical boat deletion does
  // not leave a tombstone. Fetch the authoritative boat snapshot directly
  // after every sync so a deleted boat can never remain in the local cache.
  const authoritativeBoats = await apiGetBoats(token);

  if (!lastSyncAt) {
    // First sync: the API returns the complete visible dataset.
    await localStore.reconcileInventory(
      { boats: authoritativeBoats, categories: sync.categories ?? [], parts: sync.parts ?? [] },
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

    const boats = authoritativeBoats;
    const categories = mergeById(currentCategories, sync.categories ?? []);
    const parts = mergeParts(currentParts, sync.parts ?? []);

    await localStore.reconcileInventory(
      { boats, categories, parts },
      protectedIds,
    );
  }

  // Advance the cursor only after the complete reconciliation transaction
  // succeeds. The cursor is the server-provided time, never the device clock.
  await localStore.setLastSyncAt(sync.server_time);
  const counts = await localStore.getCounts();
  const receivedParts = sync.parts ?? [];
  const cached = await localStore.searchParts({});
  const activeIds = receivedParts.filter((p) => !p.deleted_at).map((p) => p.id);
  const cachedIds = new Set(cached.filter((p) => p.server_id != null).map((p) => p.server_id as number));
  return {
    receivedParts: receivedParts.length,
    receivedActiveParts: activeIds.length,
    receivedDeletedParts: receivedParts.filter((p) => !!p.deleted_at).length,
    cachedParts: counts.parts,
    protectedIds: protectedIds,
    missingActiveIds: activeIds.filter((id) => !cachedIds.has(id)),
  };
}

export async function runSync(token: string): Promise<SyncSummary> {
  const summary = await processQueue(token);
  if (summary.authError || summary.networkError) return summary;

  // Inventory reconciliation must not be blocked by an independent photo
  // upload failure. A photo is retried from photo_queue on the next pass.
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
    const syncStats = await pullAndReconcile(token);
    summary.receivedParts = syncStats.receivedParts;
    summary.receivedActiveParts = syncStats.receivedActiveParts;
    summary.receivedDeletedParts = syncStats.receivedDeletedParts;
    summary.cachedParts = syncStats.cachedParts;
    summary.protectedIds = syncStats.protectedIds;
    summary.missingActiveIds = syncStats.missingActiveIds;
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
  if (!summary.authError && !summary.networkError) {
    await processPhotoQueue(token, summary);
  }

  return summary;
}
