// Sync status screen: connectivity, last sync, pending count, cached counts,
// a neutral conflict notice and a manual "Sync now" action.

import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/src/components/StatusBadge";
import { useCounts } from "@/src/hooks/useInventory";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { useSync } from "@/src/state/SyncContext";
import { makeStyles } from "@/src/theme";

export default function SyncScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const { online } = useConnectivity();
  const { session } = useSession();
  const { status, pendingCount, lastError, conflictNotice, diagnostics, receivedParts, receivedActiveParts, receivedDeletedParts, cachedParts, protectedIds, missingActiveIds, syncNow, clearConflictNotice } = useSync();
  const { data: counts } = useCounts();

  const syncing = status === "syncing";

  const lastSync = useMemo(() => {
    if (!session?.last_sync_at) return "Nunca";
    const d = new Date(session.last_sync_at);
    return isNaN(d.getTime()) ? session.last_sync_at : d.toLocaleString();
  }, [session?.last_sync_at]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Sincronización</Text>
        <StatusBadge online={online} syncing={syncing} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Row label="Conexión" value={online ? "Online" : "Offline"} />
          <Row label="Última sincronización" value={lastSync} />
          <Row label="Cambios pendientes" value={String(pendingCount)} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cache local</Text>
          <Row label="Repuestos" value={String(counts?.parts ?? 0)} />
          <Row label="Servidor (última sync)" value={String(receivedParts)} />
          <Row label="Servidor activos" value={String(receivedActiveParts)} />
          <Row label="Servidor eliminados" value={String(receivedDeletedParts)} />
          <Row label="Cache tras sync" value={String(cachedParts)} />
          <Row label="IDs protegidos" value={protectedIds.length ? protectedIds.join(", ") : "ninguno"} />
          <Row label="Activos no guardados" value={missingActiveIds.length ? missingActiveIds.join(", ") : "ninguno"} />
          <Row label="Categorías" value={String(counts?.categories ?? 0)} />
          <Row label="Barcos" value={String(counts?.boats ?? 0)} />
        </View>

        {conflictNotice && (
          <View style={styles.notice} testID="conflict-notice">
            <Text style={styles.noticeText}>
              El servidor reconcilió algún cambio. Se ha actualizado el inventario con el
              estado del servidor.
            </Text>
            <Pressable onPress={clearConflictNotice} testID="conflict-dismiss">
              <Text style={styles.noticeDismiss}>Entendido</Text>
            </Pressable>
          </View>
        )}

        {!!lastError && (
          <Text style={styles.error} testID="sync-error">
            {lastError}
          </Text>
        )}

        {!!diagnostics && (
          <View style={styles.card} testID="sync-diagnostics">
            <Text style={styles.cardTitle}>Diagnóstico última sincronización</Text>
            <Row label="Endpoint" value={`${diagnostics.method} ${diagnostics.path}`} />
            <Row label="Status HTTP" value={diagnostics.httpStatus != null ? String(diagnostics.httpStatus) : "—"} />
            <Row label="Clasificación" value={diagnostics.classification} />
            <Row label="Timeout" value={diagnostics.timeout ? "Sí" : "No"} />
            <Row label="Error de red (fetch)" value={diagnostics.fetchError ? "Sí" : "No"} />
            <Row label="JSON válido" value={diagnostics.parseOk ? "Sí" : "No"} />
            <Row label="Hora" value={new Date(diagnostics.at).toLocaleTimeString()} />
            {!!diagnostics.bodySnippet && (
              <View style={styles.bodyBox}>
                <Text style={styles.bodyLabel}>Respuesta (recorte)</Text>
                <Text style={styles.bodyText} testID="sync-diagnostics-body">
                  {diagnostics.bodySnippet || "(cuerpo vacío)"}
                </Text>
              </View>
            )}
            {!diagnostics.bodySnippet && diagnostics.classification !== "ok" && (
              <Text style={styles.bodyText}>Cuerpo de respuesta vacío.</Text>
            )}
          </View>
        )}

        <Pressable
          style={[styles.button, (!online || syncing) && styles.buttonDisabled]}
          onPress={() => syncNow()}
          disabled={!online || syncing}
          testID="sync-now-button"
        >
          <Text style={styles.buttonText}>{syncing ? "Sincronizando…" : "Sincronizar ahora"}</Text>
        </Pressable>

        {!online && (
          <Text style={styles.hint}>
            Trabajas en modo offline. El inventario y tus cambios siguen disponibles; la cola
            se sincronizará automáticamente al recuperar la conexión.
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
  screen: { flex: 1, backgroundColor: colors.surface },
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
  title: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurfaceSecondary },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  notice: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  noticeText: { fontSize: 14, color: colors.onBrandTertiary, lineHeight: 19 },
  noticeDismiss: { fontSize: 14, fontWeight: "700", color: colors.brandPrimary },
  error: { color: colors.error, fontSize: 14 },
  bodyBox: { gap: 4 },
  bodyLabel: { fontSize: 12, fontWeight: "600", color: colors.muted },
  bodyText: { fontSize: 13, color: colors.onSurface, fontFamily: "monospace" },
  button: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 18 },
}));
