// Shared interface for the local persistence layer. Two implementations:
//   - store.ts     (native)  -> expo-sqlite, real SQLite with indexes
//   - store.web.ts (web)     -> storage util fallback (preview rendering)
// Repositories depend only on this interface.

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

export interface LocalStore {
  init(): Promise<void>;

  // Session metadata (never the token/password).
  saveSession(user: SessionUser): Promise<void>;
  getSession(): Promise<SessionRow | null>;
  clearSession(): Promise<void>;
  // Clear cached inventory and queued mutations when switching users.
  clearUserData(): Promise<void>;
  setLastSyncAt(serverTime: string): Promise<void>;

  // Reconcile server data into the cache. Parts whose server id is in
  // protectedServerIds are NOT overwritten (they still have pending changes).
  reconcileInventory(
    data: { boats: Boat[]; categories: Category[]; parts: Part[] },
    protectedServerIds: number[],
  ): Promise<void>;

  getBoats(): Promise<Boat[]>;
  getCategories(): Promise<Category[]>;
  searchParts(opts: { query?: string; categoryId?: number | null }): Promise<LocalPart[]>;
  getPart(rowUid: string): Promise<LocalPart | null>;
  getCounts(): Promise<{ boats: number; categories: number; parts: number }>;

  // Local-first mutations (atomic part + queue writes where the engine allows).
  createPartLocal(input: CreatePartInput): Promise<LocalPart>;
  updatePartLocal(rowUid: string, fields: EditablePartFields): Promise<LocalPart | null>;
  deletePartLocal(rowUid: string): Promise<void>;

  // Sync queue.
  getPendingChanges(): Promise<PendingChange[]>;
  getPendingCount(): Promise<number>;
  getProtectedServerIds(): Promise<number[]>;
  markSyncing(queueIds: string[]): Promise<void>;
  revertSyncing(queueIds: string[]): Promise<void>;
  applyCreateOk(queueId: string, rowUid: string, serverId: number, updatedAt: string): Promise<void>;
  applyUpdateOk(queueId: string, serverId: number, updatedAt: string): Promise<void>;
  applyDeleteOk(queueId: string, serverId: number): Promise<void>;
  markConflict(rowUid: string): Promise<void>;
  markFailed(queueId: string, rowUid: string, lastError: string): Promise<void>;
  markRetry(queueId: string, lastError: string): Promise<void>;
}
