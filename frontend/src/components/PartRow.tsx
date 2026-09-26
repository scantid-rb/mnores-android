// Compact inventory list row: name + reference, category · location, and a
// quantity badge. A small "Foto" tag flags parts with an attached photo.

import React from "react";
import { Pressable, Text, View } from "react-native";

import { makeStyles } from "@/src/theme";
import { Part } from "@/src/types";

export function PartRow({
  part,
  categoryName,
  onPress,
}: {
  part: Part;
  categoryName: string;
  onPress: () => void;
}) {
  const styles = useStyles();

  const meta = [categoryName, part.location].filter(Boolean).join("  ·  ");

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      testID={`part-row-${part.id}`}
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
      </View>

      <View style={styles.right}>
        <View style={styles.qtyBadge}>
          <Text style={styles.qtyValue}>{part.quantity}</Text>
          <Text style={styles.qtyLabel}>uds</Text>
        </View>
        {!!part.photo_path && (
          <Text style={styles.photoTag} testID={`part-photo-${part.id}`}>
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSecondary,
  },
  left: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.onSurface,
  },
  reference: {
    fontSize: 13,
    color: colors.onSurfaceTertiary,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
  },
  right: {
    alignItems: "flex-end",
    gap: 4,
  },
  qtyBadge: {
    minWidth: 52,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
  },
  qtyValue: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.onBrandTertiary,
  },
  qtyLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.onBrandTertiary,
  },
  photoTag: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.info,
  },
}));
