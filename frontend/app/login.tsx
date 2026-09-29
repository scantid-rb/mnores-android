// Login screen. Online login remains unchanged; when a local inventory cache
// exists, the user can also enter it in read-only mode without contacting the server.

import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/src/components/StatusBadge";
import { APP_VERSION, API_VERSION } from "@/src/config";
import { ApiError } from "@/src/services/api/client";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles, useTheme } from "@/src/theme";

export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, session, cacheAvailable, enterReadonly, signIn } = useSession();
  const { online } = useConnectivity();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [readonlyLoading, setReadonlyLoading] = useState(false);

  if (token && session) return <Redirect href="/inventory" />;

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting && !readonlyLoading;

  const onSubmit = async () => {
    setError(null);
    if (!online) {
      setError("Se necesita conexión para iniciar sesión.");
      return;
    }
    setSubmitting(true);
    try {
      await signIn(username.trim(), password);
      router.replace("/inventory");
    } catch (e) {
      if (e instanceof ApiError) setError(e.status === 0 ? e.message : e.message || "No se pudo iniciar sesión.");
      else setError("No se pudo iniciar sesión.");
    } finally { setSubmitting(false); }
  };

  const onReadonly = async () => {
    setError(null);
    setReadonlyLoading(true);
    try {
      await enterReadonly();
      router.replace("/inventory");
    } catch {
      setError("No se pudo abrir la cache local.");
    } finally { setReadonlyLoading(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Image source={require("@/assets/images/app-image.png")} style={styles.appImage} resizeMode="contain" />
          <Text style={styles.brand}>ShipInventory</Text>
          <Text style={styles.subtitle}>Inventario de repuestos a bordo</Text>
          <View style={styles.badgeRow}><StatusBadge online={online} /></View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Configuración del servidor"
          style={styles.serverSettingsButton}
          onPress={() => router.push("/server-settings")}
          testID="server-settings-button"
        >
          <SymbolView name={{ ios: "gearshape.fill", android: "settings", web: "settings" }} size={22} tintColor={colors.brandPrimary} />
          <Text style={styles.serverSettingsText}>Configuración del servidor</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.label}>Usuario</Text>
          <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="Usuario" placeholderTextColor={colors.muted} testID="login-username-input" />
          <Text style={styles.label}>Contraseña</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" placeholderTextColor={colors.muted} testID="login-password-input" onSubmitEditing={onSubmit} returnKeyType="go" />
          {!!error && <Text style={styles.error} testID="login-error">{error}</Text>}
          <Pressable style={[styles.button, !canSubmit && styles.buttonDisabled]} onPress={onSubmit} disabled={!canSubmit} testID="login-submit-button">
            {submitting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.buttonText}>Entrar</Text>}
          </Pressable>
        </View>

        {cacheAvailable && (
          <View style={styles.readonlyCard}>
            <Text style={styles.readonlyTitle}>Inventario local disponible</Text>
            <Text style={styles.readonlyText}>Puedes consultar el último inventario guardado sin iniciar sesión. No podrás modificar ni sincronizar datos.</Text>
            <Pressable style={[styles.readonlyButton, readonlyLoading && styles.buttonDisabled]} onPress={onReadonly} disabled={readonlyLoading} testID="readonly-button">
              {readonlyLoading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.buttonText}>Acceder en modo solo lectura</Text>}
            </Pressable>
          </View>
        )}

        <Text style={styles.version}>App {APP_VERSION}  ·  API {API_VERSION}</Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 20 },
  header: { alignItems: "center", gap: 6 },
  appImage: { width: 120, height: 120, marginBottom: 4 },
  brand: { fontSize: 28, fontWeight: "800", color: colors.brandPrimary },
  subtitle: { fontSize: 14, color: colors.muted },
  badgeRow: { marginTop: 8 },
  serverSettingsButton: { alignSelf: "center", minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  serverSettingsText: { fontSize: 14, fontWeight: "700", color: colors.brandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 8, borderWidth: 1, borderColor: colors.border },
  readonlyCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: colors.border },
  readonlyTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  readonlyText: { fontSize: 13, lineHeight: 19, color: colors.muted },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary, marginTop: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.onSurface },
  error: { color: colors.error, fontSize: 14, marginTop: 8 },
  button: { marginTop: 16, backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  readonlyButton: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  version: { textAlign: "center", fontSize: 12, color: colors.muted },
}));
