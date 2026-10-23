/**
 * Shared jurisdiction filter for Operations Hub tabs (Task #302).
 * Persists selection in localStorage so tab switches keep the scope.
 */
import { useState, useEffect, useCallback } from 'react';

const KEY = 'nv:ops:jurisdiction';
const OPTIONS = ['ALL', 'IN', 'US', 'UK', 'EU', 'GC', 'SG'] as const;
export type OpsJurisdiction = (typeof OPTIONS)[number];

export function useOpsJurisdiction() {
  const [jurisdiction, setJurisdiction] = useState<OpsJurisdiction>(() => {
    if (typeof window === 'undefined') return 'ALL';
    const v = window.localStorage.getItem(KEY);
    return (OPTIONS as readonly string[]).includes(v ?? '') ? (v as OpsJurisdiction) : 'ALL';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, jurisdiction);
  }, [jurisdiction]);

  const JurisdictionFilter = useCallback(() => (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Jurisdiction:</span>
      <select
        data-testid="ops-jurisdiction-filter"
        className="border rounded px-2 py-1 text-xs"
        value={jurisdiction}
        onChange={(e) => setJurisdiction(e.target.value as OpsJurisdiction)}
      >
        {OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  ), [jurisdiction]);

  return { jurisdiction, setJurisdiction, JurisdictionFilter };
}
