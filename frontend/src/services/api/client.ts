// Centralized API client. Every HTTP call to the MNores PHP API goes through
// here. Screens must NOT call fetch directly. The client injects the Bearer
// token, applies a bounded timeout, parses JSON safely and normalizes errors.
// It never logs tokens or passwords.

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "@/src/config";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  token?: string | null;
  body?: unknown;
  timeoutMs?: number;
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError(
      "API base URL no configurada (EXPO_PUBLIC_API_BASE_URL)",
      0,
    );
  }

  const { method = "GET", token, body, timeoutMs = REQUEST_TIMEOUT_MS } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e: unknown) {
    clearTimeout(timer);
    const name = (e as { name?: string })?.name;
    if (name === "AbortError") {
      throw new ApiError("Tiempo de espera agotado", 0);
    }
    throw new ApiError("No se pudo conectar con el servidor", 0);
  }
  clearTimeout(timer);

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError("Respuesta del servidor no válida", res.status);
    }
  }

  const asObj = (json ?? {}) as { ok?: boolean; error?: string };

  if (!res.ok) {
    throw new ApiError(asObj.error || `Error HTTP ${res.status}`, res.status, json);
  }
  if (asObj.ok === false) {
    throw new ApiError(asObj.error || "Operación rechazada", res.status, json);
  }

  return json as T;
}
