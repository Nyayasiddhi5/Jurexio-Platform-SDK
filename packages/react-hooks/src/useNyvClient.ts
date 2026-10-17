/**
 * useNyvClient — React hook for NyvClient instance management
 * @version 3.1.2
 */
import { useRef, useCallback, useState } from 'react';
import type { NyvJurisdiction } from '@jurexio/types';

export interface NyvClientConfig {
  apiKey?: string;
  baseUrl?: string;
  jurisdiction?: NyvJurisdiction;
  timeout?: number;
  orgId?: string;
}

export interface UseNyvClientReturn {
  isReady: boolean;
  config: NyvClientConfig | null;
  baseUrl: string;
  authHeaders: Record<string, string>;
  initialize: (config: NyvClientConfig) => void;
  reset: () => void;
  getHeaders: () => Record<string, string>;
}

export function useNyvClient(initialConfig?: NyvClientConfig): UseNyvClientReturn {
  const [isReady, setIsReady] = useState(!!initialConfig);
  const configRef = useRef<NyvClientConfig | null>(initialConfig ?? null);

  const initialize = useCallback((config: NyvClientConfig) => {
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
    if (cfg.jurisdiction) headers['X-NYV-Jurisdiction'] = cfg.jurisdiction;
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
