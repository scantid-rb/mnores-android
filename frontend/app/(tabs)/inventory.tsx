// Inventory screen: sticky header (title + status + search + category chips)
// over a FlatList that reads from the LOCAL cache. Works offline; search runs
// against SQLite. Pull-to-refresh triggers /api/sync when online.

import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PartRow } from "@/src/components/PartRow";
import { StatusBadge } from "@/src/components/StatusBadge";
import { useCategories, useParts } from "@/src/hooks/useInventory";
import { useInitialSync } from "@/src/hooks/useSync";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { makeStyles, useTheme } from "@/src/theme";

export default function InventoryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const { online } = useConnectivity();
  const sync = useInitialSync();
  const { data: parts = [], isLoading: partsLoading } = useParts(query, categoryId);
  const { data: categories = [] } = useCategories();

  const categoryName = useMemo(() => {
    const map = new Map<number, string>();
    categories.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Sticky header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Inventario</Text>
          <StatusBadge online={online} syncing={sync.isFetching} />
        </View>

        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por nombre, referencia o ubicación"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="inventory-search-input"
        />

        <View style={styles.chipsWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            <Chip
              label="Todas"
              active={categoryId === null}
              onPress={() => setCategoryId(null)}
              testID="chip-all"
            />
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                active={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
                testID={`chip-${c.id}`}
              />
            ))}
          </ScrollView>
        </View>
      </View>

      <FlatList
        data={parts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <PartRow
            part={item}
            categoryName={item.category_id != null ? categoryName.get(item.category_id) ?? "" : ""}
            onPress={() => router.push(`/part/${item.id}`)}
          />
        )}
        contentContainerStyle={parts.length === 0 ? styles.emptyContainer : { paddingBottom: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={sync.isFetching}
            onRefresh={() => sync.refetch()}
            tintColor={colors.brandPrimary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty} testID="inventory-empty">
            <Text style={styles.emptyTitle}>
              {partsLoading ? "Cargando…" : "Sin repuestos"}
            </Text>
            {!partsLoading && (
              <Text style={styles.emptyText}>
                {query || categoryId !== null
                  ? "No hay resultados para el filtro actual."
                  : online
                    ? "Desliza hacia abajo para sincronizar."
                    : "Conéctate para sincronizar el inventario."}
              </Text>
            )}
          </View>
        }
        testID="inventory-list"
      />
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles();
  return (
    <Text
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
      testID={testID}
    >
      {label}
    </Text>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.onSurface,
  },
  search: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.onSurface,
  },
  chipsWrapper: {
    height: 44,
  },
  chipsRow: {
    gap: 8,
    paddingRight: 8,
    alignItems: "center",
  },
  chip: {
    flexShrink: 0,
    height: 36,
    lineHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    fontSize: 13,
    fontWeight: "600",
    overflow: "hidden",
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: colors.brandPrimary,
    color: colors.onBrandPrimary,
    borderColor: colors.brandPrimary,
  },
  chipInactive: {
    backgroundColor: colors.surfaceTertiary,
    color: colors.onSurfaceTertiary,
    borderColor: colors.border,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.onSurface,
  },
  emptyText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
  },
}));
