/**
 * useJrxClient — React hook for JrxClient instance management
 * @version 3.1.2
 */
import { useRef, useCallback, useState } from 'react';
import type { JrxJurisdiction } from '@jurexio/types';

export interface JrxClientConfig {
  apiKey?: string;
  baseUrl?: string;
  jurisdiction?: JrxJurisdiction;
  timeout?: number;
  orgId?: string;
}

export interface UseJrxClientReturn {
  isReady: boolean;
  config: JrxClientConfig | null;
  baseUrl: string;
  authHeaders: Record<string, string>;
  initialize: (config: JrxClientConfig) => void;
  reset: () => void;
  getHeaders: () => Record<string, string>;
}

export function useJrxClient(initialConfig?: JrxClientConfig): UseJrxClientReturn {
  const [isReady, setIsReady] = useState(!!initialConfig);
  const configRef = useRef<JrxClientConfig | null>(initialConfig ?? null);

  const initialize = useCallback((config: JrxClientConfig) => {
    configRef.current = config;
    setIsReady(true);
  }, []);

  const reset = useCallback(() => {
    configRef.current = null;
    setIsReady(false);
  }, []);

  const getHeaders = useCallback((): Record<string, string> => {
    const cfg = configRef.current;
    if (!cfg) return {};
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    if (cfg.jurisdiction) headers['X-JRX-Jurisdiction'] = cfg.jurisdiction;
    if (cfg.orgId) headers['X-Org-ID'] = cfg.orgId;
    return headers;
  }, []);

  const baseUrl = configRef.current?.baseUrl || '';
  const authHeaders = getHeaders();

  return {
    isReady,
    config: configRef.current,
    baseUrl,
    authHeaders,
    initialize,
    reset,
    getHeaders,
  };
}
