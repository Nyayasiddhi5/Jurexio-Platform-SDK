/**
 * JRX e-filing court portal adapters (Phase C — real integrations plug in here).
 */
import type { CourtFiling, FilingJurisdiction } from '../e-filing-service.js';

export type EFilingAdapterResult =
  | { ok: true; trackingNumber: string; portalRef?: string }
  | { ok: false; code: 'NOT_CONFIGURED' | 'PORTAL_ERROR'; message: string; roadmap?: string };

export interface EFilingCourtAdapter {
  jurisdiction: FilingJurisdiction;
  submit(filing: CourtFiling): Promise<EFilingAdapterResult>;
}
