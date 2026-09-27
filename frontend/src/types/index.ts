// Domain types mirroring the MNores PHP API 1.4.3 contract + local-only types.

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

// ...