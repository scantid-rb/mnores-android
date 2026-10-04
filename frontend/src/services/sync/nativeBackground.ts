import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

interface Bridge {
  register(): Promise<void>;
  reconcile(pending: boolean): Promise<void>;
  resumeAuth(): Promise<void>;
  suspendAuth(): Promise<void>;
  acquireSync(owner: string): Promise<void>;
  releaseSync(owner: string): Promise<void>;
}
export const backgroundBridge = Platform.OS === "android"
  ? requireOptionalNativeModule<Bridge>("ShipBackgroundSync") : null;

// A build with native support is required; Expo Go cannot load a local module.
export async function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  const owner = `${Date.now()}-${Math.random()}`;
  await backgroundBridge?.acquireSync(owner);
  try { return await work(); }
  finally { await backgroundBridge?.releaseSync(owner); }
}
