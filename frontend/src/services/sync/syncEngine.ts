// Sync Engine.
// Pushes pending changes, then pulls either the initial full snapshot or an
// incremental /api/sync?since=<last_server_time> delta and reconciles it with
// the existing local cache.

import { ApiError } from "@/src/services/api/client";
import { photoExists, uploadPartPhoto } from "@/src/services/photos/photoService";
import { apiGetBoats, apiGetCategories, apiGetSync, apiGetUsers, apiPush } from "@/src/services/api/endpoints";
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
  console.info("[SYNC] applyOk", {
    queue_id: entry.queue_id,
    action: entry.action,
    row_uid: entry.row_uid,
    client_local_id: entry.client_local_id,
    server_id: res.id ?? null,
    status: res.status,
  });
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
    protectedIds: [], missingActiveIds: [],
  };

  const pending = await localStore.getPendingChanges();
  console.info("[SYNC] queue before", {
    count: pending.length,
    entries: pending.map((e) => ({
      queue_id: e.queue_id,
      action: e.action,
      row_uid: e.row_uid,
      client_local_id: e.client_local_id,
      entity_id: e.entity_id,
      status: e.status,
    })),
  });
  if (pending.length === 0) return summary;

  let errDiag: SyncDiagnostics | null = null;

  const attempted = new Set<string>();
  for (;;) {
    const candidate = (await localStore.getPendingChanges()).find((e) => e.status === "pending" && !attempted.has(e.queue_id));
    if (!candidate) break;
    attempted.add(candidate.queue_id);
    const entry = await localStore.claimChange(candidate.queue_id);
    if (!entry) continue;
    summary.pushed++;
    console.info("[SYNC] sending", {
      queue_id: entry.queue_id,
      action: entry.action,
      row_uid: entry.row_uid,
      client_local_id: entry.client_local_id,
    });

    let response;
    try {
      response = await apiPush(token, [buildChange(entry)]);
      console.info("[SYNC] server response", {
        queue_id: entry.queue_id,
        action: entry.action,
        client_local_id: entry.client_local_id,
        ok: response?.ok ?? null,
        results: response?.results ?? [],
      });
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
    console.info("[SYNC] match", {
      queue_id: entry.queue_id,
      action: entry.action,
      client_local_id: entry.client_local_id,
      matched: !!res,
      result: res ?? null,
    });

    if (!res) {
      await localStore.markRetry(entry.queue_id, "sin resultado del servidor");
      continue;
    }

    switch (res.status) {
      case "ok":
        summary.ok++;
        await applyOk(entry, res);
        console.info("[SYNC] applyOk completed", { queue_id: entry.queue_id });
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

  // Preserve a logical API rejection diagnostic; a later HTTP-200 success must not overwrite it.\n  summary.diagnostics = errDiag ?? summary.diagnostics;
  const pendingAfter = await localStore.getPendingChanges();
  console.info("[SYNC] queue after", {
    count: pendingAfter.length,
    entries: pendingAfter.map((e) => ({
      queue_id: e.queue_id,
      action: e.action,
      row_uid: e.row_uid,
      client_local_id: e.client_local_id,
      entity_id: e.entity_id,
      status: e.status,
    })),
  });
  return summary;
}

async function processPhotoQueue(token: string, summary: SyncSummary): Promise<void> {
  const photos = await localStore.getPendingPhotos();
  for (const candidate of photos) {
    const photo = await localStore.claimPhoto(candidate.queue_id);
    if (!photo || photo.server_id == null) continue;
    const exists = await photoExists(photo.local_path);
    if (!exists) {
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
      await localStore.applyPhotoOk(photo.queue_id, result.updated_at);
    } catch (e) {
      if (e instanceof ApiError) {
        const d = errorDiag(e, `/api/photos/${photo.server_id}`, "POST");
        summary.diagnostics = summary.diagnostics ?? d;
        if (e.status === 401 || e.status === 403) {
          summary.authError = true;
          await localStore.markPhotoRetry(photo.queue_id, "Sesión no autorizada");
          return;
        }
        if (e.kind === "network" || e.kind === "timeout") {
          summary.networkError = true;
          await localStore.markPhotoRetry(photo.queue_id, "Sin conexión");
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

export async function pullAndReconcile(token: string): Promise<Pick<SyncSummary, "receivedParts" | "receivedActiveParts" | "receivedDeletedParts" | "cachedParts" | "protectedIds" | "missingActiveIds">> {
  const session = await localStore.getSession();
  const lastSyncAt = session?.last_sync_at ?? null;

  const protectedIds = await localStore.getProtectedServerIds();
  const sync = await apiGetSync(token, lastSyncAt);

  // Boats are a small administrative catalog and physical boat deletion does
  // not leave a tombstone. Fetch the authoritative boat snapshot directly
  // after every sync so a deleted boat can never remain in the local cache.
  const [authoritativeBoats, authoritativeCategories, authoritativeUsers] = await Promise.all([
    apiGetBoats(token),
    apiGetCategories(token),
    apiGetUsers(token),
  ]);

  if (!lastSyncAt) {
    // First sync: the API returns the complete visible dataset.
    await localStore.reconcileAndSetCursor(
      { boats: authoritativeBoats, users: authoritativeUsers, categories: authoritativeCategories, parts: sync.parts ?? [] }, sync.server_time,
    );
  } else {
    // Incremental sync: /api/sync returns only changed rows. Merge those
    // changes with the local cache before calling the existing reconciliation
    // logic, otherwise unchanged local rows would be mistaken for deletions.
    const currentParts = await localStore.searchParts({});

    const boats = authoritativeBoats;
    const categories = authoritativeCategories;
    const parts = mergeParts(currentParts, sync.parts ?? []);

    await localStore.reconcileAndSetCursor(
      { boats, users: authoritativeUsers, categories, parts }, sync.server_time,
    );
  }

  // Advance the cursor only after the complete reconciliation transaction
  // succeeds. The cursor is the server-provided time, never the device clock.
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

  const failures = await localStore.getFailedChanges();
  if (failures.length > 0) {
    summary.failed = Math.max(summary.failed, failures.length);
    summary.diagnostics ??= {
      path: "cola local", method: "POST", httpStatus: null, kind: "queue_failure",
      timeout: false, fetchError: false, parseOk: true,
      bodySnippet: failures.map((entry) => entry.last_error ?? "Operación fallida").join("; ").slice(0, 300),
      classification: "failed", at: new Date().toISOString(),
    };
  }
  return summary;
}
