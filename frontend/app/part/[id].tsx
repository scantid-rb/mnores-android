// Part detail (read-only in Phase 1). Reads from the local cache so it works
// offline. Edit actions per role arrive in later phases.

import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCategories, usePart } from "@/src/hooks/useInventory";
import { makeStyles, useTheme } from "@/src/theme";

export default function PartDetailScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { id } = useLocalSearchParams<{ id: string }>();
  const partId = Number(id);
  const { data: part, isLoading } = usePart(partId);
  const { data: categories = [] } = useCategories();

  const categoryName =
    part?.category_id != null
      ? categories.find((c) => c.id === part.category_id)?.name ?? "—"
      : "—";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="detail-back-button">
          <Text style={styles.back}>‹ Volver</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {isLoading ? (
          <Text style={styles.muted}>Cargando…</Text>
        ) : !part ? (
          <Text style={styles.muted} testID="detail-not-found">
            Repuesto no encontrado en la cache local.
          </Text>
        ) : (
          <>
            <Text style={styles.name} testID="detail-name">
              {part.name}
            </Text>

            <View style={styles.qtyBlock}>
              <Text style={styles.qtyValue}>{part.quantity}</Text>
              <Text style={styles.qtyLabel}>unidades</Text>
            </View>

            <View style={styles.card}>
              <Field label="Referencia" value={part.reference || "—"} />
              <Field label="Categoría" value={categoryName} />
              <Field label="Ubicación" value={part.location || "—"} />
              <Field label="Notas" value={part.notes || "—"} />
            </View>

            <View style={styles.card}>
              <Field label="Foto" value={part.photo_path ? "Adjunta" : "Sin foto"} />
              <Field
                label="Actualizado"
                value={part.updated_at ? new Date(part.updated_at).toLocaleString() : "—"}
              />
              <Field label="Estado" value="Sincronizado" valueColor={colors.success} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );

  function Field({
    label,
    value,
    valueColor,
  }: {
    label: string;
    value: string;
    valueColor?: string;
  }) {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={[styles.fieldValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.brandPrimary,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  name: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.onSurface,
  },
  qtyBlock: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  qtyValue: {
    fontSize: 40,
    fontWeight: "800",
    color: colors.brandPrimary,
  },
  qtyLabel: {
    fontSize: 16,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
  },
  fieldValue: {
    fontSize: 16,
    color: colors.onSurface,
  },
  muted: {
    fontSize: 15,
    color: colors.muted,
  },
}));
