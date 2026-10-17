import { useState, useCallback } from 'react';
import { useNyvClient } from './useNyvClient.js';
import type { NyvLimitationResult, NyvChecklistItem } from '@jurexio/types';

export interface UseTimelineReturn {
  loading: boolean;
  error: string | null;
  limitation: NyvLimitationResult | null;
  checklist: NyvChecklistItem[];
  checkLimitation: (sectionId: string, jurisdiction: string, eventDate?: string) => Promise<NyvLimitationResult>;
  getChecklist: (matterId: string, jurisdiction: string) => Promise<NyvChecklistItem[]>;
}

export function useTimeline(): UseTimelineReturn {
  const { authHeaders, baseUrl } = useNyvClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitation, setLimitation] = useState<NyvLimitationResult | null>(null);
  const [checklist, setChecklist] = useState<NyvChecklistItem[]>([]);

  const callApi = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/jrx/nyaya-tools/timeline/${endpoint}`, {
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
