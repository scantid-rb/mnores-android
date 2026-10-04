// Tab navigator. Authenticated users get the full app; read-only users only
// get Inventory. This keeps sync/admin/profile inaccessible from the UI.

import { Redirect, Tabs } from "expo-router";
import { Platform, Text } from "react-native";

import { useSession } from "@/src/state/SessionContext";
import { useTheme } from "@/src/theme";

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  const { colors } = useTheme();
  return <Text style={{ fontSize: 12, fontWeight: focused ? "700" : "500", color: focused ? colors.brandPrimary : colors.muted }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>;
}

export default function TabsLayout() {
  const { loading, token, session, mode } = useSession();
  const { colors } = useTheme();
  const readonly = mode === "readonly";

  if (loading) return null;
  if ((!token || !session) && !readonly) return <Redirect href="/login" />;

  const canOpenAdministration =
    session?.role === "admin" || session?.role === "inspector" || session?.role === "chief_engineer";

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.brandPrimary,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, ...(Platform.OS === "web" ? { height: 64 } : {}) },
      tabBarItemStyle: { alignSelf: "center" },
    }}>
      <Tabs.Screen name="inventory" options={{ title: "Inventario", tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label={readonly ? "Solo lectura" : "Inventario"} focused={focused} /> }} />
      <Tabs.Screen name="sync" options={{ title: "Sync", href: readonly ? null : "/sync", tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Sync" focused={focused} /> }} />
      <Tabs.Screen name="admin" options={{ title: "Administración", href: readonly || !canOpenAdministration ? null : "/admin", tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Administración" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Perfil", href: readonly ? null : "/profile", tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Perfil" focused={focused} /> }} />
      <Tabs.Screen name="about" options={{ title: "Acerca de", href: "/about", tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Acerca de" focused={focused} /> }} />
    </Tabs>
  );
}
