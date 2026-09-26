// Compact connectivity/sync status pill. Text + colored dot, no icon font.

import React from "react";
import { Text, View } from "react-native";

import { makeStyles, useTheme } from "@/src/theme";

type Status = "online" | "offline" | "syncing";

export function StatusBadge({
  online,
  syncing,
}: {
  online: boolean;
  syncing?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  const status: Status = syncing ? "syncing" : online ? "online" : "offline";
  const label = status === "syncing" ? "Sincronizando" : status === "online" ? "Online" : "Offline";
  const dotColor =
    status === "syncing" ? colors.warning : status === "online" ? colors.success : colors.muted;

  return (
    <View style={styles.badge} testID="status-badge">
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.label} testID="status-badge-label">
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceTertiary,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
  },
}));
