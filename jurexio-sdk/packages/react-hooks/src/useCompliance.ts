import { useState, useCallback } from 'react';
import { useJrxClient } from './useJrxClient.js';

export interface UseComplianceReturn {
  loading: boolean;
  error: string | null;
  getEuComplianceReport: () => Promise<any>;
  getBiasAudit: (agentId: string) => Promise<any>;
}

export function useCompliance(): UseComplianceReturn {
  const { authHeaders, baseUrl } = useJrxClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callApi = useCallback(async (endpoint: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/compliance/${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      });
      if (!res.ok) throw new Error(`Compliance API error: ${res.status}`);
      const data = await res.json();
      return data.data;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authHeaders, baseUrl]);

  return {
    loading,
    error,
    getEuComplianceReport: () => callApi('eu-ai-act/report'),
    getBiasAudit: (agentId) => callApi(`bias-audit/${agentId}`),
  };
}
