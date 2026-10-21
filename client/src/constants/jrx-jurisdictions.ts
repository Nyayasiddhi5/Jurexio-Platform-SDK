/** Re-export six-jurisdiction catalog for console pages. */
export {
  JRX_JURISDICTION_CATALOG,
  JRX_JURISDICTION_DISPLAY_ORDER,
  JRX_DEFAULT_PRIMARY_JURISDICTIONS,
  JRX_JURISDICTION_ORDER_LABEL,
  compareJurisdictionCodes,
  normalizeJurisdictionCode,
  sortJurisdictionCodes,
} from '@shared/jrx-jurisdiction-catalog';

/** Legacy picker lists (GCC normalized to GC in UI). */
export const JRX_JURISDICTION_PICKER_CODES = ['US', 'IN', 'UK', 'EU', 'SG', 'GC'] as const;
