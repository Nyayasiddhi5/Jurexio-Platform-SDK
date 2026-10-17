const KEY = 'nv_legal_last_runs';
const MAX = 12;

export interface LegalLastRun {
  requestId: string;
  source: string;
  ts: number;
}

export function rememberLegalRun(requestId: string, source: string): void {
  if (typeof window === 'undefined' || !requestId) return;
  try {
    const prev = listLegalLastRuns().filter((r) => r.requestId !== requestId);
    const next = [{ requestId, source, ts: Date.now() }, ...prev].slice(0, MAX);
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function listLegalLastRuns(): LegalLastRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
