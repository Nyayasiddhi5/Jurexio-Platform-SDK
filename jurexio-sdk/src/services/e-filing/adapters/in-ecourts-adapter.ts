import type { CourtFiling } from '../e-filing-service.js';
import type { EFilingAdapterResult, EFilingCourtAdapter } from './types.js';

/** India eCourts / NJDG e-filing pilot. */
export class InEcourtsEFilingAdapter implements EFilingCourtAdapter {
  jurisdiction = 'IN' as const;

  async submit(_filing: CourtFiling): Promise<EFilingAdapterResult> {
    if (process.env.JRX_IN_ECOURTS_ENABLED !== '1') {
      return {
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'India eCourts adapter not enabled. Set JRX_IN_ECOURTS_ENABLED=1.',
        roadmap: 'documents/working/JRX-JURISDICTION-TEMPLATE-PACKS.md#phase-c-in-filing',
      };
    }
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message: 'eCourts integration stub — connect portal API in Phase C pilot.',
    };
  }
}
