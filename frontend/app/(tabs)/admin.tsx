import { Text, View, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/src/components/StatusBadge";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles } from "@/src/theme";

const MODULES = [
  {
    title: "Barcos",
    description: "Alta, edición, activación y gestión de barcos.",
  },
  {
    title: "Usuarios",
    description: "Gestión de administradores, inspectores, jefes de máquinas y mecánicos.",
  },
  {
    title: "Categorías",
    description: "Gestión de las categorías globales del inventario.",
  },
  {
    title: "Auditoría",
    description: "Consulta de todas las operaciones registradas en el sistema.",
  },
  {
    title: "Servidor",
    description: "Comprobar o cambiar el servidor al que se conecta esta aplicación.",
  },
];

export default function AdministrationScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { online } = useConnectivity();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Administración</Text>
          <Text style={styles.subtitle}>
            {user?.role === "admin" ? "Administrador" : "Inspector"}
          </Text>
        </View>
        <StatusBadge online={online} syncing={false} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Área administrativa</Text>
          <Text style={styles.noticeText}>
            Los datos administrativos se mantienen disponibles en caché para consulta
            sin conexión. Las modificaciones requieren conexión a Internet.
          </Text>
        </View>

        {MODULES.map((module) => {
          const enabled = true;
          return (
            <Pressable
              key={module.title}
              style={[styles.card, !enabled && styles.cardDisabled]}
              disabled={!enabled}
              onPress={() => {
                if (module.title === "Barcos") router.push("/admin/boats");
                if (module.title === "Usuarios") router.push("/admin/users");
                if (module.title === "Categorías") router.push("/admin/categories");
                if (module.title === "Auditoría") router.push("/admin/audit");
                if (module.title === "Servidor") router.push("/server-settings");
              }}
            >
              <Text style={styles.cardTitle}>{module.title}</Text>
              <Text style={styles.cardText}>{module.description}</Text>
              <Text style={styles.status}>
                {enabled ? "Abrir gestión →" : "Gestión en la siguiente fase"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  subtitle: { marginTop: 3, fontSize: 13, color: colors.muted },
  content: { padding: 16, gap: 12 },
  notice: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  noticeTitle: { fontSize: 16, fontWeight: "800", color: colors.onBrandTertiary },
  noticeText: { fontSize: 14, lineHeight: 20, color: colors.onBrandTertiary },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDisabled: { opacity: 0.65 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  cardText: { fontSize: 14, lineHeight: 19, color: colors.onSurfaceSecondary },
  status: { fontSize: 12, fontWeight: "700", color: colors.muted },
}));
