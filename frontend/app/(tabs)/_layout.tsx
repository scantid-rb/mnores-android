// Tab navigator (Android-first). Classic expo-router Tabs with 3 tabs.
// Guards the tab area: if there is no session, redirect to login.

import { Redirect, Tabs } from "expo-router";
import { Platform, Text } from "react-native";

import { useSession } from "@/src/state/SessionContext";
import { useTheme } from "@/src/theme";

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: focused ? "700" : "500",
        color: focused ? colors.brandPrimary : colors.muted,
      }}
    >
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  const { loading, token, session } = useSession();
  const { colors } = useTheme();

  if (loading) return null;
  if (!token || !session) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
      }}
    >
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Inventario",
          tabBarIcon: () => null,
          tabBarLabel: ({ focused }) => <TabLabel label="Inventario" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: "Sync",
          tabBarIcon: () => null,
          tabBarLabel: ({ focused }) => <TabLabel label="Sync" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Administración",
          href: user.role === "admin" || user.role === "inspector" ? "/admin" : null,
          tabBarIcon: () => null,
          tabBarLabel: ({ focused }) => <TabLabel label="Administración" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Perfil",
          tabBarIcon: () => null,
          tabBarLabel: ({ focused }) => <TabLabel label="Perfil" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
