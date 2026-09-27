// Typed wrappers for the specific API 1.4.3 endpoints. Do NOT invent endpoints.

import { apiRequest } from "@/src/services/api/client";
import { PushChange, PushResponse, SessionUser, SyncResponse } from "@/src/types";

interface LoginResponse {
  ok: boolean;
  token: string;
  user: SessionUser;
}
interface MeResponse {
  ok: boolean;
  user: SessionUser;
}

export async function apiLogin(
  username: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  const r = await apiRequest<LoginResponse>("/api/login", {
    method: "POST",
    body: { username, password },
  });
  return { token: r.token, user: r.user };
}

export async function apiGetMe(token: string): Promise<SessionUser> {
  const r = await apiRequest<MeResponse>("/api/me", { token });
  return r.user;
}

// GET /api/sync — without since performs a full sync; with since returns only changes.
export async function apiGetSync(token: string, since?: string | null): Promise<SyncResponse> {
  const path = since
    ? `/api/sync?since=${encodeURIComponent(since)}`
    : "/api/sync";
  return apiRequest<SyncResponse>(path, { token });
}

// POST /api/parts/push — batch of create/update/delete changes.
export async function apiPush(token: string, changes: PushChange[]): Promise<PushResponse> {
  return apiRequest<PushResponse>("/api/parts/push", {
    method: "POST",
    token,
    body: { changes },
  });
}


interface BoatsResponse {
  ok: boolean;
  boats: import("@/src/types").Boat[];
}

interface BoatResponse {
  ok: boolean;
  boat: import("@/src/types").Boat;
}

export async function apiGetBoats(token: string): Promise<import("@/src/types").Boat[]> {
  const r = await apiRequest<BoatsResponse>("/api/boats", { token });
  return r.boats;
}

export async function apiCreateBoat(
  token: string,
  input: { name: string; registration: string; is_active: boolean },
): Promise<import("@/src/types").Boat> {
  const r = await apiRequest<BoatResponse>("/api/boats", {
    method: "POST",
    token,
    body: { action: "create", ...input },
  });
  return r.boat;
}

export async function apiUpdateBoat(
  token: string,
  input: { id: number; name: string; registration: string; is_active: boolean },
): Promise<import("@/src/types").Boat> {
  const r = await apiRequest<BoatResponse>("/api/boats", {
    method: "POST",
    token,
    body: { action: "update", ...input },
  });
  return r.boat;
}

export async function apiToggleBoat(token: string, id: number): Promise<import("@/src/types").Boat> {
  const r = await apiRequest<BoatResponse>("/api/boats", {
    method: "POST",
    token,
    body: { action: "toggle", id },
  });
  return r.boat;
}
