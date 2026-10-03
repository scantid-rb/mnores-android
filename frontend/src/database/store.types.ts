// Shared interface for the local persistence layer. Two implementations:
//   - store.ts     (native)  -> expo-sqlite, real SQLite with indexes
//   - store.web.ts (web)     -> atomic IndexedDB inventory, queue and photos
// Repositories depend only on this interface.

import {
  Boat,
  Category,
  User,
  CreatePartInput,
  EditablePartFields,
  LocalPart,
  Part,
  PendingPhoto,
  PendingChange,
  SessionRow,
  SessionUser,
} from "@/src/types";

export interface LocalStore {
  init(): Promise<void>;
  recoverInterruptedSync(): Promise<void>;

  // Session metadata (never the token/password).
  saveSession(user: SessionUser): Promise<void>;
  updateSessionIdentity(user: SessionUser): Promise<void>;
  getSession(): Promise<SessionRow | null>;
  clearSession(): Promise<void>;
  // Clear cached inventory and queued mutations when switching users.
  clearUserData(): Promise<void>;
  setLastSyncAt(serverTime: string): Promise<void>;

  // Reconcile server data into the cache. Parts whose server id is in
  // protectedServerIds are NOT overwritten (they still have pending changes).
  reconcileInventory(
    data: { boats: Boat[]; categories: Category[]; parts: Part[]; users?: User[] },
    protectedServerIds: number[],
  ): Promise<void>;

  getBoats(): Promise<Boat[]>;
  getUsers(): Promise<User[]>;
  getCategories(): Promise<Category[]>;
  searchParts(opts: { query?: string; categoryId?: number | null; boatId?: number | null }): Promise<LocalPart[]>;
  getPart(rowUid: string): Promise<LocalPart | null>;
  getCounts(): Promise<{ boats: number; categories: number; parts: number }>;

  // Local-first mutations (atomic part + queue writes where the engine allows).
  createPartLocal(input: CreatePartInput): Promise<LocalPart>;
  updatePartLocal(rowUid: string, fields: EditablePartFields): Promise<LocalPart | null>;
  deletePartLocal(rowUid: string): Promise<void>;
  setLocalPhoto(rowUid: string, localPath: string): Promise<void>;
  getPendingPhotos(): Promise<PendingPhoto[]>;
  applyPhotoServerId(rowUid: string, serverId: number): Promise<void>;
  applyPhotoOk(queueId: string, serverUpdatedAt: string): Promise<void>;
  revertPhotoUploading(queueId: string): Promise<void>;
  markPhotoRetry(queueId: string, lastError: string): Promise<void>;

  // Sync queue.
  getPendingChanges(): Promise<PendingChange[]>;
  getPendingCount(): Promise<number>;
  getProtectedServerIds(): Promise<number[]>;
  claimChange(queueId: string): Promise<PendingChange | null>;
  claimPhoto(queueId: string): Promise<PendingPhoto | null>;
  getFailedChanges(): Promise<(PendingChange | PendingPhoto)[]>;
  retryFailed(): Promise<void>;
  discardFailed(): Promise<void>;
  reconcileAndSetCursor(data: { boats: Boat[]; categories: Category[]; parts: Part[]; users?: User[] }, serverTime: string): Promise<void>;
  markSyncing(queueIds: string[]): Promise<void>;
  revertSyncing(queueIds: string[]): Promise<void>;
  applyCreateOk(queueId: string, rowUid: string, serverId: number, updatedAt: string): Promise<void>;
  applyUpdateOk(queueId: string, serverId: number, updatedAt: string): Promise<void>;
  applyDeleteOk(queueId: string, serverId: number): Promise<void>;
  markConflict(rowUid: string): Promise<void>;
  markFailed(queueId: string, rowUid: string, lastError: string): Promise<void>;
  markRetry(queueId: string, lastError: string): Promise<void>;
}
