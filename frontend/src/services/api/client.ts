// Centralized API client. Every HTTP call to the MNores PHP API goes through
// here. It injects the Bearer token, applies a bounded timeout, parses JSON
// safely and classifies errors precisely so the caller can distinguish a real
// connectivity problem from an HTTP/parse/API error. It never logs tokens.

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "@/src/config";

export type ApiErrorKind = "network" | "timeout" | "http" | "parse" | "api";

export class ApiError extends Error {
  status: number; // HTTP status (0 when the request never completed)
  kind: ApiErrorKind;
  bodySnippet: string | null; // truncated response body (never a token)
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

export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError("API base URL no configurada (EXPO_PUBLIC_API_BASE_URL)", 0, "network");
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

  // HTTP-level failure (e.g. 500). The body may be empty or HTML.
  if (!res.ok) {
    const asObj = (json ?? {}) as { error?: string };
    throw new ApiError(
      asObj.error || `Error HTTP ${res.status}`,
      res.status,
      "http",
      text ? snippet(text) : null,
    );
  }

  // 2xx but body was not valid JSON.
  if (text && !parseOk) {
    throw new ApiError("Respuesta del servidor no válida", res.status, "parse", snippet(text));
  }

  // Application-level rejection.
  const asObj = (json ?? {}) as { ok?: boolean; error?: string };
  if (asObj.ok === false) {
    throw new ApiError(asObj.error || "Operación rechazada", res.status, "api", text ? snippet(text) : null);
  }

  return json as T;
}
