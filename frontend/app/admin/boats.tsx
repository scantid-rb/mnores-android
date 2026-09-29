import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/src/components/StatusBadge";
import { useBoats } from "@/src/hooks/useInventory";
import { apiCreateBoat, apiDeleteBoat, apiToggleBoat, apiUpdateBoat } from "@/src/services/api/endpoints";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { useSync } from "@/src/state/SyncContext";
import { makeStyles, useTheme } from "@/src/theme";
import { Boat } from "@/src/types";

export default function BoatsAdminScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useSession();
  const { online } = useConnectivity();
  const { syncNow } = useSync();
  const { data: boats = [], isLoading } = useBoats();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [registration, setRegistration] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = user?.role === "admin" || user?.role === "inspector";
  const canDelete = user?.role === "admin";

  useEffect(() => {
    if (!allowed) router.replace("/inventory");
  }, [allowed, router]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setRegistration("");
    setActive(true);
    setError(null);
  };

  const editBoat = (boat: Boat) => {
    setEditingId(boat.id);
    setName(boat.name);
    setRegistration(boat.registration ?? "");
    setActive(boat.is_active === 1);
    setError(null);
  };

  const save = async () => {
    if (!token || !online || saving) return;

    const cleanName = name.trim();
    const cleanRegistration = registration.trim();

    if (!cleanName) {
      setError("El nombre del barco es obligatorio.");
      return;
    }

    if (!cleanRegistration) {
      setError("La matrícula es obligatoria.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingId == null) {
        await apiCreateBoat(token, {
          name: cleanName,
          registration: cleanRegistration,
          is_active: active,
        });
      } else {
        await apiUpdateBoat(token, {
          id: editingId,
          name: cleanName,
          registration: cleanRegistration,
          is_active: active,
        });
      }

      await syncNow();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el barco.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (boat: Boat) => {
    if (!token || !online || saving) return;

    setSaving(true);
    setError(null);

    try {
      await apiToggleBoat(token, boat.id);
      await syncNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado del barco.");
    } finally {
      setSaving(false);
    }
  };

  const deleteBoat = (boat: Boat) => {
    if (!token || !online || saving) return;

    Alert.alert(
      "Eliminar barco",
      `¿Quieres eliminar físicamente «${boat.name}»? Esta acción solo está permitida si el barco no tiene usuarios ni repuestos asociados.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            setError(null);
            try {
              await apiDeleteBoat(token, boat.id);
              if (editingId === boat.id) resetForm();
              await syncNow();
            } catch (e) {
              setError(e instanceof Error ? e.message : "No se pudo eliminar el barco.");
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  if (!allowed) return null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ Volver</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Barcos</Text>
          <Text style={styles.subtitle}>Gestión administrativa</Text>
        </View>
        <StatusBadge online={online} syncing={saving} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!online && (
          <View style={styles.offlineNotice}>
            <Text style={styles.offlineTitle}>Sin conexión</Text>
            <Text style={styles.offlineText}>
              La consulta sigue disponible desde la caché. Para crear, editar o
              activar/desactivar barcos necesitas conexión a Internet.
            </Text>
          </View>
        )}

        <View style={styles.formCard}>
          <View style={styles.formHeader}>
            <Text style={styles.sectionTitle}>
              {editingId == null ? "Nuevo barco" : "Editar barco"}
            </Text>
            {editingId != null && (
              <Pressable onPress={resetForm} disabled={saving}>
                <Text style={styles.cancel}>Cancelar</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.label}>Nombre *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nombre del barco"
            placeholderTextColor={colors.muted}
            editable={online && !saving}
          />

          <Text style={styles.label}>Matrícula *</Text>
          <TextInput
            style={styles.input}
            value={registration}
            onChangeText={setRegistration}
            placeholder="Matrícula"
            placeholderTextColor={colors.muted}
            editable={online && !saving}
            autoCapitalize="characters"
          />

          <Pressable
            style={styles.activeRow}
            onPress={() => setActive((value) => !value)}
            disabled={!online || saving}
          >
            <View>
              <Text style={styles.label}>Estado</Text>
              <Text style={styles.stateText}>{active ? "Activo" : "Inactivo"}</Text>
            </View>
            <Text style={[styles.stateBadge, active ? styles.active : styles.inactive]}>
              {active ? "ACTIVO" : "INACTIVO"}
            </Text>
          </Pressable>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.primaryButton, (!online || saving) && styles.disabledButton]}
            onPress={save}
            disabled={!online || saving}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? "Guardando…" : editingId == null ? "Crear barco" : "Guardar cambios"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Barcos registrados</Text>
          <Text style={styles.count}>{isLoading ? "…" : String(boats.length)}</Text>
        </View>

        {boats.map((boat) => (
          <View key={boat.id} style={styles.boatCard}>
            <View style={styles.boatInfo}>
              <Text style={styles.boatName}>{boat.name}</Text>
              <Text style={styles.boatRegistration}>
                {boat.registration || "Sin matrícula"}
              </Text>
              <Text style={[styles.boatState, boat.is_active === 1 ? styles.activeText : styles.inactiveText]}>
                {boat.is_active === 1 ? "Activo" : "Inactivo"}
              </Text>
            </View>

            <View style={styles.actions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => editBoat(boat)}
                disabled={saving}
              >
                <Text style={styles.secondaryButtonText}>Editar</Text>
              </Pressable>

              <Pressable
                style={[styles.secondaryButton, !online && styles.disabledButton]}
                onPress={() => toggle(boat)}
                disabled={!online || saving}
              >
                <Text style={styles.secondaryButtonText}>
                  {boat.is_active === 1 ? "Desactivar" : "Activar"}
                </Text>
              </Pressable>

              {canDelete && (
                <Pressable
                  style={[styles.deleteButton, !online && styles.disabledButton]}
                  onPress={() => deleteBoat(boat)}
                  disabled={!online || saving}
                >
                  <Text style={styles.deleteButtonText}>Eliminar</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}

        {!isLoading && boats.length === 0 && (
          <Text style={styles.empty}>No hay barcos en la caché local.</Text>
        )}

        <Text style={styles.footerNote}>
          Las altas, modificaciones y cambios de estado se realizan siempre contra
          el servidor. Después de cada operación se actualiza la caché local mediante
          la sincronización normal.
        </Text>
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
  },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  back: { fontSize: 15, fontWeight: "700", color: colors.brandPrimary },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  subtitle: { marginTop: 2, fontSize: 12, color: colors.muted },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  offlineNotice: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  offlineTitle: { fontSize: 14, fontWeight: "800", color: colors.onBrandTertiary },
  offlineText: { fontSize: 13, lineHeight: 18, color: colors.onBrandTertiary },
  formCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  cancel: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
  },
  activeRow: {
    marginTop: 3,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stateText: { marginTop: 2, fontSize: 14, color: colors.onSurface },
  stateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "800",
  },
  active: { backgroundColor: colors.brandTertiary, color: colors.onBrandTertiary },
  inactive: { backgroundColor: colors.surfaceTertiary, color: colors.muted },
  error: { color: colors.error, fontSize: 13, marginTop: 2 },
  primaryButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  listHeader: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  count: { fontSize: 13, fontWeight: "700", color: colors.muted },
  boatCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  boatInfo: { gap: 3 },
  boatName: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  boatRegistration: { fontSize: 13, color: colors.onSurfaceSecondary },
  boatState: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  activeText: { color: colors.brandPrimary },
  inactiveText: { color: colors.muted },
  actions: { flexDirection: "row", gap: 8 },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  deleteButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  deleteButtonText: { fontSize: 13, fontWeight: "700", color: colors.error },
  empty: { paddingVertical: 20, textAlign: "center", color: colors.muted },
  footerNote: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.muted },
}));
