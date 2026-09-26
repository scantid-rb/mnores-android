// Shared interface for the local persistence layer. Two implementations:
//   - store.ts     (native)  -> expo-sqlite, real SQLite with indexes
//   - store.web.ts (web)     -> storage util (AsyncStorage/IndexedDB) fallback
// Metro auto-selects the platform file. Repositories depend only on this
// interface, never on a concrete engine.

import { Boat, Category, Part, SessionRow, SessionUser } from "@/src/types";

export interface LocalStore {
  init(): Promise<void>;

  // Session metadata (never the token/password).
  saveSession(user: SessionUser): Promise<void>;
  getSession(): Promise<SessionRow | null>;
  clearSession(): Promise<void>;
  setLastSyncAt(serverTime: string): Promise<void>;

  // Inventory cache, reconciled from /api/sync in a single transaction.
  replaceInventory(data: {
    boats: Boat[];
    categories: Category[];
    parts: Part[];
  }): Promise<void>;

  getBoats(): Promise<Boat[]>;
  getCategories(): Promise<Category[]>;
  // Local search runs against the cache so it works offline.
  searchParts(opts: { query?: string; categoryId?: number | null }): Promise<Part[]>;
  getPart(id: number): Promise<Part | null>;
  getCounts(): Promise<{ boats: number; categories: number; parts: number }>;
}
