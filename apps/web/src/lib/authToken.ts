const AUTH_TOKEN_STORAGE_KEY = 'reconciliation-platform:auth-token';

/**
 * Single source of truth for where the bearer token lives (ADR-0002 DECIDE 1 = JWT in
 * localStorage, owner's call). `api.ts`'s `apiFetch` reads this to attach the Authorization
 * header; App.tsx reads/clears it around login and sign-out.
 */
export const getAuthToken = (): string | null => {
  try {
    return globalThis.localStorage?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
};

export const setAuthToken = (token: string): void => {
  try {
    globalThis.localStorage?.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures so the token still works in-memory for this page load.
  }
};

export const clearAuthToken = (): void => {
  try {
    globalThis.localStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};
