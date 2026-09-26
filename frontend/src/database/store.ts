// Native local persistence (expo-sqlite). Offline-first: parts are keyed by a
// stable local row_uid; server_id is null until a create is acknowledged. All
// local mutations write the part row and its pending_changes entry inside one
// transaction so an operation can never be lost mid-write.

import * as SQLite from "expo-sqlite";

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
const SCHEMA_VERSION = 2;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync("mnores.db");
  return dbPromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

class SqliteStore implements LocalStore {
  async init(): Promise<void> {
    const db = await getDb();

    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS session (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        boat_id INTEGER NOT NULL,
        last_sync_at TEXT
      );

      CREATE TABLE IF NOT EXISTS boats (
        id INTEGER PRIMARY KEY,
        name TEXT, registration TEXT, is_active INTEGER,
        updated_at TEXT, deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT, is_system INTEGER,
        updated_at TEXT, deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_changes (
        queue_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        row_uid TEXT NOT NULL,
        client_local_id TEXT,
        payload TEXT,
        base_updated_at TEXT,
        created_at TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        status TEXT DEFAULT 'pending'
      );
    `);

    // parts table: rebuilt at schema v2 to move the primary key to row_uid.
    const ver = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version;");
    if ((ver?.user_version ?? 0) < SCHEMA_VERSION) {
      await db.execAsync(`
        DROP TABLE IF EXISTS parts;
        CREATE TABLE parts (
          row_uid TEXT PRIMARY KEY,
          server_id INTEGER,
          local_id TEXT,
          boat_id INTEGER,
          name TEXT,
          reference TEXT,
          category_id INTEGER,
          location TEXT,
          quantity INTEGER,
          notes TEXT,
          photo_path TEXT,
          updated_at TEXT,
          deleted_at TEXT,
          pending_delete INTEGER DEFAULT 0,
          sync_state TEXT DEFAULT 'synced'
        );
        CREATE INDEX IF NOT EXISTS idx_parts_name ON parts(name);
        CREATE INDEX IF NOT EXISTS idx_parts_reference ON parts(reference);
        CREATE INDEX IF NOT EXISTS idx_parts_location ON parts(location);
        CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category_id);
        CREATE INDEX IF NOT EXISTS idx_parts_server ON parts(server_id);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    }

