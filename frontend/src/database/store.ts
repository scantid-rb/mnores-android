// Native local persistence (expo-sqlite). Offline-first: parts are keyed by a
// stable local row_uid; server_id is null until a create is acknowledged. All
// local mutations write the part row and its pending_changes entry inside one
// transaction so an operation can never be lost mid-write.

import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";

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
const SCHEMA_VERSION = 4;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync("mnores.db");
  return dbPromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function removeLocalFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // Local cleanup must never make the database operation fail.
  }
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
        boat_id INTEGER,
        last_sync_at TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        role TEXT NOT NULL,
        boat_id INTEGER,
        is_active INTEGER NOT NULL,
        is_primary_admin INTEGER NOT NULL DEFAULT 0
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
    if ((ver?.user_version ?? 0) < 2) {
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
          local_photo_path TEXT,
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
        CREATE TABLE IF NOT EXISTS photo_queue (
          queue_id TEXT PRIMARY KEY,
          row_uid TEXT NOT NULL,
          server_id INTEGER,
          local_path TEXT NOT NULL,
          retry_count INTEGER DEFAULT 0,
          last_error TEXT,
          status TEXT DEFAULT 'pending',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_photo_queue_row ON photo_queue(row_uid);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    }

    if ((ver?.user_version ?? 0) < 3) {
      const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(parts);");
      if (!cols.some((x) => x.name === "local_photo_path")) {
        await db.runAsync("ALTER TABLE parts ADD COLUMN local_photo_path TEXT;");
      }
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS photo_queue (
          queue_id TEXT PRIMARY KEY,
          row_uid TEXT NOT NULL,
          server_id INTEGER,
          local_path TEXT NOT NULL,
          retry_count INTEGER DEFAULT 0,
          last_error TEXT,
          status TEXT DEFAULT 'pending',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_photo_queue_row ON photo_queue(row_uid);
        PRAGMA user_version = 3;
      `);
    }

    // Schema v4: admin/inspector sessions may have no assigned boat.
    // Only the session table is migrated. Parts schema/version is independent.
    const sessionCols = await db.getAllAsync<{ name: string; notnull: number }>(
      "PRAGMA table_info(session);",
    );
    const sessionBoat = sessionCols.find((col) => col.name === "boat_id");
    if ((ver?.user_version ?? 0) < 4 || sessionBoat?.notnull === 1) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS session_v4 (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL,
          role TEXT NOT NULL,
          boat_id INTEGER,
          last_sync_at TEXT
        );
        INSERT OR REPLACE INTO session_v4 (id, username, role, boat_id, last_sync_at)
          SELECT id, username, role, boat_id, last_sync_at FROM session;
        DROP TABLE session;
        ALTER TABLE session_v4 RENAME TO session;
        PRAGMA user_version = 4;
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

  async updateSessionIdentity(user: SessionUser): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      "UPDATE session SET username = ?, role = ?, boat_id = ? WHERE id = ?;",
      [user.username, user.role, user.boat_id, user.id],
    );
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

  async clearUserData(): Promise<void> {
    // Switching identity/server invalidates the whole local dataset. Remove
    // the complete private photo directory as well as all SQLite cache/queues.
    await removeLocalFile(`${FileSystem.documentDirectory}photos/`);
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM pending_changes;");
      await db.runAsync("DELETE FROM photo_queue;");
      await db.runAsync("DELETE FROM parts;");
      await db.runAsync("DELETE FROM users;");
      await db.runAsync("DELETE FROM boats;");
      await db.runAsync("DELETE FROM categories;");
      await db.runAsync("DELETE FROM session;");
    });
  }

  async setLastSyncAt(serverTime: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("UPDATE session SET last_sync_at = ?;", [serverTime]);
  }

  // ---------------------------------------------------------- reconcile
  async reconcileInventory(
    data: { boats: Boat[]; categories: Category[]; parts: Part[]; users?: User[] },
    protectedServerIds: number[],
    serverTime?: string,
  ): Promise<void> {
    const db = await getDb();
    const protectedSet = new Set(protectedServerIds);
    // Tombstones are authoritative deletions. Protected rows remain untouched
    // until their pending operation is resolved.
    const serverIds = new Set(data.parts.filter((p) => !p.deleted_at).map((p) => p.id));

    await db.withTransactionAsync(async () => {
      // Administrative catalogs are server-authoritative; replace wholesale.
      await db.execAsync("DELETE FROM users; DELETE FROM boats; DELETE FROM categories;");
      for (const u of data.users ?? []) {
        await db.runAsync(
          "INSERT INTO users (id, username, first_name, last_name, role, boat_id, is_active, is_primary_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
          [u.id, u.username, u.first_name, u.last_name, u.role, u.boat_id ?? null, u.is_active ?? 1, u.is_primary_admin ?? 0],
        );
      }
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
      // A server tombstone is a deletion signal, not a normal part row.
      for (const p of data.parts) {
        if (protectedSet.has(p.id)) continue;
        if (p.deleted_at) {
          // A tombstone removes every stale local duplicate for this server id.
          const localRows = await db.getAllAsync<{ local_photo_path: string | null }>(
            "SELECT local_photo_path FROM parts WHERE server_id = ?;",
            [p.id],
          );
          await db.runAsync("DELETE FROM photo_queue WHERE server_id = ?;", [p.id]);
          await db.runAsync("DELETE FROM parts WHERE server_id = ?;", [p.id]);
          for (const row of localRows) await removeLocalFile(row.local_photo_path);
          continue;
        }
        // Match by server_id first. If an older/local row already owns the
        // canonical server row_uid (srv-<id>), reuse that row instead of
        // attempting a second INSERT and violating the row_uid PRIMARY KEY.
        const existingRows = await db.getAllAsync<{ row_uid: string; sync_state: string }>(
          "SELECT row_uid, sync_state FROM parts WHERE server_id = ? OR row_uid = ?;",
          [p.id, `srv-${p.id}`],
        );
        if (existingRows.length > 0) {
          // There must be exactly one local row for each canonical server id.
          // Prefer the canonical srv-<id> row; otherwise prefer a synced row.
          const canonical =
            existingRows.find((r) => r.row_uid === `srv-${p.id}`) ??
            existingRows.find((r) => r.sync_state === "synced") ??
            existingRows[0];

          await db.runAsync(
            `UPDATE parts SET server_id=?, local_id=NULL, boat_id=?, name=?, reference=?, category_id=?, location=?, quantity=?, notes=?, photo_path=?, updated_at=?, deleted_at=?, pending_delete=0, sync_state='synced' WHERE row_uid=?;`,
            [
              p.id, p.boat_id, p.name, p.reference ?? null, p.category_id ?? null,
              p.location ?? null, p.quantity ?? 0, p.notes ?? null, p.photo_path ?? null,
              p.updated_at ?? null, p.deleted_at ?? null, canonical.row_uid,
            ],
          );

          // Repair duplicates left by an older reconciliation.
          const duplicateUids = existingRows
            .map((r) => r.row_uid)
            .filter((uid) => uid !== canonical.row_uid);
          for (const uid of duplicateUids) {
            await db.runAsync("DELETE FROM parts WHERE row_uid = ?;", [uid]);
          }
        } else {
          await db.runAsync(
            `INSERT INTO parts (row_uid, server_id, local_id, boat_id, name, reference, category_id, location, quantity, notes, photo_path, local_photo_path, updated_at, deleted_at, pending_delete, sync_state)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 'synced');`,
            [
              `srv-${p.id}`, p.id, p.boat_id, p.name, p.reference ?? null, p.category_id ?? null,
              p.location ?? null, p.quantity ?? 0, p.notes ?? null, p.photo_path ?? null,
              p.updated_at ?? null, p.deleted_at ?? null,
            ],
          );
        }
      }

      if (serverTime) await db.runAsync("UPDATE session SET last_sync_at = ?;", [serverTime]);

      // Remove synced local rows the server no longer has (server-side delete).
      const localSynced = await db.getAllAsync<{ row_uid: string; server_id: number }>(
        "SELECT row_uid, server_id FROM parts WHERE server_id IS NOT NULL AND sync_state = 'synced';",
      );
      for (const row of localSynced) {
        if (!serverIds.has(row.server_id) && !protectedSet.has(row.server_id)) {
          const localPhoto = await db.getFirstAsync<{ local_photo_path: string | null }>(
            "SELECT local_photo_path FROM parts WHERE row_uid = ?;",
            [row.row_uid],
          );
          await db.runAsync("DELETE FROM parts WHERE row_uid = ?;", [row.row_uid]);
          await removeLocalFile(localPhoto?.local_photo_path);
        }
      }
    });
  }

  async getUsers(): Promise<User[]> {
    const db = await getDb();
    return db.getAllAsync<User>(
      "SELECT id, username, first_name, last_name, role, boat_id, is_active, is_primary_admin FROM users ORDER BY username COLLATE NOCASE;",
    );
  }

  async getBoats(): Promise<Boat[]> {
    const db = await getDb();
    return db.getAllAsync<Boat>("SELECT * FROM boats WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;");
  }

  async getCategories(): Promise<Category[]> {
    const db = await getDb();
    return db.getAllAsync<Category>("SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;");
  }

  async searchParts(opts: { query?: string; categoryId?: number | null; boatId?: number | null }): Promise<LocalPart[]> {
    const db = await getDb();
    const clauses: string[] = ["pending_delete = 0", "deleted_at IS NULL"];
    const params: (string | number)[] = [];
    if (opts.categoryId != null) {
      clauses.push("category_id = ?");
      params.push(opts.categoryId);
    }
    if (opts.boatId != null) {
      clauses.push("boat_id = ?");
      params.push(opts.boatId);
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
        `INSERT INTO parts (row_uid, server_id, local_id, boat_id, name, reference, category_id, location, quantity, notes, photo_path, local_photo_path, updated_at, deleted_at, pending_delete, sync_state)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 'pending');`,
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
        const createEntry = await db.getFirstAsync<{ queue_id: string; payload: string; status: string; retry_count: number; last_error: string | null }>(
          "SELECT queue_id, payload, status, retry_count, last_error FROM pending_changes WHERE row_uid = ? AND action = 'create' LIMIT 1;",
          [rowUid],
        );
        if (createEntry?.status === 'failed' && ['invalid', 'forbidden'].includes(createEntry.last_error ?? '')) {
          const edits = await db.getAllAsync<{ payload: string }>("SELECT payload FROM pending_changes WHERE row_uid = ? AND action = 'update' ORDER BY created_at;", [rowUid]);
          const merged = Object.assign(JSON.parse(createEntry.payload), ...edits.map((e) => JSON.parse(e.payload)), stripUndefined(fields));
          await db.runAsync("UPDATE pending_changes SET payload = ?, status = 'pending', retry_count = 0, last_error = NULL WHERE queue_id = ?;", [JSON.stringify(merged), createEntry.queue_id]);
          await db.runAsync("DELETE FROM pending_changes WHERE row_uid = ? AND action = 'update';", [rowUid]);
        } else if (createEntry && (createEntry.status === 'syncing' || createEntry.retry_count > 0)) {
          await db.runAsync(
            `INSERT INTO pending_changes (queue_id, action, entity, entity_id, row_uid, client_local_id, payload, base_updated_at, created_at, retry_count, last_error, status)
             VALUES (?, 'update', 'part', NULL, ?, NULL, ?, NULL, ?, 0, NULL, 'pending');`,
            [newQueueId(), rowUid, JSON.stringify(stripUndefined(fields)), nowIso()],
          );
        } else if (createEntry) {
          const merged = { ...JSON.parse(createEntry.payload || "{}"), ...stripUndefined(fields) };
          await db.runAsync(
            "UPDATE pending_changes SET payload = ?, status = 'pending' WHERE queue_id = ?;",
            [JSON.stringify(merged), createEntry.queue_id],
          );
        }
      } else {
        const upd = await db.getFirstAsync<{ queue_id: string; payload: string }>(
          "SELECT queue_id, payload FROM pending_changes WHERE row_uid = ? AND action = 'update' AND status = 'pending' LIMIT 1;",
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

    const localPhotoPath = part.local_photo_path;

    await db.withTransactionAsync(async () => {
      if (part.server_id == null) {
        const createEntry = await db.getFirstAsync<{ queue_id: string; status: string; retry_count: number }>(
          "SELECT queue_id, status, retry_count FROM pending_changes WHERE row_uid = ? AND action = 'create' LIMIT 1;",
          [rowUid],
        );
        if (createEntry && (createEntry.status === "syncing" || createEntry.retry_count > 0)) {
          await db.runAsync("UPDATE parts SET pending_delete = 1, sync_state = 'pending' WHERE row_uid = ?;", [rowUid]);
          await db.runAsync(
            `INSERT INTO pending_changes (queue_id, action, entity, entity_id, row_uid, client_local_id, payload, base_updated_at, created_at, retry_count, last_error, status)
             VALUES (?, 'delete', 'part', NULL, ?, NULL, ?, NULL, ?, 0, NULL, 'pending');`,
            [newQueueId(), rowUid, JSON.stringify({}), nowIso()],
          );
          await db.runAsync("DELETE FROM photo_queue WHERE row_uid = ?;", [rowUid]);
        } else {
          await db.runAsync("DELETE FROM pending_changes WHERE row_uid = ?;", [rowUid]);
          await db.runAsync("DELETE FROM photo_queue WHERE row_uid = ?;", [rowUid]);
          await db.runAsync("DELETE FROM parts WHERE row_uid = ?;", [rowUid]);
        }
      } else {
        // Pending updates are superseded by the delete.
        await db.runAsync("DELETE FROM pending_changes WHERE row_uid = ? AND action = 'update' AND status = 'pending';", [rowUid]);
        await db.runAsync("DELETE FROM photo_queue WHERE row_uid = ?;", [rowUid]);
        await db.runAsync("UPDATE parts SET pending_delete = 1, sync_state = 'pending' WHERE row_uid = ?;", [rowUid]);
        await db.runAsync(
          `INSERT INTO pending_changes (queue_id, action, entity, entity_id, row_uid, client_local_id, payload, base_updated_at, created_at, retry_count, last_error, status)
           VALUES (?, 'delete', 'part', ?, ?, NULL, ?, ?, ?, 0, NULL, 'pending');`,
          [newQueueId(), part.server_id, rowUid, JSON.stringify({ id: part.server_id }), part.updated_at, nowIso()],
        );
      }
    });

    await removeLocalFile(localPhotoPath);
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
    const p = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM photo_queue WHERE status IN ('pending','uploading');",
    );
    return (r?.n ?? 0) + (p?.n ?? 0);
  }

  async getProtectedServerIds(): Promise<number[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ entity_id: number }>(
      "SELECT DISTINCT entity_id FROM pending_changes WHERE entity_id IS NOT NULL;",
    );
    return rows.map((r) => r.entity_id);
  }

  async claimChange(queueId: string): Promise<PendingChange | null> {
    const db = await getDb();
    let claimed: PendingChange | null = null;
    await db.withTransactionAsync(async () => {
      const row = await db.getFirstAsync<PendingChange>("SELECT * FROM pending_changes WHERE queue_id = ? AND status = 'pending';", [queueId]);
      if (!row || (row.action !== "create" && row.entity_id == null)) return;
      await db.runAsync("UPDATE pending_changes SET status = 'syncing', retry_count = MAX(1, retry_count) WHERE queue_id = ? AND status = 'pending';", [queueId]);
      claimed = { ...row, status: "syncing" };
    });
    return claimed;
  }
  async claimPhoto(queueId: string): Promise<PendingPhoto | null> {
    const db = await getDb();
    let claimed: PendingPhoto | null = null;
    await db.withTransactionAsync(async () => {
      const row = await db.getFirstAsync<PendingPhoto>("SELECT * FROM photo_queue WHERE queue_id = ? AND status = 'pending' AND server_id IS NOT NULL;", [queueId]);
      if (!row) return;
      await db.runAsync("UPDATE photo_queue SET status = 'uploading' WHERE queue_id = ?;", [queueId]);
      claimed = { ...row, status: "uploading" };
    });
    return claimed;
  }
  async getFailedChanges(): Promise<(PendingChange | PendingPhoto)[]> {
    const db = await getDb();
    return [...await db.getAllAsync<PendingChange>("SELECT * FROM pending_changes WHERE status = 'failed';"),
      ...await db.getAllAsync<PendingPhoto>("SELECT * FROM photo_queue WHERE status = 'failed';")];
  }
  async retryFailed(): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.execAsync("UPDATE pending_changes SET status = 'pending', retry_count = CASE WHEN action = 'create' THEN 1 ELSE 0 END, last_error = NULL WHERE status = 'failed'; UPDATE photo_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'failed';");
      await db.execAsync("UPDATE parts SET sync_state = 'pending' WHERE row_uid IN (SELECT row_uid FROM pending_changes);");
    });
  }
  async discardFailed(): Promise<void> {
    const db = await getDb();
    const photos = await db.getAllAsync<PendingPhoto>("SELECT * FROM photo_queue WHERE status = 'failed' OR row_uid IN (SELECT row_uid FROM pending_changes WHERE status = 'failed' AND action = 'create');");
    await db.withTransactionAsync(async () => {
      await db.execAsync("DELETE FROM photo_queue WHERE row_uid IN (SELECT row_uid FROM pending_changes WHERE status = 'failed' AND action = 'create'); DELETE FROM pending_changes WHERE status <> 'failed' AND row_uid IN (SELECT row_uid FROM pending_changes WHERE status = 'failed' AND action = 'create');");
      await db.execAsync("DELETE FROM parts WHERE row_uid IN (SELECT row_uid FROM pending_changes WHERE status = 'failed') AND row_uid NOT IN (SELECT row_uid FROM pending_changes WHERE status <> 'failed');");
      await db.execAsync("UPDATE parts SET local_photo_path = NULL WHERE row_uid IN (SELECT row_uid FROM photo_queue WHERE status = 'failed');");
      await db.execAsync("DELETE FROM pending_changes WHERE status = 'failed'; DELETE FROM photo_queue WHERE status = 'failed'; UPDATE session SET last_sync_at = NULL;");
    });
    for (const photo of photos) await removeLocalFile(photo.local_path);
  }
  async reconcileAndSetCursor(data: { boats: Boat[]; categories: Category[]; parts: Part[]; users?: User[] }, serverTime: string): Promise<void> {
    await this.reconcileInventory(data, await this.getProtectedServerIds(), serverTime);
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
      const deferred = await db.getAllAsync<{ queue_id: string; action: "update" | "delete" }>(
        "SELECT queue_id, action FROM pending_changes WHERE row_uid = ? AND queue_id <> ? AND action IN ('update','delete') AND entity_id IS NULL;",
        [rowUid, queueId],
      );
      await db.runAsync(
        "UPDATE parts SET server_id = ?, updated_at = ?, sync_state = ?, pending_delete = CASE WHEN EXISTS (SELECT 1 FROM pending_changes WHERE row_uid = ? AND action = 'delete' AND queue_id <> ?) THEN 1 ELSE pending_delete END WHERE row_uid = ?;",
        [serverId, updatedAt, deferred.length > 0 ? "pending" : "synced", rowUid, queueId, rowUid],
      );
      await db.runAsync("UPDATE photo_queue SET server_id = ? WHERE row_uid = ? AND server_id IS NULL;", [serverId, rowUid]);
      for (const e of deferred) {
        await db.runAsync(
          "UPDATE pending_changes SET entity_id = ?, base_updated_at = ?, payload = CASE WHEN action = 'delete' THEN ? ELSE payload END WHERE queue_id = ?;",
          [serverId, updatedAt, JSON.stringify({ id: serverId }), e.queue_id],
        );
      }
      await db.runAsync("DELETE FROM pending_changes WHERE queue_id = ?;", [queueId]);
    });
  }

  async applyUpdateOk(queueId: string, serverId: number, updatedAt: string): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      const current = await db.getFirstAsync<{ row_uid: string }>(
        "SELECT row_uid FROM pending_changes WHERE queue_id = ?;",
        [queueId],
      );
      const newer = current
        ? await db.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) AS n FROM pending_changes WHERE row_uid = ? AND queue_id <> ? AND status IN ('pending','syncing');",
            [current.row_uid, queueId],
          )
        : null;
      await db.runAsync(
        "UPDATE parts SET updated_at = ?, sync_state = ? WHERE server_id = ?;",
        [updatedAt, newer?.n ? "pending" : "synced", serverId],
      );
      if (current) {
        await db.runAsync(
          "UPDATE pending_changes SET base_updated_at = ? WHERE row_uid = ? AND queue_id <> ? AND entity_id = ? AND action IN ('update','delete') AND status IN ('pending','syncing');",
          [updatedAt, current.row_uid, queueId, serverId],
        );
      }
      await db.runAsync("DELETE FROM pending_changes WHERE queue_id = ?;", [queueId]);
    });
  }

  async applyDeleteOk(queueId: string, serverId: number): Promise<void> {
    const db = await getDb();
    let localPhotoPath: string | null = null;
    await db.withTransactionAsync(async () => {
      const row = await db.getFirstAsync<{ row_uid: string; local_photo_path: string | null }>(
        "SELECT row_uid, local_photo_path FROM parts WHERE server_id = ? LIMIT 1;",
        [serverId],
      );
      localPhotoPath = row?.local_photo_path ?? null;
      await db.runAsync("DELETE FROM photo_queue WHERE server_id = ? OR row_uid = ?;", [serverId, row?.row_uid ?? ""]);
      await db.runAsync("DELETE FROM parts WHERE server_id = ?;", [serverId]);
      await db.runAsync("DELETE FROM pending_changes WHERE queue_id = ? OR entity_id = ? OR row_uid = ?;", [queueId, serverId, row?.row_uid ?? ""]);
    });
    await removeLocalFile(localPhotoPath);
  }

  async setLocalPhoto(rowUid: string, localPath: string): Promise<void> {
    const db = await getDb();
    const part = await this.getPart(rowUid);
    if (!part) throw new Error("Pieza no encontrada");
    const previousLocalPath = part.local_photo_path;
    await db.withTransactionAsync(async () => {
      await db.runAsync("UPDATE parts SET local_photo_path = ? WHERE row_uid = ?;", [localPath, rowUid]);
      await db.runAsync("DELETE FROM photo_queue WHERE row_uid = ? AND status <> 'uploading';", [rowUid]);
      await db.runAsync(
        "INSERT INTO photo_queue (queue_id,row_uid,server_id,local_path,retry_count,last_error,status,created_at) VALUES (?,?,?,?,0,NULL,'pending',?);",
        [newQueueId(), rowUid, part.server_id, localPath, nowIso()],
      );
    });
    if (previousLocalPath && previousLocalPath !== localPath) {
      const inFlight = await db.getFirstAsync("SELECT queue_id FROM photo_queue WHERE local_path = ? AND status = 'uploading';", [previousLocalPath]);
      if (!inFlight) await removeLocalFile(previousLocalPath);
    }
  }

  async getPendingPhotos(): Promise<PendingPhoto[]> {
    const db = await getDb();
    return db.getAllAsync<PendingPhoto>("SELECT * FROM photo_queue WHERE status IN ('pending','uploading') ORDER BY created_at ASC;");
  }

  async applyPhotoServerId(rowUid: string, serverId: number): Promise<void> {
    const db = await getDb();
    await db.runAsync("UPDATE photo_queue SET server_id = ? WHERE row_uid = ?;", [serverId, rowUid]);
  }

  async applyPhotoOk(queueId: string, serverUpdatedAt: string): Promise<void> {
    const db = await getDb();
    let localPath: string | null = null;
    await db.withTransactionAsync(async () => {
      const photo = await db.getFirstAsync<PendingPhoto>("SELECT * FROM photo_queue WHERE queue_id = ?;", [queueId]);
      if (!photo) return;
      localPath = photo.local_path;
      await db.runAsync("UPDATE parts SET photo_path = 'remote', updated_at = ?, local_photo_path = CASE WHEN local_photo_path = ? THEN NULL ELSE local_photo_path END WHERE row_uid = ?;", [serverUpdatedAt, photo.local_path, photo.row_uid]);
      await db.runAsync("DELETE FROM photo_queue WHERE queue_id = ?;", [queueId]);
    });
    await removeLocalFile(localPath);
  }
  async markPhotoRetry(queueId: string, lastError: string): Promise<void> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ retry_count: number }>("SELECT retry_count FROM photo_queue WHERE queue_id = ?;", [queueId]);
    const next = (row?.retry_count ?? 0) + 1;
    await db.runAsync(
      "UPDATE photo_queue SET retry_count = ?, last_error = ?, status = ? WHERE queue_id = ?;",
      [next, lastError, next >= MAX_RETRIES ? "failed" : "pending", queueId],
    );
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
