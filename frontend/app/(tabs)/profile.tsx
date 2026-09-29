// Profile screen: current user, role, assigned boat and versions. Logout
// clears the local session (token + metadata) without touching pending data.

import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { APP_VERSION, API_VERSION } from "@/src/config";
import { useBoats } from "@/src/hooks/useInventory";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles } from "@/src/theme";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  inspector: "Inspector",
  chief_engineer: "Jefe de máquinas",
  mechanic: "Mecánico",
};

export default function ProfileScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const { user, signOut } = useSession();
  const { data: boats = [] } = useBoats();

  const boatName = useMemo(() => {
    if (!user) return "—";
    if (user.boat_id == null) return "Sin asignar";
    const b = boats.find((x) => x.id === user.boat_id);
    return b?.name ?? `ID ${user.boat_id}`;
  }, [boats, user]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Perfil</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Row label="Usuario" value={user?.username ?? "—"} />
          <Row label="Rol" value={user ? ROLE_LABELS[user.role] ?? user.role : "—"} />
          <Row label="Barco" value={boatName} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Versiones</Text>
          <Row label="Aplicación" value={APP_VERSION} />
          <Row label="API" value={API_VERSION} />
        </View>

        <Pressable style={styles.logout} onPress={signOut} testID="logout-button">
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </View>
  );

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
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
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.onSurface,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.onSurfaceSecondary,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 14,
    color: colors.muted,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
  },
  logout: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  logoutText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: "700",
  },
}));
