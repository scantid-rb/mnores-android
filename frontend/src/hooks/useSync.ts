// Initial sync hook. Runs when authenticated AND online. Writes to SQLite,
// then invalidates the local read queries so the UI refreshes from the cache.
// A 401 triggers sign-out (re-login required); other errors keep the cache.

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/src/services/api/client";
import { runInitialSync } from "@/src/services/sync/syncService";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";

export function useInitialSync() {
  const { token, signOut } = useSession();
  const { online } = useConnectivity();
  const qc = useQueryClient();

  return useQuery({
    queryKey: ["sync"],
    enabled: !!token && online,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      try {
        const result = await runInitialSync(token as string);
        qc.invalidateQueries({ queryKey: ["parts"] });
        qc.invalidateQueries({ queryKey: ["categories"] });
        qc.invalidateQueries({ queryKey: ["boats"] });
        qc.invalidateQueries({ queryKey: ["counts"] });
        return result;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          await signOut();
        }
        throw e;
      }
    },
  });
}
