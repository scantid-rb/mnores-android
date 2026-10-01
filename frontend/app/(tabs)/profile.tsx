import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { APP_VERSION, API_VERSION } from "@/src/config";
import { useBoats } from "@/src/hooks/useInventory";
import {
  apiChangeOwnPassword,
  apiGetAccount,
  apiUpdateAccountProfile,
} from "@/src/services/api/endpoints";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles, useTheme } from "@/src/theme";
import { AccountUser } from "@/src/types";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  inspector: "Inspector",
  chief_engineer: "Jefe de máquinas",
  mechanic: "Mecánico",
};

export default function ProfileScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { token, user, signOut, updateIdentity } = useSession();
  const { online } = useConnectivity();
  const { data: boats = [] } = useBoats();

  const [account, setAccount] = useState<AccountUser | null>(null);
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !online) return;
    let mounted = true;
    setLoadingAccount(true);
    apiGetAccount(token)
      .then((data) => {
        if (!mounted) return;
        setAccount(data);
        setUsername(data.username);
        setFirstName(data.first_name);
        setLastName(data.last_name);
      })
      .catch((e) => {
        if (mounted) setProfileError(e instanceof Error ? e.message : "No se pudo cargar el perfil.");
      })
      .finally(() => {
        if (mounted) setLoadingAccount(false);
      });
    return () => {
      mounted = false;
    };
  }, [online, token]);

  const effectiveUser = account ?? (user ? {
    id: user.id,
    username: user.username,
    first_name: user.first_name ?? "",
    last_name: user.last_name ?? "",
    role: user.role,
    boat_id: user.boat_id,
    is_active: 1,
  } : null);

  const boatName = useMemo(() => {
    if (!effectiveUser) return "—";
    if (effectiveUser.boat_id == null) return "Sin asignar";
    const b = boats.find((x) => x.id === effectiveUser.boat_id);
    return b?.name ?? `ID ${effectiveUser.boat_id}`;
  }, [boats, effectiveUser]);

  const saveProfile = async () => {
    if (!token || !online || savingProfile) return;
    if (!username.trim() || !firstName.trim() || !lastName.trim()) {
      setProfileError("Usuario, nombre y apellidos son obligatorios.");
      return;
    }

    setSavingProfile(true);
    setProfileError(null);
    try {
      const updated = await apiUpdateAccountProfile(token, {
        username: username.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      setAccount(updated);
      await updateIdentity({
        id: updated.id,
        username: updated.username,
        first_name: updated.first_name,
        last_name: updated.last_name,
        role: updated.role,
        boat_id: updated.boat_id,
      });
      setUsername(updated.username);
      setFirstName(updated.first_name);
      setLastName(updated.last_name);
      Alert.alert("Perfil", "Datos personales actualizados.");
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "No se pudo actualizar el perfil.");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!token || !online || savingPassword) return;
    if (!currentPassword) {
      setPasswordError("Introduce tu contraseña actual.");
      return;
    }
    if (password.length < 8) {
      setPasswordError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== password2) {
      setPasswordError("Las contraseñas nuevas no coinciden.");
      return;
    }

    setSavingPassword(true);
    setPasswordError(null);
    try {
      await apiChangeOwnPassword(token, {
        current_password: currentPassword,
        password,
        password2,
      });
      setCurrentPassword("");
      setPassword("");
      setPassword2("");
      Alert.alert("Contraseña", "Contraseña actualizada correctamente.");
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "No se pudo cambiar la contraseña.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Perfil</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!online && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Sin conexión</Text>
            <Text style={styles.noticeText}>
              Puedes consultar los datos guardados, pero los cambios de perfil y contraseña requieren conexión.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cuenta</Text>
          <Row label="Rol" value={effectiveUser ? ROLE_LABELS[effectiveUser.role] ?? effectiveUser.role : "—"} />
          <Row label="Barco" value={boatName} />
          <Row label="Estado" value={effectiveUser?.is_active === 0 ? "Inactivo" : "Activo"} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Datos personales</Text>

          <Text style={styles.label}>Usuario</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder={effectiveUser?.username ?? "Usuario"}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            editable={online && !savingProfile && !loadingAccount}
          />

          <Text style={styles.label}>Nombre</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Nombre"
            placeholderTextColor={colors.muted}
            editable={online && !savingProfile && !loadingAccount}
          />

          <Text style={styles.label}>Apellidos</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Apellidos"
            placeholderTextColor={colors.muted}
            editable={online && !savingProfile && !loadingAccount}
          />

          {!!profileError && <Text style={styles.error}>{profileError}</Text>}

          <Pressable
            style={[styles.primaryButton, (!online || savingProfile || loadingAccount) && styles.disabled]}
            onPress={saveProfile}
            disabled={!online || savingProfile || loadingAccount}
          >
            <Text style={styles.primaryButtonText}>
              {savingProfile ? "Guardando…" : "Guardar datos"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cambiar contraseña</Text>

          <Text style={styles.label}>Contraseña actual</Text>
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Contraseña actual"
            placeholderTextColor={colors.muted}
            secureTextEntry
            editable={online && !savingPassword}
          />

          <Text style={styles.label}>Nueva contraseña</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor={colors.muted}
            secureTextEntry
            editable={online && !savingPassword}
          />

          <Text style={styles.label}>Repetir nueva contraseña</Text>
          <TextInput
            style={styles.input}
            value={password2}
            onChangeText={setPassword2}
            placeholder="Repetir contraseña"
            placeholderTextColor={colors.muted}
            secureTextEntry
            editable={online && !savingPassword}
          />

          {!!passwordError && <Text style={styles.error}>{passwordError}</Text>}

          <Pressable
            style={[styles.primaryButton, (!online || savingPassword) && styles.disabled]}
            onPress={changePassword}
            disabled={!online || savingPassword}
          >
            <Text style={styles.primaryButtonText}>
              {savingPassword ? "Actualizando…" : "Cambiar contraseña"}
            </Text>
          </Pressable>
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
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  notice: { backgroundColor: colors.brandTertiary, borderRadius: 14, padding: 14, gap: 4 },
  noticeTitle: { fontSize: 14, fontWeight: "800", color: colors.onBrandTertiary },
  noticeText: { fontSize: 13, lineHeight: 18, color: colors.onBrandTertiary },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { flexShrink: 1, textAlign: "right", fontSize: 14, fontWeight: "700", color: colors.onSurface },
  error: { color: colors.error, fontSize: 13 },
  primaryButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  primaryButtonText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  logout: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  logoutText: { color: colors.error, fontSize: 16, fontWeight: "700" },
}));