    // Recover any operation left mid-flight by a previous crash/close.
    await db.runAsync("UPDATE pending_changes SET status = 'pending' WHERE status = 'syncing';");
  }

  // -------------------------------------------------------------- session
  async saveSession(user: SessionUser): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM session;");
      await db.runAsync(
        "INSERT INTO session (id, username, role, boat_id, last_sync_at) VALUES (?, ?, ?, ?, NULL);",
        [user.id, user.username, user.role, user.boat_id],
      );
    });
  }

  async getSession(): Promise<SessionRow | null> {
    const db = await getDb();
    return (
      (await db.getFirstAsync<SessionRow>(
        "SELECT id, username, role, boat_id, last_sync_at FROM session LIMIT 1;",
      )) ?? null
    );
  }

  async clearSession(): Promise<void> {
    const db = await getDb();
    await db.runAsync("DELETE FROM session;");
  }

  async setLastSyncAt(serverTime: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("UPDATE session SET last_sync_at = ?;", [serverTime]);
  }

  // ---------------------------------------------------------- reconcile
  async reconcileInventory(
    data: { boats: Boat[]; categories: Category[]; parts: Part[] },
    protectedServerIds: number[],
  ): Promise<void> {
    const db = await getDb();
    const protectedSet = new Set(protectedServerIds);
    const serverIds = new Set(data.parts.map((p) => p.id));

    await db.withTransactionAsync(async () => {
      // Boats & categories are server-authoritative; replace wholesale.
      await db.execAsync("DELETE FROM boats; DELETE FROM categories;");
      for (const b of data.boats) {
        await db.runAsync(
          "INSERT INTO boats (id, name, registration, is_active, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?);",
          [b.id, b.name, b.registration ?? null, b.is_active ?? 1, b.updated_at ?? null, b.deleted_at ?? null],
        );
      }
      for (const c of data.categories) {
        await db.runAsync(
          "INSERT INTO categories (id, name, is_system, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?);",
          [c.id, c.name, c.is_system ?? 0, c.updated_at ?? null, c.deleted_at ?? null],
        );
      }

      // Parts: merge, protecting rows that still have pending changes.
      for (const p of data.parts) {
        if (protectedSet.has(p.id)) continue;
        const existing = await db.getFirstAsync<{ row_uid: string }>(
          "SELECT row_uid FROM parts WHERE server_id = ?;",
          [p.id],
        );
        if (existing) {
          await db.runAsync(
            `UPDATE parts SET name=?, reference=?, category_id=?, location=?, quantity=?, notes=?, photo_path=?, updated_at=?, deleted_at=?, pending_delete=0, sync_state='synced' WHERE server_id=?;`,
            [
              p.name, p.reference ?? null, p.category_id ?? null, p.location ?? null,
              p.quantity ?? 0, p.notes ?? null, p.photo_path ?? null, p.updated_at ?? null,
              p.deleted_at ?? null, p.id,
            ],
          );
        } else {
          await db.runAsync(
            `INSERT INTO parts (row_uid, server_id, local_id, boat_id, name, reference, category_id, location, quantity, notes, photo_path, updated_at, deleted_at, pending_delete, sync_state)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced');`,
            [
              `srv-${p.id}`, p.id, p.boat_id, p.name, p.reference ?? null, p.category_id ?? null,
              p.location ?? null, p.quantity ?? 0, p.notes ?? null, p.photo_path ?? null,
              p.updated_at ?? null, p.deleted_at ?? null,
            ],
          );
        }
      }

      // Remove synced local rows the server no longer has (server-side delete).
      const localSynced = await db.getAllAsync<{ row_uid: string; server_id: number }>(
        "SELECT row_uid, server_id FROM parts WHERE server_id IS NOT NULL AND sync_state = 'synced';",
      );
      for (const row of localSynced) {
        if (!serverIds.has(row.server_id) && !protectedSet.has(row.server_id)) {
          await db.runAsync("DELETE FROM parts WHERE row_uid = ?;", [row.row_uid]);
        }
      }
    });
  }

  async getBoats(): Promise<Boat[]> {
    const db = await getDb();
    return db.getAllAsync<Boat>("SELECT * FROM boats WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;");
  }

  async getCategories(): Promise<Category[]> {
    const db = await getDb();
    return db.getAllAsync<Category>("SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;");
  }

  async searchParts(opts: { query?: string; categoryId?: number | null }): Promise<LocalPart[]> {
    const db = await getDb();
    const clauses: string[] = ["pending_delete = 0", "deleted_at IS NULL"];
    const params: (string | number)[] = [];
    if (opts.categoryId != null) {
      clauses.push("category_id = ?");
      params.push(opts.categoryId);
    }
    const q = opts.query?.trim();
    if (q) {
      clauses.push("(name LIKE ? OR reference LIKE ? OR location LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    return db.getAllAsync<LocalPart>(
      `SELECT * FROM parts WHERE ${clauses.join(" AND ")} ORDER BY name COLLATE NOCASE;`,
      params,
    );
  }

  async getPart(rowUid: string): Promise<LocalPart | null> {
    const db = await getDb();
    return (await db.getFirstAsync<LocalPart>("SELECT * FROM parts WHERE row_uid = ?;", [rowUid])) ?? null;
  }

  async getCounts(): Promise<{ boats: number; categories: number; parts: number }> {
    const db = await getDb();
    const b = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM boats WHERE deleted_at IS NULL;");
    const c = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM categories WHERE deleted_at IS NULL;");
    const p = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM parts WHERE deleted_at IS NULL AND pending_delete = 0;");
    return { boats: b?.n ?? 0, categories: c?.n ?? 0, parts: p?.n ?? 0 };
  }

  // ---------------------------------------------------------- mutations
  async createPartLocal(input: CreatePartInput): Promise<LocalPart> {
    const db = await getDb();
    const rowUid = input.local_id;
    const createdAt = nowIso();
    const payload = JSON.stringify({
      boat_id: input.boat_id,
      name: input.name,
      reference: input.reference,
      category_id: input.category_id,
      location: input.location,
      quantity: input.quantity,
      notes: input.notes,
    });

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO parts (row_uid, server_id, local_id, boat_id, name, reference, category_id, location, quantity, notes, photo_path, updated_at, deleted_at, pending_delete, sync_state)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 'pending');`,
        [
          rowUid, input.local_id, input.boat_id, input.name, input.reference ?? null,
          input.category_id ?? null, input.location ?? null, input.quantity ?? 0, input.notes ?? null,
        ],
      );
      await db.runAsync(
        `INSERT INTO pending_changes (queue_id, action, entity, entity_id, row_uid, client_local_id, payload, base_updated_at, created_at, retry_count, last_error, status)
         VALUES (?, 'create', 'part', NULL, ?, ?, ?, NULL, ?, 0, NULL, 'pending');`,
        [newQueueId(), rowUid, input.local_id, payload, createdAt],
      );
    });

    return (await this.getPart(rowUid))!;
  }

  async updatePartLocal(rowUid: string, fields: EditablePartFields): Promise<LocalPart | null> {
    const db = await getDb();
    const part = await this.getPart(rowUid);
    if (!part) return null;

    await db.withTransactionAsync(async () => {
      // Apply the change to the part row immediately.
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];
      const map: Record<string, string | number | null | undefined> = {
        name: fields.name,
        reference: fields.reference,
        category_id: fields.category_id,
        location: fields.location,
        quantity: fields.quantity,
        notes: fields.notes,
      };
      for (const [k, v] of Object.entries(map)) {
        if (v !== undefined) {
          sets.push(`${k} = ?`);
          vals.push(v as string | number | null);
        }
      }
      sets.push("sync_state = 'pending'");
      await db.runAsync(`UPDATE parts SET ${sets.join(", ")} WHERE row_uid = ?;`, [...vals, rowUid]);

      if (part.server_id == null) {
        // Local create not yet synced: merge into the existing create payload,
        // do NOT create a separate update op (still one create with local_id).
        const createEntry = await db.getFirstAsync<{ queue_id: string; payload: string }>(
          "SELECT queue_id, payload FROM pending_changes WHERE row_uid = ? AND action = 'create' LIMIT 1;",
          [rowUid],
        );
        if (createEntry) {
          const merged = { ...JSON.parse(createEntry.payload || "{}"), ...stripUndefined(fields) };
          await db.runAsync(
            "UPDATE pending_changes SET payload = ?, status = 'pending' WHERE queue_id = ?;",
            [JSON.stringify(merged), createEntry.queue_id],
          );
        }
      } else {
        // Consolidate: reuse an existing pending update op for this row.
        const upd = await db.getFirstAsync<{ queue_id: string; payload: string }>(
          "SELECT queue_id, payload FROM pending_changes WHERE row_uid = ? AND action = 'update' AND status IN ('pending','syncing') LIMIT 1;",
          [rowUid],
        );
        if (upd) {
          const merged = { ...JSON.parse(upd.payload || "{}"), ...stripUndefined(fields) };
          await db.runAsync(
            "UPDATE pending_changes SET payload = ?, status = 'pending' WHERE queue_id = ?;",
            [JSON.stringify(merged), upd.queue_id],
          );
        } else {
          await db.runAsync(
            `INSERT INTO pending_changes (queue_id, action, entity, entity_id, row_uid, client_local_id, payload, base_updated_at, created_at, retry_count, last_error, status)
             VALUES (?, 'update', 'part', ?, ?, NULL, ?, ?, ?, 0, NULL, 'pending');`,
            [newQueueId(), part.server_id, rowUid, JSON.stringify(stripUndefined(fields)), part.updated_at, nowIso()],
          );
        }
      }
    });

    return this.getPart(rowUid);
  }

  async deletePartLocal(rowUid: string): Promise<void> {
    const db = await getDb();
    const part = await this.getPart(rowUid);
    if (!part) return;

    await db.withTransactionAsync(async () => {
      if (part.server_id == null) {
        // Never reached the server: drop the local create and its queue entry.
        await db.runAsync("DELETE FROM pending_changes WHERE row_uid = ? AND action = 'create';", [rowUid]);
        await db.runAsync("DELETE FROM parts WHERE row_uid = ?;", [rowUid]);
      } else {
        // Pending updates are superseded by the delete.
        await db.runAsync("DELETE FROM pending_changes WHERE row_uid = ? AND action = 'update' AND status = 'pending';", [rowUid]);
        await db.runAsync("UPDATE parts SET pending_delete = 1, sync_state = 'pending' WHERE row_uid = ?;", [rowUid]);
        await db.runAsync(
          `INSERT INTO pending_changes (queue_id, action, entity, entity_id, row_uid, client_local_id, payload, base_updated_at, created_at, retry_count, last_error, status)
           VALUES (?, 'delete', 'part', ?, ?, NULL, ?, ?, ?, 0, NULL, 'pending');`,
          [newQueueId(), part.server_id, rowUid, JSON.stringify({ id: part.server_id }), part.updated_at, nowIso()],
        );
      }
    });
  }

  // -------------------------------------------------------------- queue
  async getPendingChanges(): Promise<PendingChange[]> {
    const db = await getDb();
    return db.getAllAsync<PendingChange>(
      "SELECT * FROM pending_changes WHERE status IN ('pending','syncing') ORDER BY created_at ASC;",
    );
  }

  async getPendingCount(): Promise<number> {
    const db = await getDb();
    const r = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM pending_changes WHERE status IN ('pending','syncing');",
    );
    return r?.n ?? 0;
  }

  async getProtectedServerIds(): Promise<number[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ entity_id: number }>(
      "SELECT DISTINCT entity_id FROM pending_changes WHERE entity_id IS NOT NULL;",
    );
    return rows.map((r) => r.entity_id);
  }

  async markSyncing(queueIds: string[]): Promise<void> {
    if (queueIds.length === 0) return;
    const db = await getDb();
    const placeholders = queueIds.map(() => "?").join(",");
    await db.runAsync(`UPDATE pending_changes SET status = 'syncing' WHERE queue_id IN (${placeholders});`, queueIds);
  }

  async revertSyncing(queueIds: string[]): Promise<void> {
    if (queueIds.length === 0) return;
    const db = await getDb();
    const placeholders = queueIds.map(() => "?").join(",");
    await db.runAsync(`UPDATE pending_changes SET status = 'pending' WHERE queue_id IN (${placeholders});`, queueIds);
  }

  async applyCreateOk(queueId: string, rowUid: string, serverId: number, updatedAt: string): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        "UPDATE parts SET server_id = ?, updated_at = ?, sync_state = 'synced' WHERE row_uid = ?;",
        [serverId, updatedAt, rowUid],
      );
      await db.runAsync("DELETE FROM pending_changes WHERE queue_id = ?;", [queueId]);
    });
  }

  async applyUpdateOk(queueId: string, serverId: number, updatedAt: string): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        "UPDATE parts SET updated_at = ?, sync_state = 'synced' WHERE server_id = ?;",
        [updatedAt, serverId],
      );
      await db.runAsync("DELETE FROM pending_changes WHERE queue_id = ?;", [queueId]);
    });
  }

  async applyDeleteOk(queueId: string, serverId: number): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM parts WHERE server_id = ?;", [serverId]);
      await db.runAsync("DELETE FROM pending_changes WHERE queue_id = ?;", [queueId]);
    });
  }

  async markConflict(rowUid: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("UPDATE parts SET sync_state = 'conflict' WHERE row_uid = ?;", [rowUid]);
  }

  async markFailed(queueId: string, rowUid: string, lastError: string): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        "UPDATE pending_changes SET status = 'failed', last_error = ? WHERE queue_id = ?;",
        [lastError, queueId],
      );
      await db.runAsync("UPDATE parts SET sync_state = 'error' WHERE row_uid = ?;", [rowUid]);
    });
  }

  async markRetry(queueId: string, lastError: string): Promise<void> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ retry_count: number; row_uid: string }>(
      "SELECT retry_count, row_uid FROM pending_changes WHERE queue_id = ?;",
      [queueId],
    );
    const next = (row?.retry_count ?? 0) + 1;
    if (next >= MAX_RETRIES) {
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          "UPDATE pending_changes SET retry_count = ?, last_error = ?, status = 'failed' WHERE queue_id = ?;",
          [next, lastError, queueId],
        );
        if (row?.row_uid) {
          await db.runAsync("UPDATE parts SET sync_state = 'error' WHERE row_uid = ?;", [row.row_uid]);
        }
      });
    } else {
      await db.runAsync(
        "UPDATE pending_changes SET retry_count = ?, last_error = ?, status = 'pending' WHERE queue_id = ?;",
        [next, lastError, queueId],
      );
    }
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export const localStore: LocalStore = new SqliteStore();
