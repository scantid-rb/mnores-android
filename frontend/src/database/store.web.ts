// Web persistence: one atomic JSON snapshot through the existing storage util.
// Serialize transactions within this runtime and, where supported, across tabs
// using Web Locks. Native uses store.ts (SQLite).

import { storage } from "@/src/utils/storage";
import {
  Boat,
  Category,
  CreatePartInput,
  EditablePartFields,
  LocalPart,
  Part,
  PendingChange,
  PendingPhoto,
  SessionRow,
  SessionUser,
  User,
} from "@/src/types";
import { LocalStore } from "@/src/database/store.types";
import { newQueueId } from "@/src/utils/id";

const MAX_RETRIES = 5;
const K = {
  session: "db.session",
  users: "db.users",
  boats: "db.boats",
  categories: "db.categories",
  parts: "db.parts",
  queue: "db.queue",
  photos: "db.photo.queue",
};

const SNAPSHOT_KEY = "db.snapshot.v1";
type Snapshot = Record<string, unknown>;
let transaction: Snapshot | null = null;
let dirty = false;
let tail: Promise<unknown> = Promise.resolve();

async function readJson<T>(key: string, fallback: T): Promise<T> {
  if (!transaction) throw new Error("WebStore read outside transaction");
  // Copy reads just as SQLite returns detached rows.
  return JSON.parse(JSON.stringify(transaction[key] ?? fallback)) as T;
}
async function writeJson(key: string, value: unknown): Promise<void> {
  if (!transaction) throw new Error("WebStore write outside transaction");
  transaction[key] = value;
  dirty = true;
}
async function removeJson(key: string): Promise<void> {
  if (!transaction) throw new Error("WebStore delete outside transaction");
  delete transaction[key];
  dirty = true;
}
async function atomic<T>(fn: () => Promise<T>): Promise<T> {
  const execute = async () => {
    const raw = await storage.getItem(SNAPSHOT_KEY, "");
    const snapshot: Snapshot = raw ? JSON.parse(raw) : {};
    if (!raw) {
      // Migrate the previous separate keys. Once committed, the snapshot
      // is the sole authority; legacy keys are never read again.
      for (const key of Object.values(K)) {
        const legacy = await storage.getItem(key, "");
        if (legacy) snapshot[key] = JSON.parse(legacy);
      }
    }
    transaction = snapshot;
    dirty = !raw;
    try {
      const result = await fn();
      if (dirty && !await storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))) {
        throw new Error("No se pudieron guardar los cambios locales");
      }
      return result;
    } finally {
      transaction = null;
      dirty = false;
    }
  };
  const run = () => typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("ShipInventoryWebStore", execute)
    : execute();
  const result = tail.then(run, run);
  tail = result.catch(() => {});
  return result;
}

async function reconcileDependentPhotos(): Promise<void> {
  const queue = await readJson<PendingChange[]>(K.queue, []);
  const photos = await readJson<PendingPhoto[]>(K.photos, []);
  for (const photo of photos) {
    const parent = queue.find(e => e.row_uid === photo.row_uid && e.action === "create");
    if (photo.server_id == null && (photo.status === "pending" || photo.status === "uploading") && parent?.status === "failed") {
      photo.status = "failed";
      photo.last_error = "parent_create_failed";
    }
    if (photo.status === "failed" && photo.last_error === "parent_create_failed" &&
        (photo.server_id != null || parent?.status === "pending" || parent?.status === "syncing")) {
      photo.status = "pending";
      photo.retry_count = 0;
      photo.last_error = null;
    }
  }
  await writeJson(K.photos, photos);
}
const nowIso = () => new Date().toISOString();

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

class WebStore implements LocalStore {
  private parts(): Promise<LocalPart[]> {
    return readJson<LocalPart[]>(K.parts, []);
  }
  private queue(): Promise<PendingChange[]> {
    return readJson<PendingChange[]>(K.queue, []);
  }

