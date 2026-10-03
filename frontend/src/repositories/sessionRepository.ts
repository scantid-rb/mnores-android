import { backgroundBridge, withSyncLock } from "@/src/services/sync/nativeBackground";
import { reconcileBackgroundSync } from "@/src/services/sync/backgroundScheduling";

// Session repository: the only place that combines secure token storage with
// the local session metadata.

import { storage } from "@/src/utils/storage";
import { TOKEN_KEY } from "@/src/constants/storage";
import { apiGetMe, apiLogin } from "@/src/services/api/endpoints";
import { localStore } from "@/src/database/store";
import { SessionRow, SessionUser } from "@/src/types";

export const sessionRepository = {
  async restore(): Promise<{ token: string | null; session: SessionRow | null }> {
    const token = await storage.secureGet(TOKEN_KEY, "");
    const session = await localStore.getSession();
    return { token: token ? (token as string) : null, session };
  },
  async login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
    return withSyncLock(async () => {
      const previous = await localStore.getSession();
      const { token, user } = await apiLogin(username, password);
      const switchedUser = previous != null &&
        (previous.id !== user.id || previous.username !== user.username ||
         previous.role !== user.role || previous.boat_id !== user.boat_id);
      await backgroundBridge?.suspendAuth();
      try {
        if (!await storage.secureSet(TOKEN_KEY, token)) {
          throw new Error("No se pudo guardar la sesión de forma segura.");
        }
        if (switchedUser) await localStore.clearUserData();
        await localStore.saveSession(user);
        await backgroundBridge?.resumeAuth();
        await reconcileBackgroundSync();
        return { token, user };
      } catch (error) {
        // Never allow a partially saved identity to drive a headless sync.
        await storage.secureRemove(TOKEN_KEY);
        throw error;
      }
    });
  },
  async logout(): Promise<void> {
    await withSyncLock(async () => {
      await backgroundBridge?.suspendAuth();
      await storage.secureRemove(TOKEN_KEY);
      await localStore.clearSession();
    });
  },
  validate(token: string): Promise<SessionUser> {
    return apiGetMe(token);
  },
};
