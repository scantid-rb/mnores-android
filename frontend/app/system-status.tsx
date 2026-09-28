import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGetStatus, ServerStatus } from "@/src/services/api/endpoints";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles } from "@/src/theme";

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUtc(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function StatusRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function SystemStatusScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useSession();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !user || !["admin", "inspector"].includes(user.role)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await apiGetStatus(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar el estado del servidor.");
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => { load(); }, [load]);

  const allowed = !!user && ["admin", "inspector"].includes(user.role);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Estado del sistema</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!allowed ? (
        <View style={styles.center}>
          <Text style={styles.error}>No tienes permiso para consultar el estado del sistema.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable style={[styles.refreshButton, loading && styles.disabled]} onPress={load} disabled={loading}>
            {loading ? <ActivityIndicator /> : <Text style={styles.refreshText}>Actualizar estado</Text>}
          </Pressable>

          {!!error && <Text style={styles.error}>{error}</Text>}

          {status && (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Aplicación</Text>
                <StatusRow label="Versión aplicación" value={status.app_version} />
                <StatusRow label="Versión API" value={status.api_version} />
                <StatusRow label="Versión esquema" value={String(status.schema_version)} />
                <StatusRow label="SQLite integrity_check" value={status.sqlite_integrity} />
                <StatusRow label="Tamaño BD" value={formatBytes(status.database_size_bytes)} />
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Almacenamiento</Text>
                <StatusRow label="Espacio libre" value={`${formatBytes(status.disk.free_bytes)} de ${formatBytes(status.disk.total_bytes)}`} />
                <StatusRow label="Porcentaje libre" value={status.disk.free_percent === null ? "—" : `${status.disk.free_percent.toFixed(1)} %`} />
                <StatusRow label="Umbral de aviso" value={`${status.disk.warning_percent} %`} />
                <StatusRow label="Estado" value={status.disk.warning ? "AVISO: espacio bajo" : "OK"} />
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Backups</Text>
                <StatusRow label="Último auto-backup" value={status.backup.last_auto?.name ?? "—"} />
                <StatusRow label="Fecha último auto-backup" value={status.backup.last_auto ? formatUtc(status.backup.last_auto.mtime) : "—"} />
                <StatusRow label="Última ejecución" value={formatUtc(status.backup.last_run)} />
                <StatusRow label="Último fallo" value={status.backup.last_failure ?? "Ninguno"} />
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Directorios del servidor</Text>
                {Object.entries(status.directories).map(([name, ok]) => (
                  <StatusRow key={name} label={name} value={ok ? "OK" : "Falta o sin permisos"} />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { minHeight: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backText: { fontSize: 34, lineHeight: 38, color: colors.onSurface },
  headerSpacer: { width: 44 },
  title: { flex: 1, textAlign: "center", fontSize: 20, fontWeight: "800", color: colors.onSurface },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 4, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface, marginBottom: 6 },
  row: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary },
  rowValue: { flex: 1, textAlign: "right", fontSize: 13, fontWeight: "600", color: colors.onSurface },
  refreshButton: { minHeight: 46, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  refreshText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  error: { padding: 12, color: colors.error, fontWeight: "600", textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
}));
