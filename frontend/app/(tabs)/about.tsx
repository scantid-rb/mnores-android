import { useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { APP_VERSION, API_VERSION } from "@/src/config";
import { apiHandshake, HandshakeResponse } from "@/src/services/api/endpoints";
import { getServerUrl } from "@/src/services/serverConfig";
import { useConnectivity } from "@/src/services/sync/connectivity";
import { makeStyles } from "@/src/theme";

function detectClientMode(): string {
  if (Platform.OS !== "web") return "Aplicación nativa Android";
  if (typeof window === "undefined") return "PWA / navegador";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "PWA instalada" : "Navegador web";
}

export default function AboutScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { online } = useConnectivity();

  const [serverUrl, setServerUrl] = useState("—");
  const [handshake, setHandshake] = useState<HandshakeResponse | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const url = await getServerUrl();
      if (!active) return;
      setServerUrl(url);
      if (!online) return;
      try {
        const info = await apiHandshake(url);
        if (active) setHandshake(info);
      } catch {
        if (active) setHandshake(null);
      }
    })();
    return () => { active = false; };
  }, [online]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Acerca de</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.appName}>ShipInventory</Text>
          <Text style={styles.tagline}>Servicio de gestión de inventario para barcos</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Aplicación</Text>
          <Row label="Cliente" value={detectClientMode()} />
          <Row label="Versión" value={APP_VERSION} />
          <Row label="API requerida" value={API_VERSION} />
          <Row label="Estado" value={online ? "Online" : "Offline"} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Servidor</Text>
          <Row label="Dirección" value={serverUrl} />
          <Row label="Versión servidor" value={handshake?.app_version ?? (online ? "No disponible" : "Sin conexión")} />
          <Row label="API servidor" value={handshake?.api_version ?? (online ? "No disponible" : "Sin conexión")} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Información</Text>
          <Text style={styles.body}>
            ShipInventory permite gestionar inventarios de repuestos de buques con funcionamiento online y offline, sincronización posterior y control de acceso por roles.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Licencia</Text>
          <Text style={styles.body}>Software libre distribuido bajo la licencia MIT.</Text>
          <Text style={styles.body}>© 2026 José Isidro González</Text>
          <Text style={styles.muted}>
            Las bibliotecas y dependencias de terceros mantienen sus respectivas licencias.
          </Text>
        </View>
      </ScrollView>
    </View>
  );

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} selectable>{value}</Text>
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
  hero: { alignItems: "center", paddingVertical: 18, gap: 6 },
  appName: { fontSize: 28, fontWeight: "900", color: colors.onSurface },
  tagline: { fontSize: 14, textAlign: "center", color: colors.muted },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { flex: 1, textAlign: "right", fontSize: 14, fontWeight: "700", color: colors.onSurface },
  body: { fontSize: 14, lineHeight: 20, color: colors.onSurfaceSecondary },
  muted: { fontSize: 12, lineHeight: 18, color: colors.muted },
}));
