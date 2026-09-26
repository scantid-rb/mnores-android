// Session gate. While the session restores, show a splash. Then redirect to
// the inventory if a session exists (even offline), otherwise to login.

import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/src/state/SessionContext";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { loading, token, session } = useSession();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.brandPrimary }]} testID="splash-screen">
        <Text style={[styles.title, { color: colors.onBrandPrimary }]}>MNores Inventory</Text>
        <ActivityIndicator color={colors.onBrandPrimary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  // A stored session (token + metadata) lets the user in offline.
  if (token && session) {
    return <Redirect href="/inventory" />;
  }

  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
  },
});
