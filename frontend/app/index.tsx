// Session/access gate. A stored authenticated session opens the normal app;
// otherwise the login screen decides whether local read-only access is available.

import { Redirect } from "expo-router";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/src/state/SessionContext";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { loading, token, session, mode } = useSession();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.brandPrimary }]} testID="splash-screen">
        <Image source={require("../assets/images/app-image.png")} style={styles.appImage} resizeMode="contain" accessibilityLabel="ShipInventory" />\n        <Text style={[styles.title, { color: colors.onBrandPrimary }]}>ShipInventory</Text>
        <ActivityIndicator color={colors.onBrandPrimary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  if ((token && session) || mode === "readonly") return <Redirect href="/inventory" />;
  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  appImage: { width: 140, height: 140, marginBottom: 8 },\n  title: { fontSize: 24, fontWeight: "800" },
});
