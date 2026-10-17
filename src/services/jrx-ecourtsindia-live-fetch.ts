/**
 * NV-ECOURTSINDIA-LIVE-FETCH-001 — Tier-3c eCourtsIndia partner → CnrResolveData.
 * Honesty: claimEcourts remains false (third-party indexed live pull, not NIC attestation).
 */
import { createLogger } from '../utils/logger.js';
import type { CnrDocument, CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import { normalizeCnrInput } from './jrx-case-api-adapter.js';
import { getPartnerCaseByCnr } from './jrx-ecourtsindia-partner-client.js';

const logger = createLogger('./jrx-ecourtsindia-live-fetch');

export const ECOURTSINDIA_LIVE_SOURCE = 'ecourtsindia_live';
export const ECOURTSINDIA_LIVE_ATTEMPTED = 'ecourtsindia_live_attempted';

function fv(value: unknown, source: string, confidence: number) {
  return { value, source, confidence };
}

function joinNames(arr: unknown): string | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const parts = arr.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  return parts.length ? parts.join('; ') : null;
}

function mapIndiaCaseToResolve(
  cnr: string,
  courtCaseData: Record<string, unknown>,
  latencyMs: number,
): CnrResolveData {
  const source = ECOURTSINDIA_LIVE_SOURCE;
  const petitioners = joinNames(courtCaseData.petitioners);
  const respondents = joinNames(courtCaseData.respondents);
  const documents: CnrDocument[] = [];
  const orders = [
    ...(Array.isArray(courtCaseData.judgmentOrders) ? courtCaseData.judgmentOrders : []),
    ...(Array.isArray(courtCaseData.interimOrders) ? courtCaseData.interimOrders : []),
  ] as Array<Record<string, unknown>>;
  orders.forEach((o, idx) => {
    const orderUrl = typeof o.orderUrl === 'string' ? o.orderUrl : null;
    documents.push({
      id: `eci_order_${cnr}_${idx}`,
      kind: 'order',
      title: typeof o.orderType === 'string' ? o.orderType : `Order ${idx + 1}`,
      decisionDate: typeof o.orderDate === 'string' ? o.orderDate : null,
      url: orderUrl,
      pdfUrlKind: orderUrl ? 'external' : undefined,
      sourceArchive: source,
    });
  });

  return {
    cnr,
    status: 'found',
    matchType: 'live_ecourtsindia',
    source,
    sourcesTried: [ECOURTSINDIA_LIVE_ATTEMPTED, source],
    confidence: 0.78,
    claimEcourts: false,
    validation: 'ok',
    ui: {
      badge: 'Live · eCourtsIndia',
      subtitle: 'Partner live index — not official NIC docket attestation (claimEcourts false)',
    },
    fields: {
      courtName: fv(courtCaseData.courtName ?? null, source, courtCaseData.courtName ? 0.85 : 0),
      caseType: fv(courtCaseData.caseType ?? courtCaseData.caseTypeRaw ?? null, source, 0.8),
      caseNo: fv(courtCaseData.caseNumber ?? courtCaseData.filingNumber ?? null, source, 0.75),
      filingDate: fv(courtCaseData.filingDate ?? null, source, courtCaseData.filingDate ? 0.8 : 0),
      registrationDate: fv(courtCaseData.registrationDate ?? null, source, 0.75),
      caseStatus: fv(courtCaseData.caseStatus ?? null, source, courtCaseData.caseStatus ? 0.85 : 0),
      petitioner: fv(petitioners, source, petitioners ? 0.85 : 0),
      respondent: fv(respondents, source, respondents ? 0.85 : 0),
      nextHearingDate: fv(courtCaseData.nextHearingDate ?? null, source, 0.7),
      stateName: fv(courtCaseData.state ?? null, source, 0.7),
      districtName: fv(courtCaseData.district ?? null, source, 0.7),
      courtCode: fv(courtCaseData.courtCode ?? courtCaseData.cnrCourtCode ?? null, source, 0.75),
      complexCode: fv(courtCaseData.complexCode ?? courtCaseData.courtComplexCode ?? null, source, 0.75),
    },
    documents,
    candidates: [],
    meta: {
      source,
      latencyMs,
      tier: 'ecourtsindia_live',
      extra: {
        provider: 'ecourtsindia.com',
        disposalType: courtCaseData.disposalType ?? null,
      },
    },
  };
}

export type EcourtsIndiaLiveAttempt =
  | { kind: 'found'; data: CnrResolveData }
  | { kind: 'attempted'; tag: typeof ECOURTSINDIA_LIVE_ATTEMPTED; reason: string }
  | { kind: 'skipped' };

export async function attemptEcourtsIndiaLiveFetch(input: {
  cnr?: string;
}): Promise<EcourtsIndiaLiveAttempt> {
  const cnr = input.cnr ? normalizeCnrInput(input.cnr) : '';
  if (!cnr) return { kind: 'skipped' };

  const t0 = Date.now();
  const result = await getPartnerCaseByCnr(cnr);
  if (!result.ok) {
    logger.info('[CNR] eCourtsIndia partner miss', { cnrLen: cnr.length, status: result.status });
    return {
      kind: 'attempted',
      tag: ECOURTSINDIA_LIVE_ATTEMPTED,
      reason: result.reason.slice(0, 120),
    };
  }

  const ccd = result.envelope.data?.courtCaseData;
  if (!ccd || typeof ccd !== 'object') {
    return {
      kind: 'attempted',
      tag: ECOURTSINDIA_LIVE_ATTEMPTED,
      reason: 'empty courtCaseData',
    };
  }

  const petitioners = joinNames((ccd as Record<string, unknown>).petitioners);
  const respondents = joinNames((ccd as Record<string, unknown>).respondents);
  const status = (ccd as Record<string, unknown>).caseStatus;
  if (!petitioners && !respondents && !status) {
    return {
      kind: 'attempted',
      tag: ECOURTSINDIA_LIVE_ATTEMPTED,
      reason: 'partner payload missing party/status fields',
    };
  }

  return {
    kind: 'found',
    data: mapIndiaCaseToResolve(cnr, ccd as Record<string, unknown>, Date.now() - t0),
  };
}
