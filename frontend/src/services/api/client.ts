// Centralized API client. All HTTP calls use the server URL selected at
// runtime. The client never embeds an endpoint URL in individual services.

import { REQUEST_TIMEOUT_MS } from "@/src/config";
import { getServerUrl } from "@/src/services/serverConfig";

export type ApiErrorKind = "network" | "timeout" | "http" | "parse" | "api";

export class ApiError extends Error {
  status: number;
  kind: ApiErrorKind;
  bodySnippet: string | null;
  constructor(
    message: string,
    status: number,
    kind: ApiErrorKind,
    bodySnippet: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.bodySnippet = bodySnippet;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  token?: string | null;
  body?: unknown;
  timeoutMs?: number;
}

function snippet(text: string): string {
  const t = text.trim();
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}

function normalizeRequestBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function requestAtBaseUrl<T = unknown>(
  baseUrl: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", token, body, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${normalizeRequestBaseUrl(baseUrl)}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e: unknown) {
    clearTimeout(timer);
    const name = (e as { name?: string })?.name;
    if (name === "AbortError") {
      throw new ApiError("Tiempo de espera agotado", 0, "timeout");
    }
    throw new ApiError("No se pudo conectar con el servidor", 0, "network");
  }
  clearTimeout(timer);

  const text = await res.text();
  let json: unknown = null;
  let parseOk = true;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      parseOk = false;
    }
  }

  if (!res.ok) {
    const asObj = (json ?? {}) as { error?: string };
    throw new ApiError(
      asObj.error || `Error HTTP ${res.status}`,
      res.status,
      "http",
      text ? snippet(text) : null,
    );
  }

  if (text && !parseOk) {
    throw new ApiError("Respuesta del servidor no válida", res.status, "parse", snippet(text));
  }

  const asObj = (json ?? {}) as { ok?: boolean; error?: string };
  if (asObj.ok === false) {
    throw new ApiError(asObj.error || "Operación rechazada", res.status, "api", text ? snippet(text) : null);
  }

  return json as T;
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  return requestAtBaseUrl(await getServerUrl(), path, opts);
}

export async function apiRequestAtBaseUrl<T = unknown>(
  baseUrl: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  return requestAtBaseUrl(baseUrl, path, opts);
}
