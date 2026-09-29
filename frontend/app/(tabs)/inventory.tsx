// Inventory reads the local cache. In read-only mode all mutation controls
// and synchronization are disabled; browsing and photo viewing remain available.

import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PartRow } from "@/src/components/PartRow";
import { StatusBadge } from "@/src/components/StatusBadge";
import { useBoats, useCategories, useParts } from "@/src/hooks/useInventory";
import { useUpdatePart } from "@/src/hooks/usePartMutations";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { useSync } from "@/src/state/SyncContext";
import { makeStyles, useTheme } from "@/src/theme";
import { canCreatePart, canEditQuantity } from "@/src/utils/permissions";

export default function InventoryScreen() {
  const styles = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { user, mode, exitReadonly } = useSession(); const readonly = mode === "readonly";
  const { online } = useConnectivity(); const { status, pendingCount, syncNow } = useSync(); const updatePart = useUpdatePart();
  const [query, setQuery] = useState(""); const [categoryId, setCategoryId] = useState<number | null>(null); const [boatId, setBoatId] = useState<number | null>(null);
  const isGlobalInventoryRole = user?.role === "admin" || user?.role === "inspector";
  const { data: boats = [] } = useBoats(); const effectiveBoatId = isGlobalInventoryRole ? boatId : user?.boat_id ?? null;
  const { data: parts = [], isLoading } = useParts(query, categoryId, effectiveBoatId); const { data: categories = [] } = useCategories();
  const categoryName = useMemo(() => { const map = new Map<number, string>(); categories.forEach((c) => map.set(c.id, c.name)); return map; }, [categories]);
  const canQty = !readonly && canEditQuantity(user?.role); const canCreate = !readonly && canCreatePart(user?.role); const syncing = status === "syncing";
  const changeQty = (rowUid: string, current: number, delta: number) => { if (readonly) return; const next = Math.max(0, current + delta); if (next === current) return; updatePart.mutate({ rowUid, fields: { quantity: next } }); };

  return <View style={[styles.screen, { paddingTop: insets.top }]}> 
    <View style={styles.header}>
      <View style={styles.titleRow}><Text style={styles.title}>{readonly ? "Inventario · Solo lectura" : "Inventario"}</Text>{readonly ? <Pressable onPress={exitReadonly} hitSlop={10} testID="readonly-exit-button"><Text style={styles.exit}>Salir</Text></Pressable> : <StatusBadge online={online} syncing={syncing} />}</View>
      {readonly && <Text style={styles.readonlyBanner}>Consulta local · sin cambios ni sincronización</Text>}
      {!readonly && pendingCount > 0 && <Text style={styles.pending} testID="pending-banner">{pendingCount} cambio(s) pendiente(s) de sincronizar</Text>}
      {isGlobalInventoryRole && <View style={styles.boatSelector}><Text style={styles.filterLabel}>Barco</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}><Chip label="Todos los barcos" active={boatId === null} onPress={() => setBoatId(null)} testID="chip-boat-all" />{boats.filter((b) => b.is_active).map((b) => <Chip key={b.id} label={b.name} active={boatId === b.id} onPress={() => setBoatId(b.id)} testID={`chip-boat-${b.id}`} />)}</ScrollView></View>}
      <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="Buscar por nombre, referencia o ubicación" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} testID="inventory-search-input" />
      <View style={styles.chipsWrapper}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}><Chip label="Todas" active={categoryId === null} onPress={() => setCategoryId(null)} testID="chip-all" />{categories.map((c) => <Chip key={c.id} label={c.name} active={categoryId === c.id} onPress={() => setCategoryId(c.id)} testID={`chip-${c.id}`} />)}</ScrollView></View>
    </View>
    <FlatList data={parts} keyExtractor={(item) => item.row_uid} renderItem={({ item }) => <PartRow part={item} categoryName={item.category_id != null ? categoryName.get(item.category_id) ?? "" : ""} onPress={() => router.push(`/part/${item.row_uid}`)} canChangeQty={canQty} onDec={() => changeQty(item.row_uid, item.quantity, -1)} onInc={() => changeQty(item.row_uid, item.quantity, +1)} />} contentContainerStyle={parts.length === 0 ? styles.emptyContainer : { paddingBottom: 96 }} refreshControl={readonly ? undefined : <RefreshControl refreshing={syncing} onRefresh={() => syncNow()} tintColor={colors.brandPrimary} />} ListEmptyComponent={<View style={styles.empty} testID="inventory-empty"><Text style={styles.emptyTitle}>{isLoading ? "Cargando…" : "Sin repuestos"}</Text>{!isLoading && <Text style={styles.emptyText}>{query || categoryId !== null || boatId !== null ? "No hay resultados para el filtro actual." : readonly ? "No hay repuestos en la cache local." : online ? "Desliza hacia abajo para sincronizar." : "Conéctate para sincronizar el inventario."}</Text>}</View>} testID="inventory-list" />
    {canCreate && <Pressable style={[styles.fab, { bottom: 16 }]} onPress={() => router.push("/part-edit?mode=create")} testID="create-part-fab"><Text style={styles.fabText}>+ Añadir</Text></Pressable>}
  </View>;
}

function Chip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) { const styles = useStyles(); return <Text onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipInactive]} testID={testID}>{label}</Text>; }

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface }, header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { fontSize: 24, fontWeight: "800", color: colors.onSurface }, exit: { fontSize: 15, fontWeight: "700", color: colors.brandPrimary }, readonlyBanner: { fontSize: 13, fontWeight: "600", color: colors.muted }, pending: { fontSize: 13, fontWeight: "600", color: colors.warning }, search: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.onSurface }, boatSelector: { gap: 6 }, filterLabel: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary }, chipsWrapper: { height: 44 }, chipsRow: { gap: 8, paddingRight: 8, alignItems: "center" }, chip: { flexShrink: 0, height: 36, lineHeight: 34, paddingHorizontal: 14, borderRadius: 999, fontSize: 13, fontWeight: "600", overflow: "hidden", borderWidth: 1 }, chipActive: { backgroundColor: colors.brandPrimary, color: colors.onBrandPrimary, borderColor: colors.brandPrimary }, chipInactive: { backgroundColor: colors.surfaceTertiary, color: colors.onSurfaceTertiary, borderColor: colors.border }, emptyContainer: { flexGrow: 1 }, empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 8 }, emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface }, emptyText: { fontSize: 14, color: colors.muted, textAlign: "center" }, fab: { position: "absolute", right: 16, backgroundColor: colors.brandPrimary, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 999, elevation: 4 }, fabText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
}));