  async recoverInterruptedSync(): Promise<void> { await this.init(); }

  async init(): Promise<void> {
    const q = await this.queue();
    let changed = false;
    for (const e of q) {
      if (e.status === "syncing") {
        e.status = "pending";
        changed = true;
      }
    }
    if (changed) await writeJson(K.queue, q);
    const photos = await readJson<PendingPhoto[]>(K.photos, []);
    for (const photo of photos) if (photo.status === "uploading") photo.status = "pending";
    await writeJson(K.photos, photos);
    await reconcileDependentPhotos();
  }

  async saveSession(user: SessionUser): Promise<void> {
    await writeJson(K.session, { ...user, last_sync_at: null } as SessionRow);
  }
  async updateSessionIdentity(user: SessionUser): Promise<void> {
    const current = await this.getSession();
    if (!current || current.id !== user.id) return;
    await writeJson(K.session, {
      ...current,
      username: user.username,
      role: user.role,
      boat_id: user.boat_id,
    } as SessionRow);
  }
  async getSession(): Promise<SessionRow | null> {
    return readJson<SessionRow | null>(K.session, null);
  }
  async clearSession(): Promise<void> {
    await removeJson(K.session);
  }
  async clearUserData(): Promise<void> {
    await removeJson(K.parts);
    await removeJson(K.queue);
    await removeJson(K.photos);
    await removeJson(K.users);
    await removeJson(K.boats);
    await removeJson(K.categories);
  }
  async setLastSyncAt(serverTime: string): Promise<void> {
    const s = await this.getSession();
    if (s) {
      s.last_sync_at = serverTime;
      await writeJson(K.session, s);
    }
  }

  async reconcileInventory(
    data: { boats: Boat[]; categories: Category[]; parts: Part[]; users?: User[] },
    protectedServerIds: number[],
    serverTime?: string,
  ): Promise<void> {
    await writeJson(K.users, data.users ?? []);
    await writeJson(K.boats, data.boats);
    await writeJson(K.categories, data.categories);

    const protectedSet = new Set(protectedServerIds);
    // Tombstones are authoritative deletions. Protected rows remain untouched
    // until their pending operation is resolved.
    const serverIds = new Set(data.parts.filter((p) => !p.deleted_at).map((p) => p.id));
    const local = await this.parts();

    // Merge into existing rows so local row identifiers and offline photos survive.
    const kept = [...local];

    for (const p of data.parts) {
      if (protectedSet.has(p.id)) continue;
      if (p.deleted_at) {
        // A tombstone removes every cached duplicate for this server id.
        const withoutDeleted = kept.filter((row) => row.server_id !== p.id);
        kept.length = 0;
        kept.push(...withoutDeleted);
        await writeJson(K.photos, (await readJson<PendingPhoto[]>(K.photos, [])).filter(photo => photo.server_id !== p.id));
        continue;
      }

      // Repair any duplicate local rows for the same canonical server id.
      const matches = kept.filter((row) => row.server_id === p.id || row.row_uid === `srv-${p.id}`);
      if (matches.length > 0) {
        const canonical =
          matches.find((row) => row.row_uid === `srv-${p.id}`) ??
          matches.find((row) => row.sync_state === "synced") ??
          matches[0];
        const canonicalIndex = kept.findIndex((row) => row.row_uid === canonical.row_uid);
        kept[canonicalIndex] = {
          ...canonical,
          server_id: p.id,
          local_id: null,
          boat_id: p.boat_id,
          name: p.name,
          reference: p.reference ?? null,
          category_id: p.category_id ?? null,
          location: p.location ?? null,
          quantity: p.quantity ?? 0,
          notes: p.notes ?? null,
          photo_path: p.photo_path ?? null,
          local_photo_path: canonical.local_photo_path ?? null,
          updated_at: p.updated_at ?? null,
          deleted_at: p.deleted_at ?? null,
          pending_delete: 0,
          sync_state: "synced",
        };
        const duplicateUids = new Set(matches.map((row) => row.row_uid));
        duplicateUids.delete(canonical.row_uid);
        for (let i = kept.length - 1; i >= 0; i--) {
          if (duplicateUids.has(kept[i].row_uid)) kept.splice(i, 1);
        }
        continue;
      }

      kept.push({
        row_uid: `srv-${p.id}`,
        server_id: p.id,
        local_id: null,
        boat_id: p.boat_id,
        name: p.name,
        reference: p.reference ?? null,
        category_id: p.category_id ?? null,
        location: p.location ?? null,
        quantity: p.quantity ?? 0,
        notes: p.notes ?? null,
        photo_path: p.photo_path ?? null,
        local_photo_path: null,
        updated_at: p.updated_at ?? null,
        deleted_at: p.deleted_at ?? null,
        pending_delete: 0,
        sync_state: "synced",
      });
    }

    // Drop synced local rows no longer on the server.
    const merged = kept.filter((p) => {
      if (p.server_id != null && p.sync_state === "synced" && !serverIds.has(p.server_id) && !protectedSet.has(p.server_id)) {
        return false;
      }
      return true;
    });

    await writeJson(K.parts, merged);
    if (serverTime) await this.setLastSyncAt(serverTime);
  }

