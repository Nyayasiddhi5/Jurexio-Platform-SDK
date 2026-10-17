import { QueryClient } from '@tanstack/react-query';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { clearAuthSession } from '@/lib/auth-session';

const API_BASE_URL = '';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const url = queryKey[0] as string;
        return apiRequest(url, 'GET');
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error: any) => {
        // Never hammer the gateway on client-class errors. 429 (rate limit) is
        // the source of the HITL polling storm — back off instead of retrying.
        const status = error?.status ?? error?.response?.status;
        if (status === 401 || status === 403 || status === 404 || status === 429) return false;
        if (typeof status === 'number' && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      // Respect Retry-After on 429/503; otherwise capped exponential backoff.
      retryDelay: (attemptIndex, error: any) => {
        const retryAfterMs = Number(error?.retryAfterMs);
        if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.min(retryAfterMs, 60_000);
        return Math.min(1000 * 2 ** attemptIndex, 30_000);
      },
    },
    mutations: {
      onError: (error: any) => {
        console.error('Mutation error:', error);
      },
    },
  },
});

/**
 * apiRequest — accepts BOTH legacy signatures used across the codebase:
 *   apiRequest(url, method?, body?)         — canonical (this file's original)
 *   apiRequest(method, url, body?)          — used by 30+ pages (e.g. hash-chain-audit, llm-priority)
 *
 * Returns: an ApiResult object that:
 *   - is the unwrapped {success,data}.data (or raw json) when read directly
 *   - exposes `.ok`, `.status`, `.json()` so legacy `.then(r => r.json())` callers still work
 *   - throws on non-2xx (existing behaviour preserved for queryClient default queryFn)
 */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
  json(): Promise<T>;
}

function makeResult<T>(ok: boolean, status: number, data: T): ApiResult<T> & T {
  // Build a callable façade: spread data so direct destructuring works,
  // and attach Response-like fields for legacy `.then(r => r.json())` call sites.
  const base: any = (data && typeof data === 'object' && !Array.isArray(data))
    ? { ...data }
    : { data };
  Object.defineProperty(base, 'ok', { value: ok, enumerable: false });
  Object.defineProperty(base, 'status', { value: status, enumerable: false });
  Object.defineProperty(base, 'data', { value: data, enumerable: false, configurable: true });
  Object.defineProperty(base, 'json', { value: async () => data, enumerable: false });
  return base as ApiResult<T> & T;
}

export async function apiRequest(
  arg1: string,
  arg2?: string | any,
  arg3?: any,
): Promise<any> {
  // Three accepted call patterns across the codebase:
  //   apiRequest(url, method?, body?)                       — canonical
  //   apiRequest(method, url, body?)                        — used by 30+ pages
  //   apiRequest(url, { method, body, headers, ... })       — used by 50+ components/modals
  let url: string;
  let method: string;
  let body: any;
  let extraHeaders: Record<string, string> | undefined;

  if (typeof arg1 === 'string' && HTTP_METHODS.has(arg1.toUpperCase()) && typeof arg2 === 'string') {
    // (method, url, body)
    method = arg1.toUpperCase();
    url = arg2;
    body = arg3;
  } else if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object' && !Array.isArray(arg2)) {
    // (url, options) — object-options form
    url = arg1;
    const opts = arg2 as { method?: string; body?: any; headers?: Record<string, string> };
    method = (opts.method || 'GET').toUpperCase();
    body = opts.body;
    extraHeaders = opts.headers;
  } else {
    // (url, method?, body?)
    url = arg1;
    method = typeof arg2 === 'string' ? arg2.toUpperCase() : 'GET';
    body = arg3;
  }

  const fullUrl = `${API_BASE_URL}${url}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (extraHeaders) Object.assign(headers, extraHeaders);

  const options: RequestInit = { method, headers, credentials: 'include' };
  if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(fullUrl, options);

  if (response.status === 401 && typeof window !== 'undefined') {
    // Stale session — clear local auth so ProtectedRoute can bounce to login.
    try { clearAuthSession(); } catch { /* ignore */ }
  }

  if (!response.ok) {
    let errorText = '';
    try { errorText = await response.text(); } catch { /* ignore */ }
    const err: any = new Error(`${response.status}: ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
    err.status = response.status;
    err.ok = false;
    err.response = response;
    // Surface Retry-After (seconds or HTTP-date) so react-query's retryDelay can honour it.
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const asSeconds = Number(retryAfter);
      err.retryAfterMs = Number.isFinite(asSeconds)
        ? asSeconds * 1000
        : Math.max(0, new Date(retryAfter).getTime() - Date.now());
    }
    throw err;
  }

  let json: any = null;
  try { json = await response.json(); } catch { json = null; }

  // Auto-unwrap Jurexio { success, data } envelope
  let payload: any = json;
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    if (!json.success) {
      const err: any = new Error(json.error || json.message || 'Request failed');
      err.status = response.status;
      throw err;
    }
    payload = json.data;
  }

  return makeResult(true, response.status, payload);
}

export default apiRequest;