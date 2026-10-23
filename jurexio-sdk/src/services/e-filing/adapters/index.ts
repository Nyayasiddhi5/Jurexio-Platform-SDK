import type { FilingJurisdiction } from '../e-filing-service.js';
import { InEcourtsEFilingAdapter } from './in-ecourts-adapter.js';
import { UsPacerEFilingAdapter } from './us-pacer-adapter.js';
import type { EFilingAdapterResult, EFilingCourtAdapter } from './types.js';
import type { CourtFiling } from '../e-filing-service.js';

const ADAPTERS: Partial<Record<FilingJurisdiction, EFilingCourtAdapter>> = {
  US: new UsPacerEFilingAdapter(),
  IN: new InEcourtsEFilingAdapter(),
};

export function getEFilingAdapter(jurisdiction: FilingJurisdiction): EFilingCourtAdapter | undefined {
  return ADAPTERS[jurisdiction];
}

export async function submitViaCourtAdapter(filing: CourtFiling): Promise<EFilingAdapterResult | null> {
  const adapter = getEFilingAdapter(filing.jurisdiction);
  if (!adapter) return null;
  return adapter.submit(filing);
}

export type { EFilingAdapterResult, EFilingCourtAdapter };