  async getUsers(): Promise<User[]> {
    return readJson<User[]>(K.users, []);
  }

  async getBoats(): Promise<Boat[]> {
    return (await readJson<Boat[]>(K.boats, [])).filter((b) => !b.deleted_at);
  }
  async getCategories(): Promise<Category[]> {
    return (await readJson<Category[]>(K.categories, []))
      .filter((c) => !c.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async searchParts(opts: { query?: string; categoryId?: number | null; boatId?: number | null }): Promise<LocalPart[]> {
    const q = opts.query?.trim().toLowerCase();
    return (await this.parts())
      .filter((p) => p.pending_delete === 0 && !p.deleted_at)
      .filter((p) => opts.boatId == null || p.boat_id === opts.boatId)
      .filter((p) => (opts.categoryId != null ? p.category_id === opts.categoryId : true))
      .filter((p) => {
        if (!q) return true;
        return (
          p.name?.toLowerCase().includes(q) ||
          p.reference?.toLowerCase().includes(q) ||
          p.location?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPart(rowUid: string): Promise<LocalPart | null> {
    return (await this.parts()).find((p) => p.row_uid === rowUid) ?? null;
  }

  async getCounts(): Promise<{ boats: number; categories: number; parts: number }> {
    const parts = (await this.parts()).filter((p) => p.pending_delete === 0 && !p.deleted_at);
    return {
      boats: (await this.getBoats()).length,
      categories: (await this.getCategories()).length,
      parts: parts.length,
    };
  }

  async createPartLocal(input: CreatePartInput): Promise<LocalPart> {
    const parts = await this.parts();
    const q = await this.queue();
    const row: LocalPart = {
      row_uid: input.local_id,
      server_id: null,
      local_id: input.local_id,
      boat_id: input.boat_id,
      name: input.name,
      reference: input.reference ?? null,
      category_id: input.category_id ?? null,
      location: input.location ?? null,
      quantity: input.quantity ?? 0,
      notes: input.notes ?? null,
      photo_path: null,
      local_photo_path: null,
      updated_at: null,
      deleted_at: null,
      pending_delete: 0,
      sync_state: "pending",
    };
    if (parts.some(p => p.row_uid === row.row_uid)) throw new Error("El repuesto local ya existe");
    parts.push(row);
    q.push({
      queue_id: newQueueId(),
      action: "create",
      entity: "part",
      entity_id: null,
      row_uid: input.local_id,
      client_local_id: input.local_id,
      payload: JSON.stringify({
        boat_id: input.boat_id,
        name: input.name,
        reference: input.reference,
        category_id: input.category_id,
        location: input.location,
        quantity: input.quantity,
        notes: input.notes,
      }),
      base_updated_at: null,
      created_at: nowIso(),
      retry_count: 0,
      last_error: null,
      status: "pending",
    });
    await writeJson(K.parts, parts);
    await writeJson(K.queue, q);
    return row;
  }

  async updatePartLocal(rowUid: string, fields: EditablePartFields): Promise<LocalPart | null> {
    const parts = await this.parts();
    const idx = parts.findIndex((p) => p.row_uid === rowUid);
    if (idx < 0) return null;
    const part = parts[idx];
    const clean = stripUndefined(fields);
    parts[idx] = { ...part, ...clean, sync_state: "pending" } as LocalPart;
    await writeJson(K.parts, parts);

    const q = await this.queue();
    if (part.server_id == null) {
      const ce = q.find((e) => e.row_uid === rowUid && e.action === "create");
      if (ce?.status === "failed" && ["invalid", "forbidden"].includes(ce.last_error ?? "")) {
        const edits = q.filter(e => e.row_uid === rowUid && e.action === "update");
        ce.payload = JSON.stringify(Object.assign(JSON.parse(ce.payload), ...edits.map(e => JSON.parse(e.payload)), clean));
        ce.status = "pending";
        ce.retry_count = 0;
        ce.last_error = null;
        for (const edit of edits) q.splice(q.indexOf(edit), 1);
      } else if (ce && (ce.status === "syncing" || ce.retry_count > 0)) {
        if (ce.status === "failed") {
          ce.status = "pending";
          ce.retry_count = 1;
          ce.last_error = null;
        }
        q.push(this.change("update", part, clean));
      } else if (ce) {
        ce.payload = JSON.stringify({ ...JSON.parse(ce.payload || "{}"), ...clean });
        ce.status = "pending";
      }
    } else {
      const ue = q.find((e) => e.row_uid === rowUid && e.action === "update" && e.status === "pending");
      if (ue) {
        ue.payload = JSON.stringify({ ...JSON.parse(ue.payload || "{}"), ...clean });
        ue.status = "pending";
      } else {
        q.push({
          queue_id: newQueueId(),
          action: "update",
          entity: "part",
          entity_id: part.server_id,
          row_uid: rowUid,
          client_local_id: null,
          payload: JSON.stringify(clean),
          base_updated_at: part.updated_at,
          created_at: nowIso(),
          retry_count: 0,
          last_error: null,
          status: "pending",
        });
      }
    }
    await writeJson(K.queue, q);
    await reconcileDependentPhotos();
    return parts[idx];
  }

  async deletePartLocal(rowUid: string): Promise<void> {
    const parts = await this.parts();
    const part = parts.find((p) => p.row_uid === rowUid);
    if (!part) return;
    let q = await this.queue();

    if (part.server_id == null) {
      const create = q.find(e => e.row_uid === rowUid && e.action === "create");
      if (create && (create.status === "syncing" || create.retry_count > 0)) {
        part.pending_delete = 1;
        part.sync_state = "pending";
        q.push(this.change("delete", part, {}));
        await writeJson(K.parts, parts);
      } else {
        q = q.filter(e => e.row_uid !== rowUid);
        await writeJson(K.parts, parts.filter(p => p.row_uid !== rowUid));
      }
    } else {
      q = q.filter(e => !(e.row_uid === rowUid && e.action === "update" && e.status === "pending"));
      part.pending_delete = 1;
      part.sync_state = "pending";
      await writeJson(K.parts, parts);
      q.push(this.change("delete", part, { id: part.server_id }));
    }
    await writeJson(K.photos, (await readJson<PendingPhoto[]>(K.photos, [])).filter(p => p.row_uid !== rowUid));
    await writeJson(K.queue, q);
  }

  private change(action: "update" | "delete", part: LocalPart, fields: object): PendingChange {
    return { queue_id: newQueueId(), action, entity: "part", entity_id: part.server_id,
      row_uid: part.row_uid, client_local_id: null, payload: JSON.stringify(fields),
      base_updated_at: part.updated_at, created_at: nowIso(), retry_count: 0, last_error: null, status: "pending" };
  }

  async getPendingChanges(): Promise<PendingChange[]> {
    return (await this.queue())
      .filter((e) => e.status === "pending" || e.status === "syncing")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async getPendingCount(): Promise<number> {
    const queueCount = (await this.queue()).filter((e) => e.status === "pending" || e.status === "syncing").length;
    const photoCount = (await readJson<PendingPhoto[]>(K.photos, [])).filter((p) => p.status === "pending" || p.status === "uploading").length;
    return queueCount + photoCount;
  }
  async getProtectedServerIds(): Promise<number[]> {
    const ids = (await this.queue()).map((e) => e.entity_id).filter((v): v is number => v != null);
    return Array.from(new Set(ids));
  }

  async claimChange(queueId: string): Promise<PendingChange | null> {
    const q = await this.queue();
    const entry = q.find(e => e.queue_id === queueId && e.status === "pending");
    if (!entry || (entry.action !== "create" && entry.entity_id == null)) return null;
    const claimed = { ...entry, status: "syncing" as const };
    entry.status = "syncing";
    entry.retry_count = Math.max(1, entry.retry_count);
    await writeJson(K.queue, q);
    return claimed;
  }
  async claimPhoto(queueId: string): Promise<PendingPhoto | null> {
    const photos = await readJson<PendingPhoto[]>(K.photos, []);
    const photo = photos.find(p => p.queue_id === queueId && p.status === "pending" && p.server_id != null);
    if (!photo) return null;
    photo.status = "uploading";
    await writeJson(K.photos, photos);
    return photo;
  }
  async getFailedChanges(): Promise<(PendingChange | PendingPhoto)[]> {
    return [...(await this.queue()).filter(e => e.status === "failed"),
      ...(await readJson<PendingPhoto[]>(K.photos, [])).filter(p => p.status === "failed")];
  }
  async retryFailed(): Promise<void> {
    const q = await this.queue();
    for (const e of q) if (e.status === "failed") {
      e.status = "pending";
      e.retry_count = e.action === "create" ? 1 : 0;
      e.last_error = null;
    }
    const photos = await readJson<PendingPhoto[]>(K.photos, []);
    for (const photo of photos) if (photo.status === "failed") {
      photo.status = "pending"; photo.retry_count = 0; photo.last_error = null;
    }
    const parts = await this.parts();
    for (const part of parts) if (q.some(e => e.row_uid === part.row_uid)) part.sync_state = "pending";
    await writeJson(K.queue, q);
    await writeJson(K.photos, photos);
    await writeJson(K.parts, parts);
    await reconcileDependentPhotos();
  }
  async discardFailed(): Promise<void> {
    const q = await this.queue();
    const failedCreates = new Set(q.filter(e => e.status === "failed" && e.action === "create").map(e => e.row_uid));
    const remaining = q.filter(e => e.status !== "failed" && !failedCreates.has(e.row_uid));
    const photos = (await readJson<PendingPhoto[]>(K.photos, [])).filter(p => !failedCreates.has(p.row_uid));
    const failedPhotoRows = new Set(photos.filter(p => p.status === "failed").map(p => p.row_uid));
    const failedRows = new Set(q.filter(e => e.status === "failed").map(e => e.row_uid));
    const parts = (await this.parts()).filter(p => !failedRows.has(p.row_uid) || remaining.some(e => e.row_uid === p.row_uid));
    for (const part of parts) if (failedPhotoRows.has(part.row_uid)) part.local_photo_path = null;
    await writeJson(K.parts, parts);
    await writeJson(K.queue, remaining);
    await writeJson(K.photos, photos.filter(p => p.status !== "failed"));
    const session = await this.getSession();
    if (session) { session.last_sync_at = null; await writeJson(K.session, session); }
  }
  async reconcileAndSetCursor(data: { boats: Boat[]; categories: Category[]; parts: Part[]; users?: User[] }, serverTime: string): Promise<void> {
    await this.reconcileInventory(data, await this.getProtectedServerIds(), serverTime);
  }

  async markSyncing(queueIds: string[]): Promise<void> {
    const q = await this.queue();
    for (const e of q) if (queueIds.includes(e.queue_id)) e.status = "syncing";
    await writeJson(K.queue, q);
  }
  async revertSyncing(queueIds: string[]): Promise<void> {
    const q = await this.queue();
    for (const e of q) if (queueIds.includes(e.queue_id)) e.status = "pending";
    await writeJson(K.queue, q);
  }

  async applyCreateOk(queueId: string, rowUid: string, serverId: number, updatedAt: string): Promise<void> {
    const parts = await this.parts();
    const q = (await this.queue()).filter(e => e.queue_id !== queueId);
    const deferred = q.filter(e => e.row_uid === rowUid && e.entity_id == null && e.action !== "create");
    const part = parts.find(p => p.row_uid === rowUid);
    if (part) {
      part.server_id = serverId;
      part.updated_at = updatedAt;
      part.sync_state = deferred.length ? "pending" : "synced";
      if (q.some(e => e.row_uid === rowUid && e.action === "delete")) part.pending_delete = 1;
    }
    for (const e of deferred) {
      e.entity_id = serverId;
      e.base_updated_at = updatedAt;
      if (e.action === "delete") e.payload = JSON.stringify({ id: serverId });
    }
    await this.applyPhotoServerId(rowUid, serverId);
    await writeJson(K.parts, parts);
    await writeJson(K.queue, q);
    await reconcileDependentPhotos();
  }
  async applyUpdateOk(queueId: string, serverId: number, updatedAt: string): Promise<void> {
    const parts = await this.parts();
    const q = await this.queue();
    const current = q.find(e => e.queue_id === queueId);
    const newer = q.filter(e => e.row_uid === current?.row_uid && e.queue_id !== queueId && (e.status === "pending" || e.status === "syncing"));
    for (const part of parts) if (part.server_id === serverId) {
      part.updated_at = updatedAt;
      part.sync_state = newer.length ? "pending" : "synced";
    }
    for (const e of newer) if (e.entity_id === serverId && e.action !== "create") e.base_updated_at = updatedAt;
    await writeJson(K.parts, parts);
    await writeJson(K.queue, q.filter(e => e.queue_id !== queueId));
  }
  async applyDeleteOk(queueId: string, serverId: number): Promise<void> {
    const parts = await this.parts();
    const row = parts.find(p => p.server_id === serverId);
    await writeJson(K.parts, parts.filter(p => p.server_id !== serverId));
    await writeJson(K.queue, (await this.queue()).filter(e => e.queue_id !== queueId && e.entity_id !== serverId && e.row_uid !== row?.row_uid));
    await writeJson(K.photos, (await readJson<PendingPhoto[]>(K.photos, [])).filter(p => p.server_id !== serverId && p.row_uid !== row?.row_uid));
  }
  async setLocalPhoto(rowUid: string, localPath: string): Promise<void> {
    const parts = await this.parts();
    const idx = parts.findIndex((p) => p.row_uid === rowUid);
    if (idx < 0) throw new Error("Pieza no encontrada");
    parts[idx] = { ...parts[idx], local_photo_path: localPath };
    const q = await readJson<PendingPhoto[]>(K.photos, []);
    const filtered = q.filter((p) => p.row_uid !== rowUid || p.status === "uploading");
    filtered.push({ queue_id: newQueueId(), row_uid: rowUid, server_id: parts[idx].server_id, local_path: localPath, retry_count: 0, last_error: null, status: "pending", created_at: nowIso() });
    await writeJson(K.parts, parts);
    await writeJson(K.photos, filtered);
    await reconcileDependentPhotos();
  }
  async getPendingPhotos(): Promise<PendingPhoto[]> {
    return (await readJson<PendingPhoto[]>(K.photos, [])).filter(p => p.status === "pending" || p.status === "uploading").sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async applyPhotoServerId(rowUid: string, serverId: number): Promise<void> {
    const q = await readJson<PendingPhoto[]>(K.photos, []);
    for (const p of q) if (p.row_uid === rowUid) p.server_id = serverId;
    await writeJson(K.photos, q);
  }
  async applyPhotoOk(queueId: string, serverUpdatedAt: string): Promise<void> {
    const photos = await readJson<PendingPhoto[]>(K.photos, []);
    const photo = photos.find(p => p.queue_id === queueId);
    if (!photo) return;
    const parts = await this.parts();
    const part = parts.find(p => p.row_uid === photo.row_uid);
    if (part) {
      part.photo_path = "remote";
      part.updated_at = serverUpdatedAt;
      if (part.local_photo_path === photo.local_path) part.local_photo_path = null;
    }
    await writeJson(K.parts, parts);
    await writeJson(K.photos, photos.filter(p => p.queue_id !== queueId));
  }
  async revertPhotoUploading(queueId: string): Promise<void> {
    const photos = await readJson<PendingPhoto[]>(K.photos, []);
    const photo = photos.find((item) => item.queue_id === queueId);
    if (photo?.status === "uploading") photo.status = "pending";
    await writeJson(K.photos, photos);
  }

  async markPhotoRetry(queueId: string, lastError: string): Promise<void> {
    const q = await readJson<PendingPhoto[]>(K.photos, []);
    const p = q.find((x) => x.queue_id === queueId);
    if (p) { p.retry_count += 1; p.last_error = lastError; p.status = p.retry_count >= MAX_RETRIES ? "failed" : "pending"; }
    await writeJson(K.photos, q);
  }
  async markConflict(rowUid: string): Promise<void> {
    const parts = await this.parts();
    const idx = parts.findIndex((p) => p.row_uid === rowUid);
    if (idx >= 0) parts[idx] = { ...parts[idx], sync_state: "conflict" };
    await writeJson(K.parts, parts);
  }
  async markFailed(queueId: string, rowUid: string, lastError: string): Promise<void> {
    const q = await this.queue();
    const e = q.find((x) => x.queue_id === queueId);
    if (e) {
      e.status = "failed";
      e.last_error = lastError;
    }
    await writeJson(K.queue, q);
    const parts = await this.parts();
    const idx = parts.findIndex((p) => p.row_uid === rowUid);
    if (idx >= 0) parts[idx] = { ...parts[idx], sync_state: "error" };
    await writeJson(K.parts, parts);
    await reconcileDependentPhotos();
  }
  async markRetry(queueId: string, lastError: string): Promise<void> {
    const q = await this.queue();
    const e = q.find((x) => x.queue_id === queueId);
    if (e) {
      e.retry_count += 1;
      e.last_error = lastError;
      e.status = e.retry_count >= MAX_RETRIES ? "failed" : "pending";
      if (e.status === "failed") {
        const parts = await this.parts();
        const idx = parts.findIndex((p) => p.row_uid === e.row_uid);
        if (idx >= 0) parts[idx] = { ...parts[idx], sync_state: "error" };
        await writeJson(K.parts, parts);
      }
    }
    await writeJson(K.queue, q);
    await reconcileDependentPhotos();
  }
}

// Wrap only external calls: internal method calls share the same transaction.
export const localStore: LocalStore = new Proxy(new WebStore(), {
  get(target, property, receiver) {
    const method = Reflect.get(target, property, receiver);
    return typeof method === "function"
      ? (...args: unknown[]) => atomic(() => method.apply(target, args))
      : method;
  },
});
