import { useState, useCallback } from 'react';
import { useNyvClient } from './useNyvClient.js';
import type { NyvForensicVerifyResult } from '@jurexio/types';

export interface UseForensicVerifierReturn {
  loading: boolean;
  error: string | null;
  result: NyvForensicVerifyResult | null;
  verify: (documentId: string) => Promise<NyvForensicVerifyResult>;
}

export function useForensicVerifier(): UseForensicVerifierReturn {
  const { authHeaders, baseUrl } = useNyvClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NyvForensicVerifyResult | null>(null);

  const verify = useCallback(async (documentId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/nyaya-tools/forensic/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) throw new Error(`Forensic verify error: ${res.status}`);
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

  return { loading, error, result, verify };
}
