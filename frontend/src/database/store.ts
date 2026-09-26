// Native local persistence backed by expo-sqlite. Real SQLite with indexes so
// offline search stays fast. This file is used on iOS/Android; Metro picks
// store.web.ts on web.

import * as SQLite from "expo-sqlite";

import { Boat, Category, Part, SessionRow, SessionUser } from "@/src/types";
import { LocalStore } from "@/src/database/store.types";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("mnores.db");
  }
  return dbPromise;
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
        name TEXT,
        registration TEXT,
        is_active INTEGER,
        updated_at TEXT,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT,
        is_system INTEGER,
        updated_at TEXT,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS parts (
        id INTEGER PRIMARY KEY,
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
        sync_state TEXT DEFAULT 'synced'
      );

      CREATE INDEX IF NOT EXISTS idx_parts_name ON parts(name);
      CREATE INDEX IF NOT EXISTS idx_parts_reference ON parts(reference);
      CREATE INDEX IF NOT EXISTS idx_parts_location ON parts(location);
      CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category_id);
    `);
  }

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
    const row = await db.getFirstAsync<SessionRow>(
      "SELECT id, username, role, boat_id, last_sync_at FROM session LIMIT 1;",
    );
    return row ?? null;
  }

  async clearSession(): Promise<void> {
    const db = await getDb();
    await db.runAsync("DELETE FROM session;");
  }

  async setLastSyncAt(serverTime: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("UPDATE session SET last_sync_at = ?;", [serverTime]);
  }

  async replaceInventory(data: {
    boats: Boat[];
    categories: Category[];
    parts: Part[];
  }): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.execAsync("DELETE FROM boats; DELETE FROM categories; DELETE FROM parts;");

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

      for (const p of data.parts) {
        await db.runAsync(
          `INSERT INTO parts
             (id, local_id, boat_id, name, reference, category_id, location, quantity, notes, photo_path, updated_at, deleted_at, sync_state)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced');`,
          [
            p.id,
            p.boat_id,
            p.name,
            p.reference ?? null,
            p.category_id ?? null,
            p.location ?? null,
            p.quantity ?? 0,
            p.notes ?? null,
            p.photo_path ?? null,
            p.updated_at ?? null,
            p.deleted_at ?? null,
          ],
        );
      }
    });
  }

  async getBoats(): Promise<Boat[]> {
    const db = await getDb();
    return db.getAllAsync<Boat>(
      "SELECT * FROM boats WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;",
    );
  }

  async getCategories(): Promise<Category[]> {
    const db = await getDb();
    return db.getAllAsync<Category>(
      "SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;",
    );
  }

  async searchParts(opts: {
    query?: string;
    categoryId?: number | null;
  }): Promise<Part[]> {
    const db = await getDb();
    const clauses: string[] = ["deleted_at IS NULL"];
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

    const sql = `SELECT * FROM parts WHERE ${clauses.join(" AND ")} ORDER BY name COLLATE NOCASE;`;
    return db.getAllAsync<Part>(sql, params);
  }

  async getPart(id: number): Promise<Part | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<Part>("SELECT * FROM parts WHERE id = ?;", [id]);
    return row ?? null;
  }

  async getCounts(): Promise<{ boats: number; categories: number; parts: number }> {
    const db = await getDb();
    const boats = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM boats WHERE deleted_at IS NULL;");
    const categories = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM categories WHERE deleted_at IS NULL;");
    const parts = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM parts WHERE deleted_at IS NULL;");
    return { boats: boats?.n ?? 0, categories: categories?.n ?? 0, parts: parts?.n ?? 0 };
  }
}

export const localStore: LocalStore = new SqliteStore();
