import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "react-native";
import { REQUEST_TIMEOUT_MS } from "@/src/config";
import { getServerUrl, getServerUrlSync } from "@/src/services/serverConfig";
import { ApiError } from "@/src/services/api/client";

const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1200;
const DEFAULT_QUALITY = 0.85;
const MIN_QUALITY = 0.60;
const MAX_FILE_SIZE = 8 * 1024 * 1024;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return info.exists && "size" in info && typeof info.size === "number" ? info.size : 0;
}

async function removeFile(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Local cleanup must never make an otherwise valid operation fail.
  }
}

async function processPhoto(sourceUri: string): Promise<string> {
  const { width, height } = await getImageSize(sourceUri);
  const size = targetSize(width, height);
  const actions = width !== size.width || height !== size.height
    ? [{ resize: size }]
    : [];

  let quality = DEFAULT_QUALITY;
  let currentUri = sourceUri;
  let previousUri: string | null = null;

  try {
    while (true) {
      const result = await ImageManipulator.manipulateAsync(
        currentUri,
        actions,
        {
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );

      if (previousUri && previousUri !== sourceUri && previousUri !== result.uri) {
        await removeFile(previousUri);
      }
      previousUri = currentUri !== sourceUri ? currentUri : null;
      currentUri = result.uri;

      if (await fileSize(currentUri) <= MAX_FILE_SIZE) {
        return currentUri;
      }

      if (quality <= MIN_QUALITY) {
        throw new Error("No se pudo reducir la foto por debajo de 8 MB manteniendo una calidad mínima del 60 %.");
      }

      quality = Math.max(MIN_QUALITY, Math.round((quality - 0.05) * 100) / 100);
    }
  } catch (error) {
    if (currentUri !== sourceUri) await removeFile(currentUri);
    if (previousUri && previousUri !== sourceUri) await removeFile(previousUri);
    throw error;
  }
}

export async function pickPartPhoto(source: "camera" | "library"): Promise<string | null> {
  const permission = source === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Permiso de cámara/fotos no concedido.");

  const result = source === "camera"
    ? await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: DEFAULT_QUALITY,
      })
    : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: DEFAULT_QUALITY,
      });

  if (result.canceled || !result.assets[0]?.uri) return null;
  const processed = await processPhoto(result.assets[0].uri);
  try {
    return await persistPhoto(processed);
  } finally {
    await removeFile(processed);
  }
}

export async function persistPhoto(sourceUri: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}photos/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const target = `${dir}photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

export async function removeLocalPhoto(localPath: string | null | undefined): Promise<void> {
  if (localPath) await removeFile(localPath);
}

export async function uploadPartPhoto(token: string, partId: number, localPath: string): Promise<{ updated_at: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let result: FileSystem.FileSystemUploadResult;
  try {
    result = await FileSystem.uploadAsync(
      `${await getServerUrl()}/api/photos/${partId}`,
      localPath,
      {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        mimeType: "image/jpeg",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      },
    );
  } catch (e: unknown) {
    clearTimeout(timer);
    if ((e as { name?: string })?.name === "AbortError") {
      throw new ApiError("Tiempo de espera agotado", 0, "timeout");
    }
    throw new ApiError("No se pudo subir la foto", 0, "network");
  }

  clearTimeout(timer);

  const text = result.body ?? "";
  let json: { ok?: boolean; error?: string; updated_at?: string };
  try {
    json = text ? (JSON.parse(text) as typeof json) : {};
  } catch {
    throw new ApiError(
      "Respuesta de foto no válida",
      result.status,
      "parse",
      text.slice(0, 300),
    );
  }

  if (result.status < 200 || result.status >= 300 || json.ok === false) {
    throw new ApiError(
      json.error || `Error HTTP ${result.status}`,
      result.status,
      result.status >= 200 && result.status < 300 ? "api" : "http",
      text.slice(0, 300),
    );
  }

  if (!json.updated_at) {
    throw new ApiError(
      "La respuesta de foto no contiene updated_at",
      result.status,
      "parse",
      text.slice(0, 300),
    );
  }

  return { updated_at: json.updated_at };
}

export function remotePartPhotoUrl(partId: number): string {
  return `${getServerUrlSync()}/api/photos/${partId}`;
}
