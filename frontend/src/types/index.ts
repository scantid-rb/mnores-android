// Domain types mirroring the MNores PHP API 1.4.3 contract + local-only types.

export type Role = "admin" | "inspector" | "chief_engineer" | "mechanic";

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  boat_id: number | null;
}

export interface Boat {
  id: number;
  name: string;
  registration: string | null;
  is_active: number;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface Category {
  id: number;
  name: string;
  is_system: number;
  updated_at: string | null;
  deleted_at: string | null;
}

// Part as returned by the server (/api/sync).
export interface Part {
  id: number;
  boat_id: number;
  name: string;
  reference: string | null;
  category_id: number | null;
  location: string | null;
  quantity: number;
  notes: string | null;
  photo_path: string | null;
  local_photo_path: string | null;
  updated_at: string | null;
  deleted_at?: string | null;
}

export interface SyncResponse {
  ok: boolean;
  server_time: string;
  boats: Boat[];
  categories: Category[];
  parts: Part[];
}

// Local persisted session row (metadata only — never the token/password).
export interface SessionRow {
  id: number;
  username: string;
  role: Role;
  boat_id: number | null;
  last_sync_at: string | null;
}

// ---------------------------------------------------------------------------
// Local-only model (offline-first). A part row is keyed by a stable local
// row_uid. server_id is null until a locally-created part is acknowledged.
// ---------------------------------------------------------------------------

export type SyncState = "synced" | "pending" | "syncing" | "error" | "conflict";

export type PhotoQueueStatus = "pending" | "uploading" | "failed";

export interface PendingPhoto {
  queue_id: string;
  row_uid: string;
  server_id: number | null;
  local_path: string;
  retry_count: number;
  last_error: string | null;
  status: PhotoQueueStatus;
  created_at: string;
}

export interface LocalPart {
  row_uid: string;
  server_id: number | null;
  local_id: string | null;
  boat_id: number;
  name: string;
  reference: string | null;
  category_id: number | null;
  location: string | null;
  quantity: number;
  notes: string | null;
  photo_path: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  pending_delete: number;
  sync_state: SyncState;
}

export type QueueAction = "create" | "update" | "delete";
export type QueueStatus = "pending" | "syncing" | "failed";

export interface PendingChange {
  queue_id: string;
  action: QueueAction;
  entity: string; // always "part" in Phase 2
  entity_id: number | null; // server id when known
  row_uid: string;
  client_local_id: string | null; // for creates
  payload: string; // JSON
  base_updated_at: string | null;
  created_at: string;
  retry_count: number;
  last_error: string | null;
  status: QueueStatus;
}

// Fields a user can edit on a part.
export interface EditablePartFields {
  name?: string;
  reference?: string | null;
  category_id?: number | null;
  location?: string | null;
  quantity?: number;
  notes?: string | null;
}

export interface CreatePartInput {
  local_id: string;
  boat_id: number;
  name: string;
  reference: string | null;
  category_id: number | null;
  location: string | null;
  quantity: number;
  notes: string | null;
}

// A single change entry sent to POST /api/parts/push.
export interface PushChange {
  action: QueueAction;
  local_id?: string;
  id?: number;
  base_updated_at?: string | null;
  boat_id?: number;
  name?: string;
  reference?: string | null;
  category_id?: number | null;
  location?: string | null;
  quantity?: number;
  notes?: string | null;
}

export type PushStatus =
  | "ok"
  | "conflict_overwritten"
  | "forbidden"
  | "not_found"
  | "invalid";

export interface PushResult {
  action: QueueAction;
  local_id?: string;
  id?: number;
  status: PushStatus;
  updated_at?: string;
}

export interface PushResponse {
  ok: boolean;
  server_time: string;
  results: PushResult[];
}
