// Typed wrappers for the MNores API. All URLs are relative to the runtime
// server selected in serverConfig.ts.

import { apiRequest, apiRequestAtBaseUrl } from "@/src/services/api/client";
import * as FileSystem from "expo-file-system/legacy";
import { APP_VERSION, API_VERSION } from "@/src/config";
import { normalizeServerUrl } from "@/src/services/serverConfig";
import { PushChange, PushResponse, SessionUser, SyncResponse } from "@/src/types";


export interface ServerSettings {
  app_name: string;
  app_title: string;
  company_name: string;
  backup_interval_days: number;
  backup_retention_days: number;
  audit_retention_days: number;
  disk_warning_percent: number;
}

interface ServerSettingsResponse {
  ok: boolean;
  settings: Record<string, string>;
}

function parseServerSettings(raw: Record<string, string>): ServerSettings {
  return {
    app_name: raw.app_name ?? "",
    app_title: raw.app_title ?? "",
    company_name: raw.company_name ?? "",
    backup_interval_days: Number(raw.backup_interval_days),
    backup_retention_days: Number(raw.backup_retention_days),
    audit_retention_days: Number(raw.audit_retention_days),
    disk_warning_percent: Number(raw.disk_warning_percent),
  };
}

export async function apiGetSettings(token: string): Promise<ServerSettings> {
  const r = await apiRequest<ServerSettingsResponse>("/api/settings", { token });
  return parseServerSettings(r.settings);
}

export async function apiUpdateSettings(token: string, settings: ServerSettings): Promise<ServerSettings> {
  const r = await apiRequest<ServerSettingsResponse>("/api/settings", {
    method: "POST",
    token,
    body: settings,
  });
  return parseServerSettings(r.settings);
}

export interface ServerStatus {
  ok: boolean;
  app_version: string;
  api_version: string;
  schema_version: number;
  sqlite_integrity: string;
  database_size_bytes: number;
  disk: {
    free_bytes: number | null;
    total_bytes: number | null;
    free_percent: number | null;
    warning_percent: number;
    warning: boolean;
  };
  backup: {
    last_auto: { name: string; mtime: number } | null;
    last_run: number | null;
    last_failure: string | null;
  };
  directories: Record<string, boolean>;
}

export async function apiGetStatus(token: string): Promise<ServerStatus> {
  return apiRequest<ServerStatus>("/api/status", { token });
}

interface LoginResponse { ok: boolean; token: string; user: SessionUser; }
interface MeResponse { ok: boolean; user: SessionUser; }

export interface HandshakeResponse {
  ok: boolean;
  app_name: string;
  app_title: string;
  app_version: string;
  api_version: string;
  installed: boolean;
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
  await apiRequest<{ ok: boolean; deleted?: boolean; moved_parts?: number }>("/api/categories", {
    method: "POST",
    token,
    body: { action: "delete", id },
  });
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

export interface ServerBackup {
  name: string;
  type: "manual" | "auto" | "security" | "app" | "otros";
  label: string;
  size: number;
  mtime: number;
}

export interface ServerBackupsResponse {
  ok: boolean;
  items: ServerBackup[];
  interval_days: number;
  last_run: number | null;
  last_failure: string | null;
}

export async function apiGetBackups(token: string): Promise<ServerBackupsResponse> {
  return apiRequest<ServerBackupsResponse>("/api/backups", { token });
}

export async function apiCreateBackup(token: string, type: "data" | "app"): Promise<{ name: string }> {
  const action = type === "app" ? "create_app" : "create_data";
  return apiRequest<{ ok: boolean; name: string }>("/api/backups", {
    method: "POST",
    token,
    body: { action },
  });
}

export async function apiDeleteBackup(token: string, name: string): Promise<void> {
  await apiRequest("/api/backups", {
    method: "POST",
    token,
    body: { action: "delete", name },
  });
}

export async function apiRestoreBackup(token: string, name: string): Promise<{ security_backup: string | null; session_invalidated: boolean }> {
  return apiRequest("/api/backups", {
    method: "POST",
    token,
    body: { action: "restore", name },
  });
}

export async function apiDownloadBackup(token: string, name: string, targetUri: string): Promise<string> {
  // The same backup may be downloaded repeatedly. Remove the previous
  // temporary copy first so the download always starts from a clean target.
  try {
    if (await FileSystem.getInfoAsync(targetUri).then((info) => info.exists)) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    }
  } catch {
    // If the temporary file cannot be inspected/removed, let downloadAsync
    // report the actual download error instead of masking it here.
  }

  const result = await FileSystem.downloadAsync(
    `${await getServerUrl()}/api/backups/${encodeURIComponent(name)}/download`,
    targetUri,
    {
      headers: { Accept: "application/zip", Authorization: `Bearer ${token}` },
    },
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`No se pudo descargar el backup (HTTP ${result.status}).`);
  }
  return result.uri;
}

export async function apiRestoreBackupUpload(token: string, fileUri: string, fileName: string): Promise<{ security_backup: string | null; session_invalidated: boolean }> {
  const result = await FileSystem.uploadAsync(
    `${await getServerUrl()}/api/backups/restore-upload`,
    fileUri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "backup",
      mimeType: "application/zip",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      parameters: { filename: fileName },
    },
  );
  const text = result.body ?? "";
  let json: { ok?: boolean; error?: string; security_backup?: string | null; session_invalidated?: boolean } = {};
  try { json = text ? JSON.parse(text) : {}; } catch { throw new Error("Respuesta de restauración no válida."); }
  if (result.status < 200 || result.status >= 300 || json.ok === false) {
    throw new Error(json.error || `Error HTTP ${result.status}`);
  }
  return { security_backup: json.security_backup ?? null, session_invalidated: json.session_invalidated === true };
}
