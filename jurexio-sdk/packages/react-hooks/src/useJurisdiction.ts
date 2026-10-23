/**
 * useJurisdiction — React hook for multi-jurisdiction context management
 * @version 3.1.2
 */
import { useState, useCallback, useMemo } from 'react';
import type { JrxJurisdiction } from '@jurexio/types';

export interface JurisdictionInfo {
  code: JrxJurisdiction;
  name: string;
  currency: string;
  taxSystem: string;
  courtSystem: string;
  language: string;
  flag: string;
}

const JURISDICTION_MAP: Record<JrxJurisdiction, JurisdictionInfo> = {
  IN: { code: 'IN', name: 'India', currency: 'INR', taxSystem: 'GST', courtSystem: 'Supreme Court / High Courts / District Courts', language: 'hi', flag: '🇮🇳' },
  UK: { code: 'UK', name: 'United Kingdom', currency: 'GBP', taxSystem: 'VAT', courtSystem: 'Supreme Court / Court of Appeal', language: 'en', flag: '🇬🇧' },
  US: { code: 'US', name: 'United States', currency: 'USD', taxSystem: 'Sales Tax', courtSystem: 'SCOTUS / Circuit Courts / District Courts', language: 'en', flag: '🇺🇸' },
  EU: { code: 'EU', name: 'European Union', currency: 'EUR', taxSystem: 'VAT', courtSystem: 'CJEU / National Courts', language: 'en', flag: '🇪🇺' },
  GC: { code: 'GC', name: 'Gulf Cooperation Council', currency: 'AED', taxSystem: 'VAT (5%)', courtSystem: 'DIFC Courts / National Courts', language: 'ar', flag: '🌙' },
  SG: { code: 'SG', name: 'Singapore', currency: 'SGD', taxSystem: 'GST', courtSystem: 'Supreme Court / State Courts', language: 'en', flag: '🇸🇬' },
};

export interface UseJurisdictionReturn {
  jurisdiction: JrxJurisdiction;
  info: JurisdictionInfo;
  allJurisdictions: JurisdictionInfo[];
  setJurisdiction: (code: JrxJurisdiction) => void;
  isIndia: boolean;
  requiresGST: boolean;
  supportedPatterns: string[];
}

const INDIA_PATTERNS = ['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12','P13','P14','P15','P16','P17','P18','P19','P20','P21','P22'];
const INTL_PATTERNS  = ['P01','P02','P03','P06','P07','P08','P09','P11','P12','P14','P20','P21'];

export function useJurisdiction(defaultJurisdiction: JrxJurisdiction = 'IN'): UseJurisdictionReturn {
  const [jurisdiction, setJurisdiction] = useState<JrxJurisdiction>(defaultJurisdiction);

  const info = useMemo(() => JURISDICTION_MAP[jurisdiction], [jurisdiction]);
  const allJurisdictions = useMemo(() => Object.values(JURISDICTION_MAP), []);
  const isIndia = jurisdiction === 'IN';
  const requiresGST = jurisdiction === 'IN' || jurisdiction === 'SG';
  const supportedPatterns = isIndia ? INDIA_PATTERNS : INTL_PATTERNS;

  const handleSet = useCallback((code: JrxJurisdiction) => {
    setJurisdiction(code);
  }, []);

  return { jurisdiction, info, allJurisdictions, setJurisdiction: handleSet, isIndia, requiresGST, supportedPatterns };
}
