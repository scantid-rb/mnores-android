import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/src/components/StatusBadge";
import { apiGetAudit } from "@/src/services/api/endpoints";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles, useTheme } from "@/src/theme";
import { AuditEntry } from "@/src/types";

const operationLabels: Record<string, string> = {
  "part.create": "Crear repuesto", "part.update": "Modificar repuesto", "part.delete": "Eliminar repuesto",
  "part.photo": "Foto de repuesto", "boat.create": "Crear barco", "boat.update": "Modificar barco",
  "boat.toggle": "Cambiar estado de barco", "boat.delete": "Eliminar barco", "user.create": "Crear usuario",
  "user.update": "Modificar usuario", "user.toggle": "Cambiar estado de usuario", "user.delete": "Eliminar usuario",
  "category.create": "Crear categoría", "category.rename": "Renombrar categoría", "category.delete": "Eliminar categoría",
};
const objectLabels: Record<string, string> = { part: "Repuesto", boat: "Barco", user: "Usuario", category: "Categoría" };

function operationLabel(value: string) { return operationLabels[value] ?? value; }
function objectLabel(value: string) { return objectLabels[value] ?? value; }
function valueText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function changedFields(entry: AuditEntry) {
  const oldData = entry.old_data ?? {};
  const newData = entry.new_data ?? {};
  return Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]))
    .filter((key) => JSON.stringify(oldData[key]) !== JSON.stringify(newData[key]));
}

