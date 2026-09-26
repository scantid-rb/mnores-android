// Compact inventory list row: name + reference, category · location, a
// quantity block and a sync-state indicator. Optional inline +/- quantity for
// users allowed to change quantity.

import React from "react";
import { Pressable, Text, View } from "react-native";

import { makeStyles, useTheme } from "@/src/theme";
import { LocalPart, SyncState } from "@/src/types";

const SYNC_LABEL: Record<SyncState, string | null> = {
  synced: null,
  pending: "Pendiente",
  syncing: "Sincronizando",
  error: "Error",
  conflict: "Conflicto",
};

export function PartRow({
  part,
  categoryName,
  onPress,
  onDec,
  onInc,
  canChangeQty,
}: {
  part: LocalPart;
  categoryName: string;
  onPress: () => void;
  onDec?: () => void;
  onInc?: () => void;
  canChangeQty: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  const meta = [categoryName, part.location].filter(Boolean).join("  ·  ");
  const syncLabel = SYNC_LABEL[part.sync_state];
  const syncColor =
    part.sync_state === "error" || part.sync_state === "conflict"
      ? colors.error
      : part.sync_state === "synced"
        ? colors.success
        : colors.warning;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      testID={`part-row-${part.row_uid}`}
    >
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>
          {part.name}
        </Text>
        {!!part.reference && (
          <Text style={styles.reference} numberOfLines={1}>
            Ref: {part.reference}
          </Text>
        )}
        {!!meta && (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        )}
        {!!syncLabel && (
          <View style={styles.syncRow}>
            <View style={[styles.syncDot, { backgroundColor: syncColor }]} />
            <Text style={[styles.syncText, { color: syncColor }]} testID={`part-sync-${part.row_uid}`}>
              {syncLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.right}>
        {canChangeQty ? (
          <View style={styles.qtyControls}>
            <Pressable
              style={styles.qtyBtn}
              onPress={onDec}
              hitSlop={8}
              testID={`part-dec-${part.row_uid}`}
            >
              <Text style={styles.qtyBtnText}>−</Text>
            </Pressable>
            <Text style={styles.qtyNum} testID={`part-qty-${part.row_uid}`}>
              {part.quantity}
            </Text>
            <Pressable
              style={styles.qtyBtn}
              onPress={onInc}
              hitSlop={8}
              testID={`part-inc-${part.row_uid}`}
            >
              <Text style={styles.qtyBtnText}>+</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.qtyBadge}>
            <Text style={styles.qtyValue}>{part.quantity}</Text>
            <Text style={styles.qtyLabel}>uds</Text>
          </View>
        )}
        {!!part.photo_path && (
          <Text style={styles.photoTag} testID={`part-photo-${part.row_uid}`}>
            Foto
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  rowPressed: { backgroundColor: colors.surfaceSecondary },
  left: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  reference: { fontSize: 13, color: colors.onSurfaceTertiary },
  meta: { fontSize: 13, color: colors.muted },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  syncDot: { width: 7, height: 7, borderRadius: 4 },
  syncText: { fontSize: 12, fontWeight: "600" },
  right: { alignItems: "flex-end", gap: 4 },
  qtyControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandTertiary,
  },
  qtyBtnText: { fontSize: 20, fontWeight: "800", color: colors.onBrandTertiary, lineHeight: 22 },
  qtyNum: { fontSize: 18, fontWeight: "800", color: colors.onSurface, minWidth: 28, textAlign: "center" },
  qtyBadge: {
    minWidth: 52,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
  },
  qtyValue: { fontSize: 18, fontWeight: "800", color: colors.onBrandTertiary },
  qtyLabel: { fontSize: 10, fontWeight: "600", color: colors.onBrandTertiary },
  photoTag: { fontSize: 10, fontWeight: "700", color: colors.info },
}));
