// Shared storage keys. The auth token is written and read with the SAME key
// and the SAME (secure) namespace on both sides (SessionContext writes, API
// client reads). A mismatch would silently surface as a logged-out state.

export const TOKEN_KEY = "mnores.auth.token";
