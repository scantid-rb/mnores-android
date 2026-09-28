import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import {
  apiCreateBackup,
  apiDeleteBackup,
  apiDownloadBackup,
  apiGetBackups,
  apiRestoreBackup,
  apiRestoreBackupUpload,
  ServerBackup,
} from "@/src/services/api/endpoints";
import { getServerUrl } from "@/src/services/serverConfig";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles } from "@/src/theme";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatUtc(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export default function BackupsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user, switchServer } = useSession();
  const allowed = !!user && ["admin", "inspector"].includes(user.role);
  const isAdmin = user?.role === "admin";

  const [items, setItems] = useState<ServerBackup[]>([]);
  const [intervalDays, setIntervalDays] = useState<number | null>(null);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [lastFailure, setLastFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiGetBackups(token);
      setItems(result.items);
      setIntervalDays(result.interval_days);
      setLastRun(result.last_run);
      setLastFailure(result.last_failure);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los backups.");
    } finally {
      setLoading(false);
    }
  }, [token, allowed]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const createBackup = (type: "data" | "app") => {
    if (!token) return;
    const title = type === "app" ? "Crear backup completo" : "Crear backup de datos";
    const message = type === "app"
      ? "Se creará un ZIP con código, datos y documentación de despliegue."
      : "Se creará un ZIP con la base de datos y las fotografías.";
    Alert.alert(title, message, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Crear",
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            const result = await apiCreateBackup(token, type);
            Alert.alert("Backup creado", result.name);
            await load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo crear el backup.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const downloadBackup = async (item: ServerBackup) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const dir = `${FileSystem.cacheDirectory}backups/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const uri = await apiDownloadBackup(token, item.name, `${dir}${item.name}`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/zip",
          dialogTitle: `Guardar ${item.name}`,
          UTI: "com.pkware.zip-archive",
        });
      } else {
        Alert.alert("Backup descargado", `Archivo guardado temporalmente en: ${uri}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar el backup.");
    } finally {
      setBusy(false);
    }
  };

  const deleteBackup = (item: ServerBackup) => {
    if (!token) return;
    Alert.alert("Eliminar backup", `¿Eliminar «${item.name}» del servidor?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await apiDeleteBackup(token, item.name);
            await load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo eliminar el backup.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const restoreServerBackup = (item: ServerBackup) => {
    if (!token || !isAdmin || item.type === "app") return;
    Alert.alert(
      "Restaurar backup",
      `Se sustituirá el estado actual por «${item.name}». Se creará primero un backup de seguridad y tendrás que iniciar sesión de nuevo.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Restaurar",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await apiRestoreBackup(token, item.name);
              Alert.alert(
                "Restauración completada",
                result.security_backup
                  ? `Se creó el backup de seguridad ${result.security_backup}. La sesión ha sido cerrada.`
                  : "La sesión ha sido cerrada.",
                [{
                  text: "Continuar",
                  onPress: async () => {
                    await switchServer(await getServerUrl());
                    router.replace("/login");
                  },
                }],
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "No se pudo restaurar el backup.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const restoreLocalBackup = async () => {
    if (!token || !isAdmin) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "application/zip",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      Alert.alert(
        "Restaurar desde archivo",
        `Se validará y restaurará «${asset.name}». Se creará primero un backup de seguridad y tendrás que iniciar sesión de nuevo.`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Validar y restaurar",
            style: "destructive",
            onPress: async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await apiRestoreBackupUpload(token, asset.uri, asset.name);
                Alert.alert(
                  "Restauración completada",
                  result.security_backup
                    ? `Se creó el backup de seguridad ${result.security_backup}. La sesión ha sido cerrada.`
                    : "La sesión ha sido cerrada.",
                  [{
                    text: "Continuar",
                    onPress: async () => {
                      await switchServer(await getServerUrl());
                      router.replace("/login");
                    },
                  }],
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "No se pudo restaurar el archivo.");
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo seleccionar el archivo.");
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Backups</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!allowed ? (
        <View style={styles.center}><Text style={styles.error}>No tienes permiso para consultar los backups.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.subtitle}>
              Backup de datos = base de datos + fotografías. Backup completo = código + datos + documentación de despliegue.
            </Text>
            <Pressable style={[styles.primaryButton, busy && styles.disabled]} disabled={busy} onPress={() => createBackup("data")}>
              <Text style={styles.primaryText}>Crear backup de datos</Text>
            </Pressable>
            <Pressable style={[styles.secondaryButton, busy && styles.disabled]} disabled={busy} onPress={() => createBackup("app")}>
              <Text style={styles.secondaryText}>Crear backup completo de aplicación</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Auto-backup (datos)</Text>
            <Text style={styles.info}>Cada {intervalDays ?? "—"} días · último: {formatUtc(lastRun)}</Text>
            {!!lastFailure && <Text style={styles.error}>Último fallo: {lastFailure}</Text>}
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.sectionTitle}>Backups disponibles en el servidor</Text>
          <Text style={styles.hint}>Descarga los backups para conservar una copia local. Elimina los que ya no necesites para liberar espacio.</Text>

          {loading ? <ActivityIndicator /> : items.length === 0 ? (
            <View style={styles.empty}><Text style={styles.hint}>Sin backups todavía.</Text></View>
          ) : items.map((item) => (
            <View key={item.name} style={styles.backupCard}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.label} · {formatBytes(item.size)} · {formatUtc(item.mtime)}</Text>
              <View style={styles.actions}>
                <Pressable style={styles.smallButton} disabled={busy} onPress={() => void downloadBackup(item)}>
                  <Text style={styles.smallText}>Descargar</Text>
                </Pressable>
                {isAdmin && item.type !== "app" && (
                  <Pressable style={styles.smallButton} disabled={busy} onPress={() => restoreServerBackup(item)}>
                    <Text style={styles.smallText}>Restaurar</Text>
                  </Pressable>
                )}
                <Pressable style={styles.deleteButton} disabled={busy} onPress={() => deleteBackup(item)}>
                  <Text style={styles.deleteText}>Eliminar</Text>
                </Pressable>
              </View>
            </View>
          ))}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Restaurar desde archivo local</Text>
            {isAdmin ? (
              <>
                <Text style={styles.hint}>Selecciona un ZIP de backup de datos o de aplicación compatible. Se validará antes de aplicar y se generará automáticamente un backup de seguridad.</Text>
                <Pressable style={[styles.dangerButton, busy && styles.disabled]} disabled={busy} onPress={() => void restoreLocalBackup()}>
                  <Text style={styles.dangerText}>Validar y restaurar archivo</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.hint}>Solo un Administrador puede restaurar desde archivo local.</Text>
            )}
          </View>
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
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.border },
  backupCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.onSurfaceSecondary },
  hint: { fontSize: 13, lineHeight: 19, color: colors.muted },
  info: { fontSize: 14, color: colors.onSurfaceSecondary },
  name: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  meta: { fontSize: 12, color: colors.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "700" },
  secondaryButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  secondaryText: { color: colors.onSurface, fontWeight: "700" },
  smallButton: { borderRadius: 10, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 9 },
  smallText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 12 },
  deleteButton: { borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.error, paddingHorizontal: 12, paddingVertical: 9 },
  deleteText: { color: colors.error, fontWeight: "700", fontSize: 12 },
  dangerButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  dangerText: { color: colors.onError, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  empty: { padding: 20, alignItems: "center" },
  error: { color: colors.error, fontWeight: "600", lineHeight: 19 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
}));
