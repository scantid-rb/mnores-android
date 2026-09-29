// Static build configuration. The API endpoint itself is dynamic and is
// resolved by serverConfig.ts at runtime. EXPO_PUBLIC_API_BASE_URL is only the
// first-install fallback when no server has been selected yet.

export const DEFAULT_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://mnores.atwebpages.com";

export const APP_VERSION = "0.1.3";
export const API_VERSION = "1.4.4";
export const REQUEST_TIMEOUT_MS = 20000;
