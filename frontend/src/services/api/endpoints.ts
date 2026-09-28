// Typed wrappers for the MNores API. All URLs are relative to the runtime
// server selected in serverConfig.ts.

import { apiRequest, apiRequestAtBaseUrl } from "@/src/services/api/client";
import { APP_VERSION, API_VERSION } from "@/src/config";
import { normalizeServerUrl } from "@/src/services/serverConfig";
import { PushChange, PushResponse, SessionUser, SyncResponse } from "@/src/types";

interface LoginResponse { ok: boolean; token: string; user: SessionUser; }
interface MeResponse { ok: boolean; user: SessionUser; }

export interface HandshakeResponse {
  ok: boolean;
  app_name: string;
  app_title: string;
  app_version: string;
  api_version: string;
}

export async function apiHandshake(serverUrl: string): Promise<HandshakeResponse> {
  const baseUrl = normalizeServerUrl(serverUrl);
  return apiRequestAtBaseUrl(
    baseUrl,
    `/api/handshake?client_app_version=${encodeURIComponent(APP_VERSION)}&client_api_version=${encodeURIComponent(API_VERSION)}`,
  );
}

export async function apiLogin(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
  const r = await apiRequest<LoginResponse>("/api/login", { method: "POST", body: { username, password } });
  return { token: r.token, user: r.user };
}

export async function apiGetMe(token: string): Promise<SessionUser> {
  const r = await apiRequest<MeResponse>("/api/me", { token });
  return r.user;
}

export async function apiGetSync(token: string, since?: string | null): Promise<SyncResponse> {
  const path = since ? `/api/sync?since=${encodeURIComponent(since)}` : "/api/sync";
  return apiRequest<SyncResponse>(path, { token });
}

export async function apiPush(token: string, changes: PushChange[]): Promise<PushResponse> {
  return apiRequest<PushResponse>("/api/parts/push", {
    method: "POST", token, body: { changes },
  });
}

interface BoatsResponse { ok: boolean; boats: import("@/src/types").Boat[]; }
interface BoatResponse { ok: boolean; boat: import("@/src/types").Boat; }
export async function apiGetBoats(token: string): Promise<import("@/src/types").Boat[]> {
  return (await apiRequest<BoatsResponse>("/api/boats", { token })).boats;
}
export async function apiCreateBoat(token: string, input: { name: string; registration: string; is_active: boolean }): Promise<import("@/src/types").Boat> {
  return (await apiRequest<BoatResponse>("/api/boats", { method: "POST", token, body: { action: "create", ...input } })).boat;
}
export async function apiUpdateBoat(token: string, input: { id: number; name: string; registration: string; is_active: boolean }): Promise<import("@/src/types").Boat> {
  return (await apiRequest<BoatResponse>("/api/boats", { method: "POST", token, body: { action: "update", ...input } })).boat;
}
export async function apiToggleBoat(token: string, id: number): Promise<import("@/src/types").Boat> {
  return (await apiRequest<BoatResponse>("/api/boats", { method: "POST", token, body: { action: "toggle", id } })).boat;
}
export async function apiDeleteBoat(token: string, id: number): Promise<void> {
  await apiRequest<{ ok: boolean; deleted?: boolean }>("/api/boats", { method: "POST", token, body: { action: "delete", id } });
}

interface UsersResponse { ok: boolean; users: import("@/src/types").User[]; }
interface UserResponse { ok: boolean; user: import("@/src/types").User; }
export async function apiGetUsers(token: string): Promise<import("@/src/types").User[]> {
  return (await apiRequest<UsersResponse>("/api/users", { token })).users;
}
export async function apiCreateUser(token: string, input: { username: string; first_name: string; last_name: string; password: string; password2: string; role: import("@/src/types").Role; boat_id: number | null; is_active: boolean }): Promise<import("@/src/types").User> {
  return (await apiRequest<UserResponse>("/api/users", { method: "POST", token, body: { action: "create", ...input } })).user;
}
export async function apiUpdateUser(token: string, input: { id: number; username: string; first_name: string; last_name: string; password?: string; password2?: string; role: import("@/src/types").Role; boat_id: number | null; is_active: boolean }): Promise<import("@/src/types").User> {
  return (await apiRequest<UserResponse>("/api/users", { method: "POST", token, body: { action: "update", ...input } })).user;
}
export async function apiToggleUser(token: string, id: number): Promise<import("@/src/types").User> {
  return (await apiRequest<UserResponse>("/api/users", { method: "POST", token, body: { action: "toggle", id } })).user;
}
export async function apiDeleteUser(token: string, id: number): Promise<void> {
  await apiRequest<{ ok: boolean; deleted?: boolean }>("/api/users", { method: "POST", token, body: { action: "delete", id } });
}

interface CategoriesResponse { ok: boolean; categories: import("@/src/types").Category[]; }
interface CategoryResponse { ok: boolean; category: import("@/src/types").Category; }
export async function apiGetCategories(token: string): Promise<import("@/src/types").Category[]> {
  return (await apiRequest<CategoriesResponse>("/api/categories", { token })).categories;
}
export async function apiCreateCategory(token: string, name: string): Promise<import("@/src/types").Category> {
  return (await apiRequest<CategoryResponse>("/api/categories", { method: "POST", token, body: { action: "create", name } })).category;
}
export async function apiRenameCategory(token: string, id: number, name: string): Promise<import("@/src/types").Category> {
  return (await apiRequest<CategoryResponse>("/api/categories", { method: "POST", token, body: { action: "rename", id, name } })).category;
}
export async function apiDeleteCategory(token: string, id: number): Promise<void> {
  await apiRequest<{ ok: boolean; deleted?: boolean; moved_parts?: number }>("/api/categories", { method: "POST", token, body: { action: "delete", id });
}

export async function apiGetAudit(token: string, params: { page?: number; operation?: string; object_type?: string; actor_username?: string } = {}): Promise<import("@/src/types").AuditResponse> {
  const query = new URLSearchParams();
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.operation) query.set("operation", params.operation);
  if (params.object_type) query.set("object_type", params.object_type);
  if (params.actor_username) query.set("actor_username", params.actor_username);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<import("@/src/types").AuditResponse>(`/api/audit${suffix}`, { token });
}
