import { useState, useCallback } from 'react';
import { useJrxClient } from './useJrxClient.js';
import type { JrxConflictDetectResult } from '@jurexio/types';

export interface UseConflictDetectorReturn {
  loading: boolean;
  error: string | null;
  result: JrxConflictDetectResult | null;
  detect: (parties: { name: string; role: string }[], matterId?: string) => Promise<JrxConflictDetectResult>;
}

export function useConflictDetector(): UseConflictDetectorReturn {
  const { authHeaders, baseUrl } = useJrxClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JrxConflictDetectResult | null>(null);

  const detect = useCallback(async (parties: { name: string; role: string }[], matterId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/intelligence/conflict-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ parties, matterId }),
      });
      if (!res.ok) throw new Error(`Conflict detect error: ${res.status}`);
      const data = await res.json();
      setResult(data.data);
      return data.data;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authHeaders, baseUrl]);

  return { loading, error, result, detect };
}
