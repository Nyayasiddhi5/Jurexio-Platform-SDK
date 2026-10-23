import { useState, useCallback } from 'react';
import { useJrxClient } from './useJrxClient.js';
import type { JrxPrecedentSearchResult } from '@jurexio/types';

export interface UsePrecedentSimilarityReturn {
  loading: boolean;
  error: string | null;
  result: JrxPrecedentSearchResult | null;
  search: (caseDescription: string, jurisdiction: string, options?: { maxResults?: number; crossJurisdiction?: boolean }) => Promise<JrxPrecedentSearchResult>;
}

export function usePrecedentSimilarity(): UsePrecedentSimilarityReturn {
  const { authHeaders, baseUrl } = useJrxClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JrxPrecedentSearchResult | null>(null);

  const search = useCallback(async (
    caseDescription: string,
    jurisdiction: string,
    options?: { maxResults?: number; crossJurisdiction?: boolean }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/intelligence/precedent-similarity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ caseDescription, jurisdiction, ...options }),
      });
      if (!res.ok) throw new Error(`Precedent search error: ${res.status}`);
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

  return { loading, error, result, search };
}