export default function AuditAdminScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useSession();
  const { online } = useConnectivity();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const [objectTypes, setObjectTypes] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [operation, setOperation] = useState("");
  const [objectType, setObjectType] = useState("");
  const [actorUsername, setActorUsername] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const allowed = user?.role === "admin" || user?.role === "inspector";

  const load = async (targetPage: number, filters = { operation, objectType, actorUsername }) => {
    if (!token || !online) return;
    setLoading(true); setError(null);
    try {
      const response = await apiGetAudit(token, {
        page: targetPage, operation: filters.operation, object_type: filters.objectType,
        actor_username: filters.actorUsername,
      });
      setRows(response.rows); setOperations(response.operations); setObjectTypes(response.object_types);
      setActors(response.actors); setPage(response.page); setPages(response.pages); setTotal(response.total);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la auditoría.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!allowed) { router.replace("/inventory"); return; }
    if (!online) return;
    const timer = setTimeout(() => {
      void load(1);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, online, token, router]);

  const filterChips = useMemo(() => ({
    operations: ["", ...operations], objectTypes: ["", ...objectTypes], actors: ["", ...actors],
  }), [operations, objectTypes, actors]);

  const resetFilters = () => {
    const empty = { operation: "", objectType: "", actorUsername: "" };
    setOperation(""); setObjectType(""); setActorUsername("");
    void load(1, empty);
  };

  if (!allowed) return null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Volver</Text></Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Auditoría</Text>
          <Text style={styles.subtitle}>Todas las operaciones registradas</Text>
        </View>
        <StatusBadge online={online} syncing={loading} />
      </View>

      {!online ? (
        <View style={styles.offlineBox}>
          <Text style={styles.offlineTitle}>Sin conexión</Text>
          <Text style={styles.offlineText}>La auditoría se consulta directamente en el servidor y requiere conexión a Internet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.filtersCard}>
            <Text style={styles.sectionTitle}>Filtros</Text>
            <Text style={styles.filterLabel}>Operación</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {filterChips.operations.map((value) => (
                <Pressable key={value || "all-operation"} style={[styles.chip, operation === value && styles.chipSelected]}
                  onPress={() => setOperation(value)} disabled={loading}>
                  <Text style={[styles.chipText, operation === value && styles.chipTextSelected]}>
                    {value ? operationLabel(value) : "Todas"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.filterLabel}>Objeto</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {filterChips.objectTypes.map((value) => (
                <Pressable key={value || "all-object"} style={[styles.chip, objectType === value && styles.chipSelected]}
                  onPress={() => setObjectType(value)} disabled={loading}>
                  <Text style={[styles.chipText, objectType === value && styles.chipTextSelected]}>
                    {value ? objectLabel(value) : "Todos"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.filterLabel}>Usuario</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {filterChips.actors.map((value) => (
                <Pressable key={value || "all-actor"} style={[styles.chip, actorUsername === value && styles.chipSelected]}
                  onPress={() => setActorUsername(value)} disabled={loading}>
                  <Text style={[styles.chipText, actorUsername === value && styles.chipTextSelected]}>
                    {value || "Todos"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.filterActions}>
              <Pressable style={styles.secondaryButton} onPress={resetFilters} disabled={loading}>
                <Text style={styles.secondaryButtonText}>Limpiar</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={() => void load(1)} disabled={loading}>
                <Text style={styles.primaryButtonText}>Aplicar filtros</Text>
              </Pressable>
            </View>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.listHeader}><Text style={styles.sectionTitle}>Registros</Text><Text style={styles.count}>{total}</Text></View>

          {loading && rows.length === 0 && <ActivityIndicator size="small" color={colors.brandPrimary} />}

          {rows.map((entry) => (
            <Pressable key={entry.id} style={[styles.auditCard, selected?.id === entry.id && styles.auditCardSelected]}
              onPress={() => setSelected(entry)}>
              <View style={styles.auditTop}>
                <Text style={styles.operation}>{operationLabel(entry.operation)}</Text>
                <Text style={styles.date}>{dateText(entry.at_utc)}</Text>
              </View>
              <Text style={styles.actor}>{entry.actor_username || "Usuario desconocido"}</Text>
              <Text style={styles.object}>
                {objectLabel(entry.object_type)}{entry.object_id != null ? " #" + entry.object_id : ""}{entry.boat_name ? " · " + entry.boat_name : ""}
              </Text>
            </Pressable>
          ))}

          {!loading && rows.length === 0 && <Text style={styles.empty}>No hay registros para los filtros seleccionados.</Text>}

          {selected && (
            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.sectionTitle}>Detalle</Text>
                <Pressable onPress={() => setSelected(null)}><Text style={styles.cancel}>Cerrar</Text></Pressable>
              </View>
              <Text style={styles.detailLabel}>Fecha</Text><Text style={styles.detailValue}>{dateText(selected.at_utc)}</Text>
              <Text style={styles.detailLabel}>Usuario</Text><Text style={styles.detailValue}>{selected.actor_username || "—"}</Text>
              <Text style={styles.detailLabel}>Operación</Text><Text style={styles.detailValue}>{operationLabel(selected.operation)}</Text>
              <Text style={styles.detailLabel}>Objeto</Text>
              <Text style={styles.detailValue}>{objectLabel(selected.object_type)}{selected.object_id != null ? " #" + selected.object_id : ""}</Text>
              <Text style={styles.detailLabel}>Barco</Text>
              <Text style={styles.detailValue}>{selected.boat_name || (selected.boat_id != null ? "ID " + selected.boat_id : "—")}</Text>
              <Text style={styles.detailSection}>Cambios</Text>
              {changedFields(selected).length > 0 ? changedFields(selected).map((field) => (
                <View key={field} style={styles.changeRow}>
                  <Text style={styles.changeField}>{field}</Text>
                  <Text style={styles.changeOld}>Anterior: {valueText(selected.old_data?.[field])}</Text>
                  <Text style={styles.changeNew}>Nuevo: {valueText(selected.new_data?.[field])}</Text>
                </View>
              )) : <Text style={styles.emptyChange}>Sin datos de cambio registrados.</Text>}
            </View>
          )}

          {pages > 1 && (
            <View style={styles.pagination}>
              <Pressable style={[styles.pageButton, page <= 1 && styles.disabledButton]} onPress={() => void load(page - 1)}
                disabled={page <= 1 || loading}><Text style={styles.pageButtonText}>‹</Text></Pressable>
              <Text style={styles.pageText}>Página {page} de {pages}</Text>
              <Pressable style={[styles.pageButton, page >= pages && styles.disabledButton]} onPress={() => void load(page + 1)}
                disabled={page >= pages || loading}><Text style={styles.pageButtonText}>›</Text></Pressable>
            </View>
          )}

          <Text style={styles.footerNote}>Se muestran todas las operaciones registradas en el servidor. Esta pantalla es de consulta.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: "row", alignItems: "center" },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  back: { fontSize: 15, fontWeight: "700", color: colors.brandPrimary },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  subtitle: { marginTop: 2, fontSize: 12, color: colors.muted },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  offlineBox: { margin: 16, backgroundColor: colors.brandTertiary, borderRadius: 14, padding: 14, gap: 4 },
  offlineTitle: { fontSize: 14, fontWeight: "800", color: colors.onBrandTertiary },
  offlineText: { fontSize: 13, lineHeight: 18, color: colors.onBrandTertiary },
  filtersCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 9, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  filterLabel: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary, marginTop: 3 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceTertiary },
  chipSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  chipTextSelected: { color: colors.onBrandPrimary },
  filterActions: { flexDirection: "row", gap: 8, marginTop: 3 },
  primaryButton: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  primaryButtonText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "800" },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 11, alignItems: "center", backgroundColor: colors.surfaceTertiary },
  secondaryButtonText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  disabledButton: { opacity: 0.45 },
  error: { color: colors.error, fontSize: 13 },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { fontSize: 13, fontWeight: "700", color: colors.muted },
  auditCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 4 },
  auditCardSelected: { borderColor: colors.brandPrimary },
  auditTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  operation: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.onSurface },
  date: { fontSize: 11, color: colors.muted },
  actor: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  object: { fontSize: 12, color: colors.onSurfaceSecondary },
  detailCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.brandPrimary, gap: 6 },
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  cancel: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  detailLabel: { fontSize: 11, fontWeight: "700", color: colors.muted, marginTop: 4 },
  detailValue: { fontSize: 14, color: colors.onSurface },
  detailSection: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginTop: 10, marginBottom: 2 },
  changeRow: { backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 10, gap: 3 },
  changeField: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  changeOld: { fontSize: 12, color: colors.muted },
  changeNew: { fontSize: 12, color: colors.onSurfaceSecondary },
  emptyChange: { fontSize: 12, color: colors.muted },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingVertical: 6 },
  pageButton: { width: 42, height: 38, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  pageButtonText: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  pageText: { fontSize: 13, fontWeight: "700", color: colors.onSurfaceSecondary },
  empty: { paddingVertical: 20, textAlign: "center", color: colors.muted },
  footerNote: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.muted },
}));
