import { DEFAULT_API_BASE_URL } from "@/src/config";
import { SERVER_URL_KEY } from "@/src/constants/storage";
import { storage } from "@/src/utils/storage";

let currentServerUrl = DEFAULT_API_BASE_URL;

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Introduce la dirección del servidor.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("La dirección del servidor no es válida.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Por seguridad, el servidor debe utilizar HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("La dirección del servidor no puede contener credenciales.");
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export async function initializeServerConfig(): Promise<string> {
  const stored = await storage.getItem(SERVER_URL_KEY, "");
  if (stored) {
    try {
      currentServerUrl = normalizeServerUrl(String(stored));
    } catch {
      currentServerUrl = DEFAULT_API_BASE_URL;
    }
  } else {
    currentServerUrl = DEFAULT_API_BASE_URL;
  }
  return currentServerUrl;
}

export async function getServerUrl(): Promise<string> {
  return currentServerUrl;
}

export function getServerUrlSync(): string {
  return currentServerUrl;
}

export async function setServerUrl(value: string): Promise<string> {
  const normalized = normalizeServerUrl(value);
  const saved = await storage.setItem(SERVER_URL_KEY, normalized);
  if (!saved) throw new Error("No se pudo guardar la configuración del servidor.");
  currentServerUrl = normalized;
  return normalized;
}
