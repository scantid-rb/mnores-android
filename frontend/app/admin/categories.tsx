import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBadge } from "@/src/components/StatusBadge";
import { useCategories } from "@/src/hooks/useInventory";
import { apiCreateCategory, apiDeleteCategory, apiRenameCategory } from "@/src/services/api/endpoints";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { useSync } from "@/src/state/SyncContext";
import { makeStyles, useTheme } from "@/src/theme";
import { Category } from "@/src/types";

export default function CategoriesAdminScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useSession();
  const { online } = useConnectivity();
  const { syncNow } = useSync();
  const { data: categories = [], isLoading } = useCategories();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = user?.role === "admin" || user?.role === "inspector";

  const resetForm = () => { setEditingId(null); setName(""); setError(null); };
  const editCategory = (category: Category) => {
    if (category.is_system === 1) return;
    setEditingId(category.id); setName(category.name); setError(null);
  };

  const save = async () => {
    if (!token || !online || saving) return;
    const cleanName = name.trim();
    if (!cleanName) { setError("El nombre de la categoría es obligatorio."); return; }
    setSaving(true); setError(null);
    try {
      if (editingId == null) await apiCreateCategory(token, cleanName);
      else await apiRenameCategory(token, editingId, cleanName);
      await syncNow();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la categoría.");
    } finally { setSaving(false); }
  };

  const remove = (category: Category) => {
    if (!token || !online || saving || category.is_system === 1) return;
    Alert.alert(
      "Eliminar categoría",
      `¿Quieres eliminar «${category.name}»? Los repuestos que la utilicen pasarán a «Sin categoría».`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: async () => {
          setSaving(true); setError(null);
          try {
            await apiDeleteCategory(token, category.id);
            if (editingId === category.id) resetForm();
            await syncNow();
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo eliminar la categoría.");
          } finally { setSaving(false); }
        }},
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Volver</Text></Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Categorías</Text>
          <Text style={styles.subtitle}>{canManage ? "Gestión administrativa" : "Consulta de categorías"}</Text>
        </View>
        <StatusBadge online={online} syncing={saving} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!online && <View style={styles.offlineNotice}>
          <Text style={styles.offlineTitle}>Sin conexión</Text>
          <Text style={styles.offlineText}>Las categorías siguen disponibles desde la caché para consulta. Las modificaciones requieren Internet.</Text>
        </View>}

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Categoría del sistema</Text>
          <Text style={styles.infoText}>«Sin categoría» es la categoría predeterminada del sistema y no se puede renombrar ni eliminar.</Text>
        </View>

        {canManage && <View style={styles.formCard}>
          <View style={styles.formHeader}>
            <Text style={styles.sectionTitle}>{editingId == null ? "Nueva categoría" : "Renombrar categoría"}</Text>
            {editingId != null && <Pressable onPress={resetForm} disabled={saving}><Text style={styles.cancel}>Cancelar</Text></Pressable>}
          </View>
          <Text style={styles.label}>Nombre *</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nombre de categoría" placeholderTextColor={colors.muted} editable={online && !saving} maxLength={80} />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.primaryButton, (!online || saving) && styles.disabledButton]} onPress={save} disabled={!online || saving}>
            <Text style={styles.primaryButtonText}>{saving ? "Guardando…" : editingId == null ? "Crear categoría" : "Guardar nombre"}</Text>
          </Pressable>
        </View>}

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Categorías registradas</Text>
          <Text style={styles.count}>{isLoading ? "…" : String(categories.length)}</Text>
        </View>

        {categories.map((category) => {
          const system = category.is_system === 1;
          return <View key={category.id} style={styles.categoryCard}>
            <Pressable
              style={styles.categoryInfo}
              onPress={() => router.replace({ pathname: "/inventory", params: { categoryId: String(category.id) } })}
              testID={`category-open-${category.id}`}
            >
              <Text style={styles.categoryName}>{category.name}</Text>
              <Text style={[styles.categoryState, system ? styles.systemText : styles.normalText]}>
                {system ? "Categoría del sistema · Ver repuestos →" : canManage ? "Categoría editable · Ver repuestos →" : "Ver repuestos →"}
              </Text>
            </Pressable>
            {!system && canManage && <View style={styles.actions}>
              <Pressable style={styles.secondaryButton} onPress={() => editCategory(category)} disabled={saving}><Text style={styles.secondaryButtonText}>Renombrar</Text></Pressable>
              <Pressable style={[styles.deleteButton, !online && styles.disabledButton]} onPress={() => remove(category)} disabled={!online || saving}><Text style={styles.deleteButtonText}>Eliminar</Text></Pressable>
            </View>}
          </View>;
        })}

        {!isLoading && categories.length === 0 && <Text style={styles.empty}>No hay categorías en la caché local.</Text>}
        <Text style={styles.footerNote}>
          {canManage
            ? "Pulsa una categoría para ver sus repuestos. Las altas, renombrados y eliminaciones se realizan siempre contra el servidor."
            : "Pulsa una categoría para abrir el inventario filtrado por esa categoría."}
        </Text>
      </ScrollView>
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
  offlineNotice: { backgroundColor: colors.brandTertiary, borderRadius: 14, padding: 14, gap: 4 },
  offlineTitle: { fontSize: 14, fontWeight: "800", color: colors.onBrandTertiary },
  offlineText: { fontSize: 13, lineHeight: 18, color: colors.onBrandTertiary },
  infoCard: { backgroundColor: colors.surfaceTertiary, borderRadius: 14, padding: 14, gap: 4 },
  infoTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  infoText: { fontSize: 13, lineHeight: 18, color: colors.onSurfaceSecondary },
  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 9, borderWidth: 1, borderColor: colors.border },
  formHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  cancel: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.onSurface },
  error: { color: colors.error, fontSize: 13, marginTop: 2 },
  primaryButton: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  listHeader: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { fontSize: 13, fontWeight: "700", color: colors.muted },
  categoryCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 15, borderWidth: 1, borderColor: colors.border, gap: 12 },
  categoryInfo: { gap: 3 },
  categoryName: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  categoryState: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  systemText: { color: colors.brandPrimary },
  normalText: { color: colors.onSurfaceSecondary },
  actions: { flexDirection: "row", gap: 8 },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surfaceTertiary },
  secondaryButtonText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  deleteButton: { flex: 1, borderWidth: 1, borderColor: colors.error, borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surfaceTertiary },
  deleteButtonText: { fontSize: 13, fontWeight: "700", color: colors.error },
  empty: { paddingVertical: 20, textAlign: "center", color: colors.muted },
  footerNote: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.muted },
}));
