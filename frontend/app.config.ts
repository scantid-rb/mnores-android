import type { ExpoConfig } from "expo/config";

const isArm64Preview = process.env.EAS_BUILD_PROFILE === "preview-arm64";

const config: ExpoConfig = {
  name: "ShipInventory",
  slug: "shipinventory",
  version: "0.1.3",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "shipinventory",
  userInterfaceStyle: "automatic",

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.shipinventory.x6tence.app",
  },

  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#0D1B2A",
    },
    package: "com.shipinventory.x6tence.app",
  },

  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/images/favicon.png",
  },

  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-image.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#000000",
      },
    ],
    "expo-font",
    "expo-image",
    "expo-secure-store",
    "expo-web-browser",
    "expo-status-bar",
    "expo-sqlite",
    [
      "expo-image-picker",
      {
        cameraPermission:
          "ShipInventory necesita la cámara para fotografiar repuestos.",
        photosPermission:
          "ShipInventory necesita acceso a tus fotos para adjuntar imágenes a los repuestos.",
        microphonePermission: false,
      },
    ],
    ...(isArm64Preview
      ? [
          [
            "expo-build-properties",
            {
              android: {
                buildArchs: ["arm64-v8a"],
              },
            },
          ],
        ]
      : []),
  ],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    eas: {
      projectId: "85c5ec6d-cb6c-4f7f-b413-e90dbf397e9c",
    },
  },

  owner: "mnores",
};

export default config;
