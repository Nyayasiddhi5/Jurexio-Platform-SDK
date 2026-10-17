import { useState, useCallback } from 'react';
import { useNyvClient } from './useNyvClient.js';
import type { NyvPrecedentSearchResult } from '@jurexio/types';

export interface UsePrecedentSimilarityReturn {
  loading: boolean;
  error: string | null;
  result: NyvPrecedentSearchResult | null;
  search: (caseDescription: string, jurisdiction: string, options?: { maxResults?: number; crossJurisdiction?: boolean }) => Promise<NyvPrecedentSearchResult>;
}

export function usePrecedentSimilarity(): UsePrecedentSimilarityReturn {
  const { authHeaders, baseUrl } = useNyvClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NyvPrecedentSearchResult | null>(null);

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
