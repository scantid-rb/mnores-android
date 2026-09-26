// Web fallback for the local store so the preview renders. Backed by the
// storage util (AsyncStorage/IndexedDB). Native uses store.ts (real SQLite).
// Arrays/objects are serialized to a JSON string because the storage util
// only persists scalar values.

import { storage } from "@/src/utils/storage";
import { Boat, Category, Part, SessionRow, SessionUser } from "@/src/types";
import { LocalStore } from "@/src/database/store.types";

const K = {
  session: "db.session",
  boats: "db.boats",
  categories: "db.categories",
  parts: "db.parts",
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

class WebStore implements LocalStore {
  async init(): Promise<void> {
    // Nothing to migrate; keys are created lazily.
  }

  async saveSession(user: SessionUser): Promise<void> {
    const row: SessionRow = { ...user, last_sync_at: null };
    await writeJson(K.session, row);
  }

  async getSession(): Promise<SessionRow | null> {
    return readJson<SessionRow | null>(K.session, null);
  }

  async clearSession(): Promise<void> {
    await storage.removeItem(K.session);
  }

  async setLastSyncAt(serverTime: string): Promise<void> {
    const row = await this.getSession();
    if (row) {
      row.last_sync_at = serverTime;
      await writeJson(K.session, row);
    }
  }

  async replaceInventory(data: {
    boats: Boat[];
    categories: Category[];
    parts: Part[];
  }): Promise<void> {
    await writeJson(K.boats, data.boats);
    await writeJson(K.categories, data.categories);
    await writeJson(K.parts, data.parts);
  }

  async getBoats(): Promise<Boat[]> {
    const rows = await readJson<Boat[]>(K.boats, []);
    return rows.filter((b) => !b.deleted_at);
  }

  async getCategories(): Promise<Category[]> {
    const rows = await readJson<Category[]>(K.categories, []);
    return rows
      .filter((c) => !c.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async searchParts(opts: {
    query?: string;
    categoryId?: number | null;
  }): Promise<Part[]> {
    const rows = await readJson<Part[]>(K.parts, []);
    const q = opts.query?.trim().toLowerCase();
    return rows
      .filter((p) => !p.deleted_at)
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

  async getPart(id: number): Promise<Part | null> {
    const rows = await readJson<Part[]>(K.parts, []);
    return rows.find((p) => p.id === id) ?? null;
  }

  async getCounts(): Promise<{ boats: number; categories: number; parts: number }> {
    const boats = await this.getBoats();
    const categories = await this.getCategories();
    const parts = await readJson<Part[]>(K.parts, []);
    return {
      boats: boats.length,
      categories: categories.length,
      parts: parts.filter((p) => !p.deleted_at).length,
    };
  }
}

export const localStore: LocalStore = new WebStore();
