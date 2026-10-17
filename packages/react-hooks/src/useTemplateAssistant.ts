import { useState, useCallback } from 'react';
import { useNyvClient } from './useNyvClient.js';
import type { NyvTemplateListItem, NyvTemplateGenerateResult, NyvTemplateFillSession } from '@jurexio/types';

export interface UseTemplateAssistantReturn {
  loading: boolean;
  error: string | null;
  templates: NyvTemplateListItem[];
  listTemplates: (jurisdiction: string, category?: string) => Promise<NyvTemplateListItem[]>;
  generate: (templateId: string, fields: Record<string, string>, jurisdiction: string) => Promise<NyvTemplateGenerateResult>;
  startFillSession: (templateId: string, jurisdiction: string) => Promise<NyvTemplateFillSession>;
}

export function useTemplateAssistant(): UseTemplateAssistantReturn {
  const { authHeaders, baseUrl } = useNyvClient({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<NyvTemplateListItem[]>([]);

  const callApi = useCallback(async (endpoint: string, body?: Record<string, unknown>, method = 'POST') => {
    setLoading(true);
    setError(null);
    try {
      const url = `${baseUrl}/api/jrx/nyaya-tools/${endpoint}`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: method !== 'GET' ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`Template API error: ${res.status}`);
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

  const listTemplates = useCallback(async (jurisdiction: string, category?: string) => {
    const params = new URLSearchParams({ jurisdiction });
    if (category) params.set('category', category);
    const result = await callApi(`templates/list?${params.toString()}`, undefined, 'GET');
    setTemplates(result);
    return result;
  }, [callApi]);

  const generate = useCallback(async (templateId: string, fields: Record<string, string>, jurisdiction: string) => {
    return callApi('templates/generate', { templateId, fields, jurisdiction });
  }, [callApi]);

  const startFillSession = useCallback(async (templateId: string, jurisdiction: string) => {
    return callApi('templates/fill-session', { templateId, jurisdiction });
  }, [callApi]);

  return { loading, error, templates, listTemplates, generate, startFillSession };
}
