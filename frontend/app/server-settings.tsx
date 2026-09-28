import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_VERSION } from "@/src/config";
import { apiHandshake, HandshakeResponse } from "@/src/services/api/endpoints";
import { getServerUrl, normalizeServerUrl } from "@/src/services/serverConfig";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles, useTheme } from "@/src/theme";

export default function ServerSettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, session, switchServer } = useSession();

  const [url, setUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [handshake, setHandshake] = useState<HandshakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getServerUrl().then((value) => {
      setUrl(value);
      setCurrentUrl(value);
    });
  }, []);

  const checkServer = async () => {
    setError(null);
    setHandshake(null);
    let normalized: string;
    try {
      normalized = normalizeServerUrl(url);
      setUrl(normalized);
    } catch (e) {
      setError(e instanceof Error ? e.message : "La dirección del servidor no es válida.");
      return;
    }

    setChecking(true);
    try {
      const result = await apiHandshake(normalized);
      setHandshake(result);
      if (result.api_version !== API_VERSION) {
        setError(`Servidor incompatible: API ${result.api_version}. Esta app requiere API ${API_VERSION}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo comprobar el servidor.");
    } finally {
      setChecking(false);
    }
  };

  const saveServer = () => {
    if (!handshake || handshake.api_version !== API_VERSION) return;

    const normalized = normalizeServerUrl(url);
    if (normalized === currentUrl) {
      router.back();
      return;
    }

    Alert.alert(
      "Cambiar servidor",
      "Al cambiar de servidor se cerrará la sesión y se eliminarán la caché local, las colas pendientes, las fotos locales y el estado de sincronización. No se migrará ningún dato al nuevo servidor.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cambiar servidor",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            setError(null);
            try {
              await switchServer(normalized);
              router.replace("/login");
            } catch (e) {
              setError(e instanceof Error ? e.message : "No se pudo cambiar el servidor.");
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const compatible = handshake?.api_version === API_VERSION;
  const busy = checking || saving;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Configuración del servidor</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Dirección del servidor</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={(value) => {
              setUrl(value);
              setHandshake(null);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://servidor.ejemplo.com"
            placeholderTextColor={colors.muted}
            editable={!busy}
            testID="server-url-input"
          />

          <Text style={styles.help}>
            Debe ser una dirección HTTPS. Antes de guardar se comprobará que el servidor responde y que su API es compatible con esta aplicación.
          </Text>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={checkServer} disabled={busy} testID="server-check-button">
            {checking ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Comprobar servidor</Text>}
          </Pressable>
        </View>

        {handshake && (
          <View style={[styles.resultCard, compatible ? styles.resultOk : styles.resultError]}>
            <Text style={styles.resultTitle}>{compatible ? "Servidor compatible" : "Servidor no compatible"}</Text>
            <Text style={styles.resultLine}>Nombre: {handshake.app_name}</Text>
            <Text style={styles.resultLine}>Título: {handshake.app_title}</Text>
            <Text style={styles.resultLine}>Versión del servidor: {handshake.app_version}</Text>
            <Text style={styles.resultLine}>API del servidor: {handshake.api_version}</Text>
            <Text style={styles.resultLine}>API requerida por la app: {API_VERSION}</Text>
          </View>
        )}

        <Pressable
          style={[styles.primaryButton, (!compatible || busy) && styles.disabled]}
          onPress={saveServer}
          disabled={!compatible || busy}
          testID="server-save-button"
        >
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Guardar y cambiar servidor</Text>}
        </Pressable>

        {token && session && (
          <Text style={styles.warning}>
            Estás configurando el servidor desde una sesión activa. El cambio cerrará esta sesión y borrará los datos locales antes de entrar al nuevo servidor.
          </Text>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backText: { fontSize: 34, lineHeight: 38, color: colors.onSurface },
  headerSpacer: { width: 44 },
  title: { flex: 1, textAlign: "center", fontSize: 20, fontWeight: "800", color: colors.onSurface },
  content: { padding: 20, gap: 16 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.onSurface },
  help: { fontSize: 13, lineHeight: 19, color: colors.muted },
  error: { fontSize: 13, lineHeight: 19, color: colors.error, fontWeight: "600" },
  primaryButton: { backgroundColor: colors.brandPrimary, borderRadius: 12, minHeight: 50, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  resultCard: { borderRadius: 16, padding: 16, gap: 6, borderWidth: 1 },
  resultOk: { backgroundColor: colors.surfaceSecondary, borderColor: colors.success },
  resultError: { backgroundColor: colors.surfaceSecondary, borderColor: colors.error },
  resultTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface, marginBottom: 4 },
  resultLine: { fontSize: 13, color: colors.onSurfaceSecondary },
  warning: { fontSize: 13, lineHeight: 19, color: colors.warning, textAlign: "center" },
}));
