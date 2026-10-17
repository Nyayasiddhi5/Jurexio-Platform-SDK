import { useState, useCallback } from 'react';
import { useNyvClient } from './useNyvClient.js';
import type { NyvAmendmentImpactResult } from '@jurexio/types';

export interface UseAmendmentImpactReturn {
  loading: boolean;
  error: string | null;
  result: NyvAmendmentImpactResult | null;
  analyze: (amendmentId: string, jurisdiction: string) => Promise<NyvAmendmentImpactResult>;
}

export function useAmendmentImpact(): UseAmendmentImpactReturn {
  const { authHeaders, baseUrl } = useNyvClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NyvAmendmentImpactResult | null>(null);

  const analyze = useCallback(async (amendmentId: string, jurisdiction: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/intelligence/amendment-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ amendmentId, jurisdiction }),
      });
      if (!res.ok) throw new Error(`Amendment impact error: ${res.status}`);
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

  return { loading, error, result, analyze };
}
