import type { CourtFiling } from '../e-filing-service.js';
import type { EFilingAdapterResult, EFilingCourtAdapter } from './types.js';

/** US federal/state e-filing — PACER / CM/ECF pilot (credentials via env, not in repo). */
export class UsPacerEFilingAdapter implements EFilingCourtAdapter {
  jurisdiction = 'US' as const;

  async submit(_filing: CourtFiling): Promise<EFilingAdapterResult> {
    if (process.env.JRX_US_PACER_ENABLED !== '1') {
      return {
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'US PACER adapter not enabled. Set JRX_US_PACER_ENABLED=1 and configure court credentials.',
        roadmap: 'documents/working/JRX-JURISDICTION-TEMPLATE-PACKS.md#phase-c-us-filing',
      };
    }
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message: 'PACER integration stub — connect CM/ECF API in Phase C pilot.',
    };
  }
}
