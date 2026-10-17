import { useState, useCallback } from 'react';
import { useJrxClient } from './useJrxClient.js';
import type { JrxLimitationResult, JrxChecklistItem } from '@jurexio/types';

export interface UseTimelineReturn {
  loading: boolean;
  error: string | null;
  limitation: JrxLimitationResult | null;
  checklist: JrxChecklistItem[];
  checkLimitation: (sectionId: string, jurisdiction: string, eventDate?: string) => Promise<JrxLimitationResult>;
  getChecklist: (matterId: string, jurisdiction: string) => Promise<JrxChecklistItem[]>;
}

export function useTimeline(): UseTimelineReturn {
  const { authHeaders, baseUrl } = useJrxClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitation, setLimitation] = useState<JrxLimitationResult | null>(null);
  const [checklist, setChecklist] = useState<JrxChecklistItem[]>([]);

  const callApi = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/jrx-legal-tools/timeline/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Timeline API error: ${res.status}`);
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

  const checkLimitation = useCallback(async (sectionId: string, jurisdiction: string, eventDate?: string) => {
    const result = await callApi('limitation', { sectionId, jurisdiction, eventDate });
    setLimitation(result);
    return result;
  }, [callApi]);

  const getChecklist = useCallback(async (matterId: string, jurisdiction: string) => {
    const result = await callApi('checklist', { matterId, jurisdiction });
    setChecklist(result);
    return result;
  }, [callApi]);

  return { loading, error, limitation, checklist, checkLimitation, getChecklist };
}
