import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { localStore } from "@/src/database/store";
import { initializeServerConfig } from "@/src/services/serverConfig";
import { sessionRepository } from "@/src/repositories/sessionRepository";
import { runSync } from "./syncEngine";
import { executeBackgroundSync } from "./backgroundRunner";
import { backgroundBridge, withSyncLock } from "./nativeBackground";

// Imported by index.js before Expo Router; available in a cold headless runtime.
if (Platform.OS === "android") {
  TaskManager.defineTask("ShipInventoryBackgroundSync", () => executeBackgroundSync({
    initialize: async () => {
      await initializeServerConfig();
      await localStore.init();
    },
    restore: () => sessionRepository.restore(),
    pendingCount: () => localStore.getPendingCount(),
    sync: (token) => runSync(token, { deadline: Date.now() + 3 * 60 * 1000 }),
    suspendAuth: (rejectedToken) => withSyncLock(async () => {
      // Do not suspend a new login if it raced with the completed sync attempt.
      const current = await sessionRepository.restore();
      if (current.token === rejectedToken) await backgroundBridge?.suspendAuth();
    }),
  }));
}
