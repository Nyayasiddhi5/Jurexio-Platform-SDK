/**
 * JRX six-jurisdiction catalog — display order, labels, workflow priority.
 * USA and India lead product workflows; then UK, EU, SG, GC.
 */
export const JRX_JURISDICTION_DISPLAY_ORDER = ['US', 'IN', 'UK', 'EU', 'SG', 'GC'] as const;

export type JrxJurisdictionCode = (typeof JRX_JURISDICTION_DISPLAY_ORDER)[number];

export const JRX_JURISDICTION_CATALOG: ReadonlyArray<{
  code: JrxJurisdictionCode;
  name: string;
  flag: string;
  workflowPriority: number;
}> = [
  { code: 'US', name: 'United States', flag: '🇺🇸', workflowPriority: 1 },
  { code: 'IN', name: 'India', flag: '🇮🇳', workflowPriority: 2 },
  { code: 'UK', name: 'United Kingdom', flag: '🇬🇧', workflowPriority: 3 },
  { code: 'EU', name: 'European Union', flag: '🇪🇺', workflowPriority: 4 },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', workflowPriority: 5 },
  { code: 'GC', name: 'GCC', flag: '🕌', workflowPriority: 6 },
];

export const JRX_DEFAULT_PRIMARY_JURISDICTIONS: JrxJurisdictionCode[] = ['US', 'IN'];

export const JRX_JURISDICTION_ORDER_LABEL = 'US · IN · UK · EU · SG · GC';

export function normalizeJurisdictionCode(code: string): string {
  const u = String(code || '').toUpperCase();
  if (u === 'GCC') return 'GC';
  if (u === 'USA') return 'US';
  return u;
}

export function jurisdictionDisplayRank(code: string): number {
  const n = normalizeJurisdictionCode(code);
  const idx = (JRX_JURISDICTION_DISPLAY_ORDER as readonly string[]).indexOf(n);
  return idx >= 0 ? idx : 999;
}

export function compareJurisdictionCodes(a: string, b: string): number {
  return jurisdictionDisplayRank(a) - jurisdictionDisplayRank(b);
}

export function sortJurisdictionCodes(codes: Iterable<string>): string[] {
  return [...new Set(Array.from(codes).map(normalizeJurisdictionCode))].sort(compareJurisdictionCodes);
}

export function sortJurisdictionCatalog<T extends { code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareJurisdictionCodes(a.code, b.code));
}
