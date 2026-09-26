// Typed wrappers for the specific API 1.4.2 endpoints used in Phase 1.
// Do NOT invent endpoints here.

import { apiRequest } from "@/src/services/api/client";
import { SessionUser, SyncResponse } from "@/src/types";

interface LoginResponse {
  ok: boolean;
  token: string;
  user: SessionUser;
}

interface MeResponse {
  ok: boolean;
  user: SessionUser;
}

// POST /api/login
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

// GET /api/me
export async function apiGetMe(token: string): Promise<SessionUser> {
  const r = await apiRequest<MeResponse>("/api/me", { token });
  return r.user;
}

// GET /api/sync
export async function apiGetSync(token: string): Promise<SyncResponse> {
  return apiRequest<SyncResponse>("/api/sync", { token });
}
