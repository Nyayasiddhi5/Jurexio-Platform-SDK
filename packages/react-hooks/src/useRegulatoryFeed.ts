import { useState, useCallback } from 'react';
import { useJrxClient } from './useJrxClient.js';
import type { JrxRegulatoryDigest } from '@jurexio/types';

export interface UseRegulatoryFeedReturn {
  loading: boolean;
  error: string | null;
  digest: JrxRegulatoryDigest | null;
  fetchFeed: (jurisdiction: string, limit?: number) => Promise<JrxRegulatoryDigest>;
}

export function useRegulatoryFeed(): UseRegulatoryFeedReturn {
  const { authHeaders, baseUrl } = useJrxClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<JrxRegulatoryDigest | null>(null);

  const fetchFeed = useCallback(async (jurisdiction: string, limit?: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ jurisdiction, limit: String(limit || 50) });
      const res = await fetch(`${baseUrl}/api/jrx/intelligence/regulatory-feed?${params.toString()}`, {
        method: 'GET',
        headers: { ...authHeaders },
      });
      if (!res.ok) throw new Error(`Regulatory feed error: ${res.status}`);
      const data = await res.json();
      setDigest(data.data);
      return data.data;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authHeaders, baseUrl]);

  return { loading, error, digest, fetchFeed };
}
