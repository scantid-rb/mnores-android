// Web fallback for the local store (preview rendering). Backed by the storage
// util. Mirrors store.ts semantics with in-memory arrays serialized to JSON.
// Native uses store.ts (real SQLite).

import { storage } from "@/src/utils/storage";
import {
  Boat,
  Category,
  CreatePartInput,
  EditablePartFields,
  LocalPart,
  Part,
  PendingChange,
  SessionRow,
  SessionUser,
} from "@/src/types";
import { LocalStore } from "@/src/database/store.types";
import { newQueueId } from "@/src/utils/id";

const MAX_RETRIES = 5;
const K = {
  session: "db.session",
  boats: "db.boats",
  categories: "db.categories",
  parts: "db.parts",
  queue: "db.queue",
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await storage.getItem(key, "");
  if (!raw) return fallback;
  try {
    return JSON.parse(raw as string) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  await storage.setItem(key, JSON.stringify(value));
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
  }

  async saveSession(user: SessionUser): Promise<void> {
    await writeJson(K.session, { ...user, last_sync_at: null } as SessionRow);
  }
  async getSession(): Promise<SessionRow | null> {
    return readJson<SessionRow | null>(K.session, null);
  }
  async clearSession(): Promise<void> {
    await storage.removeItem(K.session);
  }
  async clearUserData(): Promise<void> {
    await storage.removeItem(K.parts);
    await storage.removeItem(K.queue);
    await storage.removeItem(K.boats);
    await storage.removeItem(K.categories);
  }
  async setLastSyncAt(serverTime: string): Promise<void> {
    const s = await this.getSession();
    if (s) {
      s.last_sync_at = serverTime;
      await writeJson(K.session, s);
    }
  }

  async reconcileInventory(
    data: { boats: Boat[]; categories: Category[]; parts: Part[] },
    protectedServerIds: number[],
  ): Promise<void> {
    await writeJson(K.boats, data.boats);
    await writeJson(K.categories, data.categories);

    const protectedSet = new Set(protectedServerIds);
    // Tombstones are authoritative deletions. Protected rows remain untouched
    // until their pending operation is resolved.
    const serverIds = new Set(data.parts.filter((p) => !p.deleted_at).map((p) => p.id));
    const local = await this.parts();

    // Keep protected rows and pending-create rows (server_id null).
    const kept = local.filter(
      (p) => p.server_id == null || protectedSet.has(p.server_id),
    );
    const keptServerIds = new Set(kept.filter((p) => p.server_id != null).map((p) => p.server_id));

    for (const p of data.parts) {
      if (protectedSet.has(p.id)) continue;
      if (p.deleted_at) {
        // A tombstone removes every cached duplicate for this server id.
        const withoutDeleted = kept.filter((row) => row.server_id !== p.id);
        kept.length = 0;
        kept.push(...withoutDeleted);
        continue;
      }

      // Repair any duplicate local rows for the same canonical server id.
      const matches = kept.filter((row) => row.server_id === p.id);
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
    void serverIds;
  }

  async getBoats(): Promise<Boat[]> {
    return (await readJson<Boat[]>(K.boats, [])).filter((b) => !b.deleted_at);
  }
  async getCategories(): Promise<Category[]> {
    return (await readJson<Category[]>(K.categories, []))
      .filter((c) => !c.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async searchParts(opts: { query?: string; categoryId?: number | null }): Promise<LocalPart[]> {
    const q = opts.query?.trim().toLowerCase();
    return (await this.parts())
      .filter((p) => p.pending_delete === 0 && !p.deleted_at)
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
      updated_at: null,
      deleted_at: null,
      pending_delete: 0,
      sync_state: "pending",
    };
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
      if (ce) {
        ce.payload = JSON.stringify({ ...JSON.parse(ce.payload || "{}"), ...clean });
        ce.status = "pending";
      }
    } else {
      const ue = q.find((e) => e.row_uid === rowUid && e.action === "update" && (e.status === "pending" || e.status === "syncing"));
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
    return parts[idx];
  }

  async deletePartLocal(rowUid: string): Promise<void> {
    const parts = await this.parts();
    const part = parts.find((p) => p.row_uid === rowUid);
    if (!part) return;
    let q = await this.queue();

    if (part.server_id == null) {
      q = q.filter((e) => !(e.row_uid === rowUid && e.action === "create"));
      await writeJson(K.parts, parts.filter((p) => p.row_uid !== rowUid));
    } else {
      q = q.filter((e) => !(e.row_uid === rowUid && e.action === "update" && e.status === "pending"));
      const idx = parts.findIndex((p) => p.row_uid === rowUid);
      parts[idx] = { ...part, pending_delete: 1, sync_state: "pending" };
      await writeJson(K.parts, parts);
      q.push({
        queue_id: newQueueId(),
        action: "delete",
        entity: "part",
        entity_id: part.server_id,
        row_uid: rowUid,
        client_local_id: null,
        payload: JSON.stringify({ id: part.server_id }),
        base_updated_at: part.updated_at,
        created_at: nowIso(),
        retry_count: 0,
        last_error: null,
        status: "pending",
      });
    }
    await writeJson(K.queue, q);
  }

  async getPendingChanges(): Promise<PendingChange[]> {
    return (await this.queue())
      .filter((e) => e.status === "pending" || e.status === "syncing")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async getPendingCount(): Promise<number> {
    return (await this.queue()).filter((e) => e.status === "pending" || e.status === "syncing").length;
  }
  async getProtectedServerIds(): Promise<number[]> {
    const ids = (await this.queue()).map((e) => e.entity_id).filter((v): v is number => v != null);
    return Array.from(new Set(ids));
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
    const idx = parts.findIndex((p) => p.row_uid === rowUid);
    if (idx >= 0) parts[idx] = { ...parts[idx], server_id: serverId, updated_at: updatedAt, sync_state: "synced" };
    await writeJson(K.parts, parts);
    await writeJson(K.queue, (await this.queue()).filter((e) => e.queue_id !== queueId));
  }
  async applyUpdateOk(queueId: string, serverId: number, updatedAt: string): Promise<void> {
    const parts = await this.parts();
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].server_id === serverId) parts[i] = { ...parts[i], updated_at: updatedAt, sync_state: "synced" };
    }
    await writeJson(K.parts, parts);
    await writeJson(K.queue, (await this.queue()).filter((e) => e.queue_id !== queueId));
  }
  async applyDeleteOk(queueId: string, serverId: number): Promise<void> {
    await writeJson(K.parts, (await this.parts()).filter((p) => p.server_id !== serverId));
    await writeJson(K.queue, (await this.queue()).filter((e) => e.queue_id !== queueId));
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
  }
}

export const localStore: LocalStore = new WebStore();
