// Central configuration. EXPO_PUBLIC_API_BASE_URL can override the default.
// The development/production API is served over HTTPS.
// This fallback ensures a fresh Codespace works even when frontend/.env
// has not been created yet. Local .env values still take precedence.

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://devmn.atwebpages.com";

// The mobile app version is independent from the backend API version.
export const APP_VERSION = "0.1.2";
export const API_VERSION = "1.4.3";

// Bounded network timeout for a single request.
export const REQUEST_TIMEOUT_MS = 15000;
