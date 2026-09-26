// Domain types mirroring the MNores PHP API 1.4.2 contract.

export type Role = "admin" | "inspector" | "chief_engineer" | "mechanic";

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  boat_id: number;
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
  updated_at: string | null;
  deleted_at: string | null;
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
  boat_id: number;
  last_sync_at: string | null;
}
