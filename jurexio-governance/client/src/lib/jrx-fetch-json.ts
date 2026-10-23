import { clearAuthSession } from '@/lib/auth-session';
import { getAuthHeader } from '@/lib/jrx-auth-token';

/**
 * Authenticated JSON fetch for Console pages.
 * Sends Bearer JWT (localStorage) + cookies — required for routes behind
 * `authenticateToken` that do not accept cookie-only sessions.
 */
export async function nvFetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...getAuthHeader(),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && typeof window !== 'undefined') {
    try {
      clearAuthSession();
    } catch {
      /* ignore */
    }
  }

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
