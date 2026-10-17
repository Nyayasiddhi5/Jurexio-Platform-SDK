/**
 * NV-CNR-UNIFIED-CASCADE-001 — single entry resolve for CNR and diary identifiers.
 * Tier order (NSP default): nysapi case-api (Tier 1) → legacy NYV/NYS corpus (RDS/Athena/S3, Tier 2)
 * → eCourts NIC live (Tier 3, JRX_F_ECOURTS_LIVE_FETCH, GO-gated) → portal async (Tier 4b, off by default).
 * Honesty lock: claimEcourts stays false until live eCourts fetch succeeds (not implemented).
 */
import { createLogger } from '../utils/logger.js';
import {
  fetchLegacyCnrResolve,
  isCaseApiConfigured,
  isCaseApiCnrEnabled,
  lookupCnrViaCaseApi,
  lookupDiaryViaCaseApi,
  type CaseApiCourtLevel,
  type CaseApiCnrLookupResult,
} from './jrx-case-api-adapter.js';
import { isNysKnowledgeConfigured } from './jrx-nys-knowledge-client.js';
import type { CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import { attemptEcourtsLiveFetch } from './jrx-ecourts-live-fetch.js';
import {
  ECOURTS_PORTAL_ATTEMPTED,
  isEcourtsPortalFetchEnabled,
} from './jrx-ecourts-portal-fetch.js';
import { enqueueEcourtsPortalJob } from './jrx-ecourts-tier4b-worker.js';
import { enrichWithKanoonCandidates, isKanoonEnrichEnabled } from './jrx-kanoon-enrichment.js';
import { partnerSafeMessage } from '../utils/jrx-partner-safe-message.js';

const logger = createLogger('./jrx-cnr-unified-cascade');

export const CASCADE_ID = './jrx-cnr-unified-cascade-001';

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * When case-api misses or is sparse, continue to legacy Athena/RDS/S3 tiers.
 * Default ON when JRX_F_CASE_API_CNR=1; opt-out with JRX_F_CNR_UNIFIED_CASCADE=0.
 */
export function isCnrUnifiedCascadeEnabled(): boolean {
  const explicit = (process.env.JRX_F_CNR_UNIFIED_CASCADE ?? '').trim().toLowerCase();
  if (explicit === '0' || explicit === 'false' || explicit === 'off' || explicit === 'no') {
    return false;
  }
  if (explicit === '1' || explicit === 'true' || explicit === 'on' || explicit === 'yes') {
    return true;
  }
  return isCaseApiCnrEnabled();
}

/**
 * Future eCourts on-demand tier — stub only until explicit GO for captcha bypass + NIC client.
 * When enabled, cascade may attempt live fetch after corpus tiers exhaust.
 */
export function isEcourtsLiveFetchEnabled(): boolean {
  return envFlagOn('JRX_F_ECOURTS_LIVE_FETCH');
}

/** Tier-4b portal fetch — default off; async job when enabled (non-blocking). */
export function isEcourtsPortalFetchCascadeEnabled(): boolean {
  return isEcourtsPortalFetchEnabled();
}

function withPortalAttemptMeta(
  data: CnrResolveData,
  tag: string,
  reason: string,
  portalJobId?: string,
): CnrResolveData {
  const sourcesTried = unionSourcesTried(data.sourcesTried, [tag]);
  return {
    ...data,
    sourcesTried,
    meta: withCascadeMeta(data.meta, {
      ecourtsPortalAttempt: reason.slice(0, 160),
      ...(portalJobId ? { portalJobId } : {}),
    }),
  };
}

/** Tier-3 live eCourts — NIC API when key present; honest attempted tag otherwise. */
export async function tryEcourtsLiveFetch(input: {
  cnr?: string;
  diaryNumber?: string;
}): Promise<CnrResolveData | null> {
  if (!isEcourtsLiveFetchEnabled()) return null;
  const attempt = await attemptEcourtsLiveFetch(input);
  if (attempt.kind === 'found') return attempt.data;
  return null;
}

function withEcourtsAttemptMeta(
  data: CnrResolveData,
  tag: string,
  reason: string,
): CnrResolveData {
  const sourcesTried = unionSourcesTried(data.sourcesTried, [tag]);
  return {
    ...data,
    sourcesTried,
    meta: withCascadeMeta(data.meta, {
      ecourtsLiveAttempt: reason.slice(0, 160),
    }),
  };
}

async function applyOptionalKanoonEnrich(data: CnrResolveData): Promise<CnrResolveData> {
  if (!isKanoonEnrichEnabled()) return data;
  return enrichWithKanoonCandidates(data);
}

export function unionSourcesTried(...lists: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const tier of list ?? []) {
      if (seen.has(tier)) continue;
      seen.add(tier);
      out.push(tier);
    }
  }
  return out;
}

