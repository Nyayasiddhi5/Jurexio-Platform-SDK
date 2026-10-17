import { useState, useCallback } from 'react';
import { useJrxClient } from './useJrxClient.js';
import type {
  JrxPrecedentSearchResult,
  JrxRegulatoryDigest,
  JrxComplianceCalendar,
  JrxContractAnalysis,
  JrxReadabilityScore,
  JrxLegalNerResult,
} from '@jurexio/types';

export interface UseIntelligenceReturn {
  loading: boolean;
  error: string | null;
  findPrecedents: (caseDescription: string, jurisdiction: string) => Promise<JrxPrecedentSearchResult>;
  getRegulatoryDigest: (jurisdiction: string, days?: number) => Promise<JrxRegulatoryDigest>;
  getComplianceCalendar: (jurisdiction: string) => Promise<JrxComplianceCalendar>;
  analyzeContract: (text: string, jurisdiction: string) => Promise<JrxContractAnalysis>;
  scoreReadability: (text: string) => Promise<JrxReadabilityScore>;
  extractEntities: (text: string, jurisdiction: string) => Promise<JrxLegalNerResult>;
}

export function useIntelligence(): UseIntelligenceReturn {
  const { authHeaders, baseUrl } = useJrxClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callApi = useCallback(async (endpoint: string, body?: Record<string, unknown>, method = 'POST') => {
    setLoading(true);
    setError(null);
    try {
      const url = `${baseUrl}/api/jrx/intelligence/${endpoint}`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: method !== 'GET' ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`Intelligence API error: ${res.status}`);
      const json = await res.json();
      return json.data ?? json;
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
    findPrecedents: (desc, j) => callApi('precedent-similarity', { caseDescription: desc, jurisdiction: j }),
    getRegulatoryDigest: (j, days) => callApi('regulatory-digest', { jurisdiction: j, days: days || 30 }),
    getComplianceCalendar: (j) => callApi(`compliance-calendar?jurisdiction=${j}`, undefined, 'GET'),
    analyzeContract: (text, j) => callApi('contract-analysis', { text, jurisdiction: j }),
    scoreReadability: (text) => callApi('readability', { text }),
    extractEntities: (text, j) => callApi('legal-ner', { text, jurisdiction: j }),
  };
}
