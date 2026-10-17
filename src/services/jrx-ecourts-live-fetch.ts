/**
 * NV-ECOURTS-LIVE-FETCH-001 — Tier-3 live eCourts attempt for unified cascade.
 * Uses existing jrx-ecourts-client (NIC API) when JRX_ECOURTS_API_KEY is set.
 * Honesty: claimEcourts stays false; sourcesTried records attempt outcome.
 */
import { createLogger } from '../utils/logger.js';
import type { CnrDocument, CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import { getCaseStatus, getCaseOrders, type CaseStatus } from './jrx-ecourts-client.js';
import { normalizeCnrInput } from './jrx-case-api-adapter.js';
import {
  attemptEcourtsIndiaLiveFetch,
  ECOURTSINDIA_LIVE_ATTEMPTED,
} from './jrx-ecourtsindia-live-fetch.js';
import { resolveEcourtsIndiaApiKey } from './jrx-ecourtsindia-partner-client.js';

const logger = createLogger('./jrx-ecourts-live-fetch');

export const ECOURTS_LIVE_SOURCE = 'ecourts_live';
export const ECOURTS_LIVE_ATTEMPTED = 'ecourts_live_attempted';

function fv(value: unknown, source: string, confidence: number) {
  return { value, source, confidence };
}

function mapEcourtsStatusToResolve(
  status: CaseStatus,
  orders: CnrDocument[],
  latencyMs: number,
  attemptedTag: string,
): CnrResolveData {
  const cnr = status.cnrNumber;
  const source = ECOURTS_LIVE_SOURCE;
  return {
    cnr,
    status: 'found',
    matchType: 'live_ecourts',
    source,
    sourcesTried: [attemptedTag, source],
    confidence: 0.75,
    claimEcourts: false,
    validation: 'ok',
    ui: {
      badge: 'Suggested · Judgment corpus',
      subtitle: 'Live eCourts NIC API — running-matter metadata (not verified docket claim)',
    },
    fields: {
      courtName: fv(status.courtName || null, source, status.courtName ? 0.8 : 0),
      caseType: fv(status.caseType || null, source, status.caseType ? 0.75 : 0),
      caseNo: fv(status.registrationNumber || status.filingNumber || null, source, 0.75),
      filingDate: fv(status.filingDate || null, source, status.filingDate ? 0.75 : 0),
      caseStatus: fv(status.caseStatus || null, source, status.caseStatus ? 0.8 : 0),
      petitioner: fv(status.petitionerName || null, source, status.petitionerName ? 0.8 : 0),
      respondent: fv(status.respondentName || null, source, status.respondentName ? 0.8 : 0),
      nextHearingDate: fv(status.nextHearingDate || null, source, status.nextHearingDate ? 0.7 : 0),
      actSection: fv(status.actSection || null, source, status.actSection ? 0.7 : 0),
      hearings: {
        value: status.hearingHistory.map((h) => ({
          date: h.hearingDate || null,
          purpose: h.purpose || null,
          judge: null,
          status: h.nextDate || h.businessOnDate || null,
          source,
          confidence: 0.7,
        })),
        source,
        confidence: status.hearingHistory.length > 0 ? 0.7 : 0,
      },
    },
    documents: orders,
    candidates: [],
    meta: {
      source,
      latencyMs,
      tier: 'ecourts_live',
      extra: {
        ecourtsConfigured: true,
        note: 'NIC session/API key required; claimEcourts remains false per partner contract',
      },
    },
  };
}

function ordersToDocuments(cnr: string, raw: Awaited<ReturnType<typeof getCaseOrders>>): CnrDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o) => o.orderPdfUrl || o.orderDetails)
    .map((o, idx) => ({
      id: `ecourts_order_${cnr}_${idx}`,
      kind: 'order',
      title: o.orderDetails?.slice(0, 120) || `Order ${o.orderDate}`,
      decisionDate: o.orderDate || null,
      url: o.orderPdfUrl ?? null,
      pdfUrlKind: o.orderPdfUrl ? 'external' : undefined,
      sourceArchive: ECOURTS_LIVE_SOURCE,
    }));
}

export type EcourtsLiveAttempt =
  | { kind: 'found'; data: CnrResolveData }
  | { kind: 'attempted'; tag: typeof ECOURTS_LIVE_ATTEMPTED; reason: string }
  | { kind: 'skipped' };

/** Structured live eCourts attempt — never sets claimEcourts true. */
export async function attemptEcourtsLiveFetch(input: {
  cnr?: string;
  diaryNumber?: string;
}): Promise<EcourtsLiveAttempt> {
  const cnr = input.cnr ? normalizeCnrInput(input.cnr) : '';
  if (!cnr) {
    return { kind: 'skipped' };
  }

  if (resolveEcourtsIndiaApiKey().length > 0) {
    const india = await attemptEcourtsIndiaLiveFetch({ cnr });
    if (india.kind === 'found') {
      return { kind: 'found', data: india.data };
    }
    if (india.kind === 'attempted') {
      return {
        kind: 'attempted',
        tag: ECOURTSINDIA_LIVE_ATTEMPTED,
        reason: india.reason,
      };
    }
  }

  const t0 = Date.now();
  const apiKeyLen = (process.env.JRX_ECOURTS_API_KEY ?? '').trim().length;
  const nicKey = (process.env.JRX_ECOURTS_API_KEY ?? '').trim();
  if (apiKeyLen === 0 || nicKey.startsWith('eci_live_')) {
    logger.info('[CNR] eCourts live fetch: no NIC key (eCourtsIndia-only or unconfigured)', {
      cnrLen: cnr.length,
      indiaKeyLen: resolveEcourtsIndiaApiKey().length,
    });
    return {
      kind: 'attempted',
      tag: ECOURTS_LIVE_ATTEMPTED,
      reason: 'NIC JRX_ECOURTS_API_KEY not configured (eCourtsIndia attempted when key present)',
    };
  }

  const statusResult = await getCaseStatus(cnr);
  if ('error' in statusResult) {
    logger.warn('[CNR] eCourts live upstream miss', {
      cnrLen: cnr.length,
      errorLen: statusResult.error.length,
    });
    return {
      kind: 'attempted',
      tag: ECOURTS_LIVE_ATTEMPTED,
      reason: statusResult.error.slice(0, 120),
    };
  }

  const ordersRaw = await getCaseOrders(cnr);
  const orders = ordersToDocuments(cnr, ordersRaw);
  const latencyMs = Date.now() - t0;

  if (!statusResult.petitionerName && !statusResult.respondentName && !statusResult.caseStatus) {
    return {
      kind: 'attempted',
      tag: ECOURTS_LIVE_ATTEMPTED,
      reason: 'NIC API returned empty case payload',
    };
  }

  return {
    kind: 'found',
    data: mapEcourtsStatusToResolve(statusResult, orders, latencyMs, ECOURTS_LIVE_ATTEMPTED),
  };
}