function withCascadeMeta(
  meta: CnrResolveData['meta'],
  extras: Record<string, string | number | boolean | null>,
): CnrResolveData['meta'] {
  return {
    ...(meta ?? {}),
    extra: {
      ...(meta?.extra ?? {}),
      cascade: CASCADE_ID,
      ...extras,
    },
  };
}

export function annotateLegacyCascadeHit(
  caseApiAttempt: CnrResolveData,
  legacy: CnrResolveData,
): CnrResolveData {
  const sourcesTried = unionSourcesTried(caseApiAttempt.sourcesTried, legacy.sourcesTried);
  return {
    ...legacy,
    claimEcourts: false,
    sourcesTried,
    meta: withCascadeMeta(legacy.meta, {
      caseApiAttemptStatus: caseApiAttempt.status,
    }),
  };
}

export function mergeNotFoundCascade(
  caseApiMiss: CnrResolveData,
  legacy: CnrResolveData | null,
): CnrResolveData {
  const sourcesTried = unionSourcesTried(caseApiMiss.sourcesTried, legacy?.sourcesTried);
  const subtitle =
    legacy?.status === 'found'
      ? caseApiMiss.ui.subtitle
      : partnerSafeMessage.cnrNotFoundAfterCascade;

  return {
    ...caseApiMiss,
    sourcesTried,
    claimEcourts: false,
    ui: {
      ...caseApiMiss.ui,
      subtitle,
    },
    meta: withCascadeMeta(caseApiMiss.meta, {
      legacyStatus: legacy?.status ?? 'skipped',
    }),
  };
}

async function cascadeToLegacy(input: {
  cnr?: string;
  diaryNumber?: string;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
  caseApiAttempt: CnrResolveData;
}): Promise<CnrResolveData> {
  if (!isCnrUnifiedCascadeEnabled() || !isNysKnowledgeConfigured()) {
    return input.caseApiAttempt;
  }

  const legacy = await fetchLegacyCnrResolve({
    cnr: input.cnr,
    diaryNumber: input.diaryNumber,
    wantCaseCreate: input.wantCaseCreate,
    includeDocuments: input.includeDocuments,
  });

  if (legacy?.status === 'found') {
    logger.info('[CNR] unified cascade legacy hit', {
      cnr: input.cnr ?? null,
      diaryNumber: input.diaryNumber ?? null,
      legacySource: legacy.source,
      sourcesTried: unionSourcesTried(input.caseApiAttempt.sourcesTried, legacy.sourcesTried),
    });
    return annotateLegacyCascadeHit(input.caseApiAttempt, legacy);
  }

  let merged = mergeNotFoundCascade(input.caseApiAttempt, legacy);

  if (isEcourtsLiveFetchEnabled()) {
    const attempt = await attemptEcourtsLiveFetch({
      cnr: input.cnr,
      diaryNumber: input.diaryNumber,
    });
    if (attempt.kind === 'found') {
      return applyOptionalKanoonEnrich(annotateLegacyCascadeHit(merged, attempt.data));
    }
    if (attempt.kind === 'attempted') {
      merged = withEcourtsAttemptMeta(merged, attempt.tag, attempt.reason);
    }
  }

  if (isEcourtsPortalFetchCascadeEnabled()) {
    const queued = enqueueEcourtsPortalJob({
      cnr: input.cnr,
      diaryNumber: input.diaryNumber,
    });
    if (queued) {
      merged = withPortalAttemptMeta(
        merged,
        ECOURTS_PORTAL_ATTEMPTED,
        'Tier-4b portal job queued — poll GET /sdk/cnr/live-fetch/{jobId}',
        queued.jobId,
      );
    }
  }

  return applyOptionalKanoonEnrich(merged);
}

