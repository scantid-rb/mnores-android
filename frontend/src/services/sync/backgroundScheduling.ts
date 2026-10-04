import { localStore } from "@/src/database/store";
import { backgroundBridge } from "./nativeBackground";

// Awaited after durable writes. Failure does not turn a saved mutation into
// a failed mutation; startup/foreground reconciliation will repair scheduling.
export async function reconcileBackgroundSync(): Promise<void> {
  if (!backgroundBridge) return;
  try {
    await backgroundBridge.register();
    await backgroundBridge.reconcile(await localStore.getPendingCount() > 0);
  } catch (error) {
    console.warn("[BACKGROUND SYNC] Could not reconcile Android work", error);
  }
}
