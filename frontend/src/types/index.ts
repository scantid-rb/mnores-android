// Domain types mirroring the MNores PHP API 1.4.5 contract + local-only types.

export type Role = "admin" | "inspector" | "chief_engineer" | "mechanic";

export interface SessionUser {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  role: Role;
  boat_id: number | null;
}

export interface AccountUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  boat_id: number | null;
  is_active: number;
}

export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  boat_id: number | null;
  is_active: number;
  is_primary_admin: number;
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
  users?: User[];
}

export interface SessionRow {
  id: number;
  username: string;
  role: Role;
  boat_id: number | null;
  last_sync_at: string | null;
}

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
  entity: string;
  entity_id: number | null;
  row_uid: string;
  client_local_id: string | null;
  payload: string;
  base_updated_at: string | null;
  created_at: string;
  retry_count: number;
  last_error: string | null;
  status: QueueStatus;
}

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

export interface AuditEntry {
  id: number;
  at_utc: string;
  actor_id: number | null;
  actor_username: string | null;
  operation: string;
  object_type: string;
  object_id: number | null;
  boat_id: number | null;
  boat_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

export interface AuditResponse {
  ok: boolean;
  rows: AuditEntry[];
  page: number;
  per_page: number;
  total: number;
  pages: number;
  operations: string[];
  object_types: string[];
  actors: string[];
}
