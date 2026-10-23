import { useState, useCallback } from 'react';
import { useJrxClient } from './useJrxClient.js';

export interface UseAgentTestingReturn {
  loading: boolean;
  error: string | null;
  runOracleTests: (jurisdiction: string, agentId?: string) => Promise<any>;
  runAdversarialTests: (agentId?: string) => Promise<any>;
  evaluateWithJudge: (response: string, query: string, jurisdiction: string, domain: string) => Promise<any>;
  generateScorecard: (jurisdiction: string) => Promise<any>;
}

export function useAgentTesting(): UseAgentTestingReturn {
  const { authHeaders, baseUrl } = useJrxClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callApi = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/testing/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Testing API error: ${res.status}`);
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
    runOracleTests: (j, agentId) => callApi('oracle-tests', { jurisdiction: j, agentId }),
    runAdversarialTests: (agentId) => callApi('adversarial-tests', { agentId }),
    evaluateWithJudge: (response, query, jurisdiction, domain) =>
      callApi('llm-judge', { response, query, jurisdiction, domain }),
    generateScorecard: (j) => callApi('scorecard', { jurisdiction: j }),
  };
}