export type UnifiedCascadeResult = CaseApiCnrLookupResult;

export async function resolveCnrViaUnifiedCascade(input: {
  cnr: string;
  courtType?: CaseApiCourtLevel;
  explicitCourtType?: boolean;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
  includeTimeline?: boolean;
}): Promise<UnifiedCascadeResult> {
  if (!isCaseApiCnrEnabled() || !isCaseApiConfigured()) {
    return { kind: 'fallback', status: 503, error: 'case_api_disabled' };
  }

  const lookup = await lookupCnrViaCaseApi(input);

  if (lookup.kind === 'upstream_error') {
    return lookup;
  }

  if (lookup.kind === 'fallback') {
    if (!isCnrUnifiedCascadeEnabled() || !isNysKnowledgeConfigured()) {
      return lookup;
    }
    const legacy = await fetchLegacyCnrResolve({
      cnr: input.cnr,
      wantCaseCreate: input.wantCaseCreate,
      includeDocuments: input.includeDocuments,
    });
    if (legacy?.status === 'found') {
      return {
        kind: 'resolved',
        data: {
          ...legacy,
          claimEcourts: false,
          sourcesTried: unionSourcesTried(['nys_case_api'], legacy.sourcesTried),
          meta: withCascadeMeta(legacy.meta, {}),
        },
      };
    }
    return lookup;
  }

  if (lookup.kind !== 'resolved') {
    return lookup;
  }

  const data = lookup.data;
  if (data.status === 'suggested' || data.status === 'invalid') {
    return lookup;
  }

  if (data.status === 'found') {
    const enriched = await applyOptionalKanoonEnrich(data);
    return { kind: 'resolved', data: enriched };
  }

  if (data.status === 'not_found') {
    const cascaded = await cascadeToLegacy({
      cnr: input.cnr,
      wantCaseCreate: input.wantCaseCreate,
      includeDocuments: input.includeDocuments,
      caseApiAttempt: data,
    });
    return { kind: 'resolved', data: cascaded };
  }

  return lookup;
}

export async function resolveDiaryViaUnifiedCascade(input: {
  diaryNumber: string;
  courtType?: string | null;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
}): Promise<UnifiedCascadeResult> {
  if (!isCaseApiCnrEnabled() || !isCaseApiConfigured()) {
    return { kind: 'fallback', status: 503, error: 'case_api_disabled' };
  }

  const lookup = await lookupDiaryViaCaseApi(input);

  if (lookup.kind === 'upstream_error') {
    return lookup;
  }

  if (lookup.kind === 'fallback') {
    if (!isCnrUnifiedCascadeEnabled() || !isNysKnowledgeConfigured()) {
      return lookup;
    }
    const legacy = await fetchLegacyCnrResolve({
      diaryNumber: input.diaryNumber,
      wantCaseCreate: input.wantCaseCreate,
      includeDocuments: input.includeDocuments,
    });
    if (legacy?.status === 'found') {
      return {
        kind: 'resolved',
        data: {
          ...legacy,
          claimEcourts: false,
          lookupType: 'diary',
          diaryNumber: input.diaryNumber,
          sourcesTried: unionSourcesTried(['nys_case_api'], legacy.sourcesTried),
          meta: withCascadeMeta(legacy.meta, {}),
        },
      };
    }
    return lookup;
  }

  if (lookup.kind !== 'resolved') {
    return lookup;
  }

  const data = lookup.data;
  if (data.status === 'not_found') {
    const cascaded = await cascadeToLegacy({
      diaryNumber: input.diaryNumber,
      wantCaseCreate: input.wantCaseCreate,
      includeDocuments: input.includeDocuments,
      caseApiAttempt: data,
    });
    return {
      kind: 'resolved',
      data: {
        ...cascaded,
        lookupType: 'diary',
        diaryNumber: input.diaryNumber,
      },
    };
  }

  if (data.status === 'found') {
    const enriched = await applyOptionalKanoonEnrich(data);
    return {
      kind: 'resolved',
      data: {
        ...enriched,
        lookupType: 'diary',
        diaryNumber: input.diaryNumber,
      },
    };
  }

  return lookup;
}
