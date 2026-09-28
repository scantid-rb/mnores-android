import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/src/components/StatusBadge";
import { useBoats, useUsers } from "@/src/hooks/useInventory";
import {
  apiCreateUser,
  apiDeleteUser,
  apiToggleUser,
  apiUpdateUser,
} from "@/src/services/api/endpoints";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { useSync } from "@/src/state/SyncContext";
import { makeStyles, useTheme } from "@/src/theme";
import { Role, User } from "@/src/types";

const roleLabels: Record<Role, string> = {
  admin: "Administrador",
  inspector: "Inspector",
  chief_engineer: "Jefe de Máquinas",
  mechanic: "Mecánico",
};

const rolesFor = (role: Role): Role[] =>
  role === "admin"
    ? ["admin", "inspector", "chief_engineer", "mechanic"]
    : ["chief_engineer", "mechanic"];

export default function UsersAdminScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user: actor } = useSession();
  const { online } = useConnectivity();
  const { syncNow } = useSync();
  const { data: users = [], isLoading } = useUsers();
  const { data: boats = [] } = useBoats();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [role, setRole] = useState<Role>("mechanic");
  const [boatId, setBoatId] = useState<number | null>(null);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = actor?.role === "admin" || actor?.role === "inspector";
  const roleOptions = useMemo(() => rolesFor(actor?.role ?? "inspector"), [actor?.role]);
  const editingUser = users.find((u) => u.id === editingId) ?? null;
  const isPrimaryAdmin = editingUser?.is_primary_admin === 1;
  const availableBoats = boats.filter((b) => b.is_active === 1 && !b.deleted_at);

  const resetForm = () => {
    setEditingId(null);
    setUsername("");
    setFirstName("");
    setLastName("");
    setPassword("");
    setPassword2("");
    setRole(roleOptions.includes("mechanic") ? "mechanic" : roleOptions[0]);
    setBoatId(null);
    setActive(true);
    setError(null);
  };

  const editUser = (u: User) => {
    setEditingId(u.id);
    setUsername(u.username);
    setFirstName(u.first_name);
    setLastName(u.last_name);
    setPassword("");
    setPassword2("");
    setRole(u.role);
    setBoatId(u.boat_id);
    setActive(u.is_active === 1);
    setError(null);
  };

  const save = async () => {
    if (!token || !online || saving) return;

    if (!username.trim() || !firstName.trim() || !lastName.trim()) {
      setError("Usuario, nombre y apellidos son obligatorios.");
      return;
    }
    if (editingId == null && password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== password2) {
      if (password || password2) {
        setError("Las contraseñas no coinciden.");
        return;
      }
    }
    if ((role === "chief_engineer" || role === "mechanic") && boatId == null) {
      setError("Este rol requiere un barco asignado.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingId == null) {
        await apiCreateUser(token, {
          username: username.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          password,
          password2,
          role,
          boat_id: boatId,
          is_active: active,
        });
      } else {
        await apiUpdateUser(token, {
          id: editingId,
          username: username.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          password: password || undefined,
          password2: password2 || undefined,
          role,
          boat_id: boatId,
          is_active: active,
        });
      }

      await syncNow();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el usuario.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (u: User) => {
    if (!token || !online || saving || u.is_primary_admin === 1) return;
    setSaving(true);
    setError(null);
    try {
      await apiToggleUser(token, u.id);
      await syncNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (u: User) => {
    if (!token || !online || saving || u.is_primary_admin === 1) return;

    Alert.alert(
      "Eliminar usuario",
      `¿Quieres eliminar físicamente a «${u.username}»? Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            setError(null);
            try {
              await apiDeleteUser(token, u.id);
              if (editingId === u.id) resetForm();
              await syncNow();
            } catch (e) {
              setError(e instanceof Error ? e.message : "No se pudo eliminar el usuario.");
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
          <Text style={styles.title}>Usuarios</Text>
          <Text style={styles.subtitle}>Gestión administrativa</Text>
        </View>
        <StatusBadge online={online} syncing={saving} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!online && (
          <View style={styles.offlineNotice}>
            <Text style={styles.offlineTitle}>Sin conexión</Text>
            <Text style={styles.offlineText}>
              Los usuarios siguen disponibles desde la caché para consulta. Las modificaciones requieren Internet.
            </Text>
          </View>
        )}

        <View style={styles.formCard}>
          <View style={styles.formHeader}>
            <Text style={styles.sectionTitle}>
              {editingId == null ? "Nuevo usuario" : "Editar usuario"}
            </Text>
            {editingId != null && (
              <Pressable onPress={resetForm} disabled={saving}>
                <Text style={styles.cancel}>Cancelar</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.label}>Usuario *</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="nombre.usuario"
            placeholderTextColor={colors.muted}
            editable={online && !saving}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Nombre *</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Nombre"
            placeholderTextColor={colors.muted}
            editable={online && !saving}
          />

          <Text style={styles.label}>Apellidos *</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Apellidos"
            placeholderTextColor={colors.muted}
            editable={online && !saving}
          />

          <Text style={styles.label}>
            {editingId == null ? "Contraseña *" : "Nueva contraseña (opcional)"}
          </Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder={editingId == null ? "Mínimo 8 caracteres" : "Dejar vacío para mantenerla"}
            placeholderTextColor={colors.muted}
            editable={online && !saving}
            secureTextEntry
          />

          <Text style={styles.label}>
            {editingId == null ? "Repetir contraseña *" : "Repetir nueva contraseña"}
          </Text>
          <TextInput
            style={styles.input}
            value={password2}
            onChangeText={setPassword2}
            placeholder="Repetir contraseña"
            placeholderTextColor={colors.muted}
            editable={online && !saving}
            secureTextEntry
          />

          <Text style={styles.label}>Rol</Text>
          <View style={styles.options}>
            {roleOptions.map((r) => (
              <Pressable
                key={r}
                style={[styles.option, role === r && styles.optionSelected]}
                onPress={() => setRole(r)}
                disabled={!online || saving || isPrimaryAdmin}
              >
                <Text style={[styles.optionText, role === r && styles.optionTextSelected]}>
                  {roleLabels[r]}
                </Text>
              </Pressable>
            ))}
          </View>

          {(role === "chief_engineer" || role === "mechanic") && (
            <>
              <Text style={styles.label}>Barco *</Text>
              <View style={styles.options}>
                {availableBoats.map((b) => (
                  <Pressable
                    key={b.id}
                    style={[styles.option, boatId === b.id && styles.optionSelected]}
                    onPress={() => setBoatId(b.id)}
                    disabled={!online || saving || isPrimaryAdmin}
                  >
                    <Text style={[styles.optionText, boatId === b.id && styles.optionTextSelected]}>
                      {b.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {editingId != null && (
            <Pressable
              style={styles.activeRow}
              onPress={() => setActive((value) => !value)}
              disabled={!online || saving || isPrimaryAdmin}
            >
              <View>
                <Text style={styles.label}>Estado</Text>
                <Text style={styles.stateText}>{active ? "Activo" : "Inactivo"}</Text>
              </View>
              <Text style={[styles.stateBadge, active ? styles.active : styles.inactive]}>
                {active ? "ACTIVO" : "INACTIVO"}
              </Text>
            </Pressable>
          )}

          {isPrimaryAdmin && (
            <Text style={styles.primaryNotice}>
              Administrador principal: no se puede desactivar ni eliminar.
            </Text>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.primaryButton, (!online || saving) && styles.disabledButton]}
            onPress={save}
            disabled={!online || saving}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? "Guardando…" : editingId == null ? "Crear usuario" : "Guardar cambios"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Usuarios registrados</Text>
          <Text style={styles.count}>{isLoading ? "…" : String(users.length)}</Text>
        </View>

        {users.map((u) => {
          const boat = boats.find((b) => b.id === u.boat_id);
          return (
            <View key={u.id} style={styles.userCard}>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{u.first_name} {u.last_name}</Text>
                <Text style={styles.username}>@{u.username}</Text>
                <Text style={styles.role}>{roleLabels[u.role]}</Text>
                {boat && <Text style={styles.boat}>{boat.name}</Text>}
                <Text style={[styles.state, u.is_active === 1 ? styles.activeText : styles.inactiveText]}>
                  {u.is_active === 1 ? "Activo" : "Inactivo"}
                </Text>
              </View>

              <View style={styles.actions}>
                <Pressable style={styles.secondaryButton} onPress={() => editUser(u)} disabled={saving}>
                  <Text style={styles.secondaryButtonText}>Editar</Text>
                </Pressable>

                {!u.is_primary_admin && (
                  <>
                    <Pressable
                      style={[styles.secondaryButton, !online && styles.disabledButton]}
                      onPress={() => toggle(u)}
                      disabled={!online || saving}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {u.is_active === 1 ? "Desactivar" : "Activar"}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[styles.deleteButton, !online && styles.disabledButton]}
                      onPress={() => remove(u)}
                      disabled={!online || saving}
                    >
                      <Text style={styles.deleteButtonText}>Eliminar</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          );
        })}

        {!isLoading && users.length === 0 && (
          <Text style={styles.empty}>No hay usuarios en la caché local.</Text>
        )}

        <Text style={styles.footerNote}>
          Las altas, modificaciones, cambios de estado y eliminaciones se realizan siempre contra el servidor.
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
  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 9, borderWidth: 1, borderColor: colors.border },
  formHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  cancel: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.onSurface },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surfaceTertiary },
  optionSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  optionText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  optionTextSelected: { color: colors.onBrandPrimary },
  activeRow: { marginTop: 3, paddingVertical: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stateText: { marginTop: 2, fontSize: 14, color: colors.onSurface },
  stateBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, overflow: "hidden", fontSize: 11, fontWeight: "800" },
  active: { backgroundColor: colors.brandTertiary, color: colors.onBrandTertiary },
  inactive: { backgroundColor: colors.surfaceTertiary, color: colors.muted },
  primaryNotice: { fontSize: 12, lineHeight: 17, color: colors.muted },
  error: { color: colors.error, fontSize: 13, marginTop: 2 },
  primaryButton: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  listHeader: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { fontSize: 13, fontWeight: "700", color: colors.muted },
  userCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 15, borderWidth: 1, borderColor: colors.border, gap: 12 },
  userInfo: { gap: 3 },
  userName: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  username: { fontSize: 13, color: colors.onSurfaceSecondary },
  role: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary, marginTop: 2 },
  boat: { fontSize: 12, color: colors.onSurfaceSecondary },
  state: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  activeText: { color: colors.brandPrimary },
  inactiveText: { color: colors.muted },
  actions: { flexDirection: "row", gap: 8 },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surfaceTertiary },
  secondaryButtonText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  deleteButton: { flex: 1, borderWidth: 1, borderColor: colors.error, borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surfaceTertiary },
  deleteButtonText: { fontSize: 13, fontWeight: "700", color: colors.error },
  empty: { paddingVertical: 20, textAlign: "center", color: colors.muted },
  footerNote: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.muted },
}));
