import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "@/src/config";
import { ApiError } from "@/src/services/api/client";

export async function pickPartPhoto(source: "camera" | "library"): Promise<string | null> {
  const permission = source === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Permiso de cámara/fotos no concedido.");
  const result = source === "camera"
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [4, 3], quality: 0.85 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [4, 3], quality: 0.85 });
  if (result.canceled || !result.assets[0]?.uri) return null;
  return persistPhoto(result.assets[0].uri);
}

export async function persistPhoto(sourceUri: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}photos/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const target = `${dir}photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

export async function uploadPartPhoto(token: string, partId: number, localPath: string): Promise<{ updated_at: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const form = new FormData();
  form.append("photo", { uri: localPath, name: `part-${partId}.jpg`, type: "image/jpeg" } as unknown as Blob);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/photos/${partId}`, { method: "POST", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, body: form, signal: controller.signal });
  } catch (e: unknown) {
    clearTimeout(timer);
    if ((e as { name?: string })?.name === "AbortError") throw new ApiError("Tiempo de espera agotado", 0, "timeout");
    throw new ApiError("No se pudo subir la foto", 0, "network");
  }
  clearTimeout(timer);
  const text = await response.text();
  let json: { ok?: boolean; error?: string; updated_at?: string };
  try { json = JSON.parse(text) as typeof json; }
  catch { throw new ApiError("Respuesta de foto no válida", response.status, "parse", text.slice(0, 300)); }
  if (!response.ok || json.ok === false) throw new ApiError(json.error || `Error HTTP ${response.status}`, response.status, response.ok ? "api" : "http", text.slice(0, 300));
  if (!json.updated_at) throw new ApiError("La respuesta de foto no contiene updated_at", response.status, "parse", text.slice(0, 300));
  return { updated_at: json.updated_at };
}

export function remotePartPhotoUrl(partId: number): string {
  return `${API_BASE_URL}/api/photos/${partId}`;
}
