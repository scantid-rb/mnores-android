// Sync status screen: connectivity, last sync time, cached counts and a
// manual "Sync now" action. The full push/retry/conflict engine is a later
// phase; here we run the initial pull.

import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/src/components/StatusBadge";
import { useCounts } from "@/src/hooks/useInventory";
import { useInitialSync } from "@/src/hooks/useSync";
import { ApiError } from "@/src/services/api/client";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles, useTheme } from "@/src/theme";

export default function SyncScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { online } = useConnectivity();
  const { session } = useSession();
  const sync = useInitialSync();
  const { data: counts } = useCounts();

  const lastSync = useMemo(() => {
    if (!session?.last_sync_at) return "Nunca";
    const d = new Date(session.last_sync_at);
    return isNaN(d.getTime()) ? session.last_sync_at : d.toLocaleString();
  }, [session?.last_sync_at]);

  const errorMessage =
    sync.error instanceof ApiError
      ? sync.error.message
      : sync.error
        ? "No se pudo sincronizar."
        : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Sincronización</Text>
        <StatusBadge online={online} syncing={sync.isFetching} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Row label="Conexión" value={online ? "Online" : "Offline"} />
          <Row label="Última sincronización" value={lastSync} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cache local</Text>
          <Row label="Repuestos" value={String(counts?.parts ?? 0)} />
          <Row label="Categorías" value={String(counts?.categories ?? 0)} />
          <Row label="Barcos" value={String(counts?.boats ?? 0)} />
        </View>

        {!!errorMessage && (
          <Text style={styles.error} testID="sync-error">
            {errorMessage}
          </Text>
        )}

        <Pressable
          style={[styles.button, (!online || sync.isFetching) && styles.buttonDisabled]}
          onPress={() => sync.refetch()}
          disabled={!online || sync.isFetching}
          testID="sync-now-button"
        >
          <Text style={styles.buttonText}>
            {sync.isFetching ? "Sincronizando…" : "Sincronizar ahora"}
          </Text>
        </Pressable>

        {!online && (
          <Text style={styles.hint}>
            Trabajas en modo offline. El inventario sigue disponible; la
            sincronización se reanudará al recuperar la conexión.
          </Text>
        )}
      </ScrollView>
    </View>
  );

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    );
  }
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.onSurface,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.onSurfaceSecondary,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 14,
    color: colors.muted,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
  },
  error: {
    color: colors.error,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.onBrandPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  hint: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
}));
