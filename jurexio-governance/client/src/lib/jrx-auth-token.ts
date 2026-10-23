export const NV_AUTH_TOKEN_KEY = 'token';

const LEGACY_KEYS = [
  'nyv_auth_token',
  'nyv_token',
  'authToken',
  'access_token',
] as const;

export function getAuthToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    const v = window.localStorage.getItem(NV_AUTH_TOKEN_KEY);
    if (v) return v;
    for (const k of LEGACY_KEYS) {
      const lv = window.localStorage.getItem(k);
      if (lv) return lv;
    }
  } catch {
  }
  return '';
}

export function getAuthHeader(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
