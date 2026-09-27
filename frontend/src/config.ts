// Central configuration. The API base URL is read ONLY from the environment
// (EXPO_PUBLIC_API_BASE_URL). Never hard-code the URL elsewhere in the app.
// Development value lives in frontend/.env; production will switch to HTTPS
// without changing any source code.

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL as string;

// The mobile app version is independent from the backend API version.
export const APP_VERSION = "0.1.2";
export const API_VERSION = "1.4.3";

// Bounded network timeout for a single request.
export const REQUEST_TIMEOUT_MS = 15000;
