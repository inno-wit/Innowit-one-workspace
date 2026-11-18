/**
 * src/utils/auth.ts
 *
 * Thin auth token utilities for use in the frontend services.
 * Tokens are stored in memory (module scope) only — NOT localStorage.
 * The auth store (Zustand / React context) calls setAccessToken after
 * a successful login/refresh and clearAuth on logout.
 */

let _accessToken: string | null = null;

/** Returns the current in-memory access token, or null if unauthenticated. */
export function getAccessToken(): string | null {
  return _accessToken;
}

/** Set by the auth store after a successful login or token refresh. */
export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

/** Clears all in-memory auth state.  Call on logout or 401 response. */
export function clearAuth(): void {
  _accessToken = null;
}

/** Returns true when an in-memory token is present (does NOT validate expiry). */
export function isAuthenticated(): boolean {
  return _accessToken !== null;
}
