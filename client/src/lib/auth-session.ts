import { NV_AUTH_TOKEN_KEY } from './jrx-auth-token';

const LEGACY_TOKEN_KEYS = ['nyv_token', 'nyv_auth_token', 'authToken', 'access_token'] as const;
const USER_KEYS = ['user', 'nyv_user'] as const;

export function setAuthSession(token: string, user: unknown): void {
  if (typeof window === 'undefined') return;
  for (const k of [NV_AUTH_TOKEN_KEY, ...LEGACY_TOKEN_KEYS]) {
    window.localStorage.setItem(k, token);
  }
  const serialized = JSON.stringify(user);
  for (const k of USER_KEYS) {
    window.localStorage.setItem(k, serialized);
  }
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  for (const k of [NV_AUTH_TOKEN_KEY, ...LEGACY_TOKEN_KEYS]) {
    window.localStorage.removeItem(k);
  }
  for (const k of USER_KEYS) {
    window.localStorage.removeItem(k);
  }
}

export function getStoredUserRaw(): string | null {
  if (typeof window === 'undefined') return null;
  for (const k of USER_KEYS) {
    const v = window.localStorage.getItem(k);
    if (v) return v;
  }
  return null;
}
