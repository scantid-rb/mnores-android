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
    return withSyncLock(async () => {
      const token = await storage.secureGet(TOKEN_KEY, "");
      const session = await localStore.getSession();
      return { token: token && session ? String(token) : null, session };
    });
  },
  async login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
    return withSyncLock(async () => {
      const previous = await localStore.getSession();
      const { token, user } = await apiLogin(username, password);
      const switchedUser = previous == null ||
        previous.id !== user.id || previous.username !== user.username ||
        previous.role !== user.role || previous.boat_id !== user.boat_id;
      await backgroundBridge?.suspendAuth();
      // SecureStore and SQLite cannot share a transaction. Remove the old
      // credential first, and never publish the new one before its owner/data.
      if (!await storage.secureRemove(TOKEN_KEY)) {
        throw new Error("No se pudo retirar la sesión anterior de forma segura.");
      }
      try {
        if (switchedUser) await localStore.clearUserData();
        await localStore.saveSession(user);
        if (!await storage.secureSet(TOKEN_KEY, token)) {
          throw new Error("No se pudo guardar la sesión de forma segura.");
        }
        await backgroundBridge?.resumeAuth();
        await reconcileBackgroundSync();
        return { token, user };
      } catch (error) {
        await storage.secureRemove(TOKEN_KEY);
        throw error;
      }
    });
  },
  async logout(): Promise<void> {
    await withSyncLock(async () => {
      await backgroundBridge?.suspendAuth();
      if (!await storage.secureRemove(TOKEN_KEY)) {
        throw new Error("No se pudo retirar la sesión de forma segura.");
      }
      // Keep the non-secret owner of retained inventory/queues. Without it a
      // later login could mistake another user's data for unowned data.
    });
  },
  async suspendIfCurrentToken(rejectedToken: string | null): Promise<void> {
    await withSyncLock(async () => {
      const current = await storage.secureGet(TOKEN_KEY, "");
      if ((current ? String(current) : null) === rejectedToken) {
        await backgroundBridge?.suspendAuth();
      }
    });
  },
  validate(token: string): Promise<SessionUser> {
    return apiGetMe(token);
  },
};
