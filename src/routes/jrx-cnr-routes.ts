/**
 * NV-CNR-001 — Partner CNR corpus resolve (proxies NYS).
 * Mount: /api/jrx/v1/sdk/cnr/*
 * Auth: dualSdkOrJwt. Never claims live eCourts.
 */
import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { partnerIndiaScopeMiddleware } from '../middleware/jrx-partner-india-scope.js';
import {
  forwardKeyFromReq,
  isNysKnowledgeConfigured,
  nysKnowledgeRequest,
} from '../services/jrx-nys-knowledge-client.js';
import { sendApiError } from '../utils/jrx-api-error.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';
import { NV_TIMEOUTS } from '../config/jrx-timeout-policy.js';
import {
  buildCaseApiSearchForwardQuery,
  extractDiaryNumber,
  extractCnrFromCaseRow,
  extractFilingRef,
  fetchCasesSearch,
  isCaseApiConfigured,
  isCaseApiCnrEnabled,
  isCaseApiCnrShadowMode,
  logCaseApiShadowDiff,
  normalizeCnrInput,
  parseCaseApiCourtType,
} from '../services/jrx-case-api-adapter.js';
import {
  isCnrUnifiedCascadeEnabled,
  isEcourtsLiveFetchEnabled,
  isEcourtsPortalFetchCascadeEnabled,
  resolveCnrViaUnifiedCascade,
  resolveDiaryViaUnifiedCascade,
} from '../services/jrx-cnr-unified-cascade.js';
import { ecourtsIndiaApiKeyLen } from '../services/jrx-ecourtsindia-partner-client.js';
import {
  enqueueEcourtsPortalJob,
  getEcourtsPortalJob,
} from '../services/jrx-ecourts-tier4b-worker.js';
import { isEcourtsPortalFetchEnabled } from '../services/jrx-ecourts-portal-fetch.js';
import {
  inferCourtTypeFromIdentifier,
  type NvCourtTypeInference,
} from '../utils/jrx-cnr-court-type-inference.js';
import { fetchCnrDocumentBundle } from '../services/jrx-cnr-document-bundle.js';
import { isKanoonEnrichEnabled } from '../services/jrx-kanoon-enrichment.js';
import { partnerSafeMessage } from '../utils/jrx-partner-safe-message.js';
import { sanitizeCnrHttpJsonForPartner } from '../utils/jrx-cnr-partner-sanitize.js';
import { buildNspParseGuide } from '../services/jrx-nsp-parse-contract.js';

const router = Router();
const logger = createLogger('./jrx-cnr-routes');

router.use(dualSdkOrJwt);
router.use(partnerIndiaScopeMiddleware);

function ensureNys(res: Response): boolean {
  if (!isNysKnowledgeConfigured()) {
    sendApiError(res, 'QUEUE_UNAVAILABLE', {
      overrideMessage: partnerSafeMessage.caseLookupUnavailable,
    });
    return false;
  }
  return true;
}

async function proxy(
  req: Request,
  res: Response,
  opts: {
    method: 'GET' | 'POST';
    nysPath: string;
    body?: unknown;
    timeoutMs?: number;
    retries?: number;
  },
): Promise<void> {
  if (!ensureNys(res)) return;
  const result = await nysKnowledgeRequest({
    method: opts.method,
    path: opts.nysPath,
    body: opts.body,
    timeoutMs: opts.timeoutMs ?? NV_TIMEOUTS.nysKnowledgeMs,
    forwardApiKey: forwardKeyFromReq(req),
    retries: opts.retries,
  });
  const payload = result.data as Record<string, unknown> | null;
  // Pass through NYS 4xx contract bodies (e.g. CNR_INVALID) when present.
  if (
    !result.ok &&
    payload &&
    typeof payload === 'object' &&
    ('success' in payload || 'error' in payload || 'data' in payload)
  ) {
    res.status(result.status >= 400 && result.status < 600 ? result.status : 502).json({
      ...payload,
      claimEcourts: false,
      source: 'nys-cnr-corpus',
    });
    return;
  }
  if (!result.ok) {
    const safeMsg = sanitizeErrorForClient(result.error ?? 'NYS upstream unavailable');
    const isTimeout = /abort|timeout|timed out/i.test(String(result.error ?? ''));
    const isBusy =
      result.status === 503 &&
      payload &&
      typeof payload === 'object' &&
      (payload as { error?: { code?: string } }).error?.code === 'CNR_UPSTREAM_BUSY';
    const upstreamStatus = isTimeout || isBusy
      ? 504
      : result.status >= 400 && result.status < 600
        ? result.status
        : 502;
    res.status(upstreamStatus).json({
      success: false,
      error: {
        code: isTimeout || isBusy ? 'CNR_UPSTREAM_TIMEOUT' : 'NYS_UPSTREAM',
        message: safeMsg,
        retryable: isTimeout || isBusy || result.status === 503,
      },
    });
    return;
  }
  // NYS already returns { success, data } — pass through with partner envelope fields.
  if (payload && typeof payload === 'object' && 'success' in payload) {
    res.status(result.status === 204 ? 200 : result.status).json({
      ...payload,
      claimEcourts: false,
      source: 'nys-cnr-corpus',
    });
    return;
  }
  res.status(result.status).json({
    success: true,
    claimEcourts: false,
    source: 'nys-cnr-corpus',
    data: result.data,
  });
}

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      product: 'CNR corpus resolve',
      code: 'cnr-resolve',
      claimEcourts: false,
      badge: 'Suggested · Judgment corpus',
      status: isNysKnowledgeConfigured() ? 'ready' : 'nys_unconfigured',
      caseApi: {
        enabled: isCaseApiCnrEnabled(),
        configured: isCaseApiConfigured(),
        shadow: isCaseApiCnrShadowMode(),
        unifiedCascade: isCnrUnifiedCascadeEnabled(),
        ecourtsLiveFetch: isEcourtsLiveFetchEnabled(),
        kanoonEnrich: isKanoonEnrichEnabled(),
      },
      ecourtsIndia: {
        liveFetchEnabled: isEcourtsLiveFetchEnabled(),
        keyLen: ecourtsIndiaApiKeyLen(),
        provider: 'ecourtsindia.com',
      },
    },
  });
});

/** Default profile: RDS warm path + slack for cold pool; no retry multiplication. */
const CNR_DEFAULT_TIMEOUT_MS = NV_TIMEOUTS.athenaQueryBudgetMs + 8_000;
const CNR_CASECREATE_TIMEOUT_MS = 60_000;

function extractResolveCnr(body: Record<string, unknown>): string | null {
  const raw =
    (typeof body.identifier === 'string' ? body.identifier : null) ??
    (typeof body.cnr === 'string' ? body.cnr : null) ??
    (typeof body.cnrNumber === 'string' ? body.cnrNumber : null);
  if (!raw?.trim()) return null;
  return normalizeCnrInput(raw);
}

function extractResolveIdentifierRaw(body: Record<string, unknown>): string | null {
  const raw =
    extractDiaryNumber(body) ??
    (typeof body.identifier === 'string' ? body.identifier : null) ??
    (typeof body.cnr === 'string' ? body.cnr : null) ??
    (typeof body.cnrNumber === 'string' ? body.cnrNumber : null);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function attachInferenceMeta<T extends Record<string, unknown>>(
  payload: T,
  inference: NvCourtTypeInference,
): T {
  const data = payload.data;
  if (!data || typeof data !== 'object') {
    return {
      ...payload,
      meta: {
        ...(typeof payload.meta === 'object' && payload.meta ? payload.meta : {}),
        inferredCourtType: inference.courtType,
        identifierKind: inference.kind,
      },
    };
  }

  const row = data as Record<string, unknown>;
  const meta =
    row.meta && typeof row.meta === 'object'
      ? (row.meta as Record<string, unknown>)
      : {};
  return {
    ...payload,
    data: {
      ...row,
      meta: {
        ...meta,
        inferredCourtType: inference.courtType,
        identifierKind: inference.kind,
      },
    },
  };
}

function extractExplicitCourtType(
  body: Record<string, unknown>,
  opts: Record<string, unknown>,
  query?: Record<string, unknown>,
): string | undefined {
  const fromOpts =
    typeof opts.courtType === 'string' && opts.courtType.trim() ? opts.courtType.trim() : null;
  if (fromOpts) return fromOpts;
  const fromBody =
    typeof body.courtType === 'string' && body.courtType.trim() ? body.courtType.trim() : null;
  if (fromBody) return fromBody;
  const fromQuery =
    typeof query?.courtType === 'string' && query.courtType.trim()
      ? query.courtType.trim()
      : null;
  return fromQuery ?? undefined;
}

function resolveCourtTypeHint(
  body: Record<string, unknown>,
  opts: Record<string, unknown>,
  inference?: NvCourtTypeInference,
  query?: Record<string, unknown>,
): string | undefined {
  const explicit = extractExplicitCourtType(body, opts, query);
  if (explicit) return explicit;
  if (inference?.courtType && inference.courtType !== 'unknown') {
    return inference.courtType;
  }
  return undefined;
}

function isDiaryResolve(body: Record<string, unknown>): boolean {
  return (
    typeof body.diaryNumber === 'string' ||
    typeof body.diary === 'string'
  );
}

function parseIncludeDocuments(
  opts: Record<string, unknown>,
  query?: Record<string, unknown>,
): boolean {
  if (typeof opts.includeDocuments === 'boolean') return opts.includeDocuments;
  if (typeof query?.includeDocuments === 'string') {
    const v = query.includeDocuments.toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
  }
  return true;
}

function parseIncludeTimeline(
  opts: Record<string, unknown>,
  query?: Record<string, unknown>,
): boolean {
  if (typeof opts.includeTimeline === 'boolean') return opts.includeTimeline;
  if (typeof query?.includeTimeline === 'string') {
    const v = query.includeTimeline.toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
  return false;
}

function parseIncludeParseGuide(
  opts: Record<string, unknown>,
  query?: Record<string, unknown>,
): boolean {
  if (typeof opts.includeParseGuide === 'boolean') return opts.includeParseGuide;
  if (typeof query?.includeParseGuide === 'string') {
    const v = query.includeParseGuide.toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
  return false;
}

/** Attach the machine-readable NSP parse contract to resolved data (§21). */
function maybeAttachParseGuide(data: unknown, want: boolean): void {
  if (!want || !data || typeof data !== 'object') return;
  (data as { nspParseGuide?: unknown }).nspParseGuide = buildNspParseGuide();
}

function parseProfile(
  body: Record<string, unknown>,
  opts: Record<string, unknown>,
  query?: Record<string, unknown>,
): string {
  if (typeof body.profile === 'string') return body.profile;
  if (typeof opts.profile === 'string') return opts.profile;
  if (typeof query?.profile === 'string') return query.profile;
  return 'default';
}

function sendCaseApiUpstreamError(res: Response, status: number): void {
  res.status(status >= 400 ? status : 502).json({
    success: false,
    claimEcourts: false,
    error: {
      code: status === 504 ? 'CNR_UPSTREAM_TIMEOUT' : 'CASE_API_UPSTREAM',
      message: partnerSafeMessage.caseLookupUnavailable,
      retryable: status === 504 || status === 503,
    },
  });
}

async function handleCnrViaCaseApi(
  req: Request,
  res: Response,
  cnrRaw: string,
  opts: {
    profile?: string;
    includeDocuments?: boolean;
    includeTimeline?: boolean;
    includeParseGuide?: boolean;
    courtType?: string;
    explicitCourtType?: boolean;
    inference?: NvCourtTypeInference;
  },
): Promise<boolean> {
  if (!isCaseApiCnrEnabled() || !isCaseApiConfigured()) {
    return false;
  }

  const cnr = normalizeCnrInput(cnrRaw);
  if (!cnr) return false;

  const isCaseCreate = opts.profile === 'caseCreate';
  const includeDocuments = opts.includeDocuments !== false;
  const shadow = isCaseApiCnrShadowMode();
  const courtTypeLevel = parseCaseApiCourtType(opts.courtType);

  const lookup = await resolveCnrViaUnifiedCascade({
    cnr,
    courtType: courtTypeLevel,
    explicitCourtType: opts.explicitCourtType === true,
    wantCaseCreate: isCaseCreate,
    includeDocuments,
    includeTimeline: opts.includeTimeline === true,
  });

  if (shadow) {
    if (lookup.kind === 'resolved') {
      const hearingsLen = Array.isArray(lookup.data.fields?.hearings?.value)
        ? (lookup.data.fields!.hearings!.value as unknown[]).length
        : 0;
      logCaseApiShadowDiff(cnr, lookup.data.status, null, hearingsLen, 0);
    }
    return false;
  }

  if (lookup.kind === 'resolved') {
    maybeAttachParseGuide(lookup.data, opts.includeParseGuide === true);
    const payload = {
      success: true,
      claimEcourts: false,
      source: 'nys-case-api',
      data: lookup.data,
    };
    const withInference = opts.inference ? attachInferenceMeta(payload, opts.inference) : payload;
    res.status(200).json(sanitizeCnrHttpJsonForPartner(req, withInference));
    return true;
  }

  if (lookup.kind === 'fallback') {
    logger.info('[CNR] case-api fallback to legacy', {
      cnr,
      status: lookup.status,
      error: lookup.error,
    });
    return false;
  }

  sendCaseApiUpstreamError(res, lookup.status);
  return true;
}

async function handleDiaryViaCaseApi(
  res: Response,
  body: Record<string, unknown>,
  opts: {
    profile?: string;
    includeDocuments?: boolean;
    includeParseGuide?: boolean;
    courtType?: string;
    inference?: NvCourtTypeInference;
  },
): Promise<boolean> {
  if (!isCaseApiCnrEnabled() || !isCaseApiConfigured()) {
    return false;
  }

  const diaryNumber = extractDiaryNumber(body);
  if (!diaryNumber) return false;

  const isCaseCreate = opts.profile === 'caseCreate';
  const includeDocuments = opts.includeDocuments !== false;
  const shadow = isCaseApiCnrShadowMode();

  const lookup = await resolveDiaryViaUnifiedCascade({
    diaryNumber,
    courtType: opts.courtType,
    wantCaseCreate: isCaseCreate,
    includeDocuments,
  });

  if (shadow) {
    if (lookup.kind === 'resolved') {
      logCaseApiShadowDiff(
        diaryNumber,
        lookup.data.status,
        null,
        Array.isArray(lookup.data.fields?.hearings?.value)
          ? (lookup.data.fields!.hearings!.value as unknown[]).length
          : 0,
        0,
      );
    }
    return false;
  }

  if (lookup.kind === 'resolved') {
    maybeAttachParseGuide(lookup.data, opts.includeParseGuide === true);
    const payload = {
      success: true,
      claimEcourts: false,
      source: 'nys-case-api',
      data: lookup.data,
    };
    const inference =
      opts.inference ??
      ({
        courtType: 'sc',
        kind: 'diary',
        confidence: 'high',
        notes: ['diaryNumber field forces courtType sc'],
      } satisfies NvCourtTypeInference);
    res.status(200).json(attachInferenceMeta(payload, inference));
    return true;
  }

  if (lookup.kind === 'fallback') {
    logger.info('[CNR] case-api diary fallback to legacy', {
      diaryNumber,
      status: lookup.status,
      error: lookup.error,
    });
    return false;
  }

  sendCaseApiUpstreamError(res, lookup.status);
  return true;
}

/** POST /api/jrx/v1/sdk/cnr/resolve */
router.post('/resolve', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const opts = (body.options ?? {}) as Record<string, unknown>;
    const profile = parseProfile(body, opts);
    const includeDocuments = parseIncludeDocuments(opts);
    const includeTimeline = parseIncludeTimeline(opts);
    const includeParseGuide = parseIncludeParseGuide(opts);
    const identifierRaw = extractResolveIdentifierRaw(body);
    const inference = identifierRaw ? inferCourtTypeFromIdentifier(identifierRaw) : null;
    const explicitCourtType = Boolean(extractExplicitCourtType(body, opts));

    if (isDiaryResolve(body) || inference?.kind === 'diary') {
      const diaryBody =
        isDiaryResolve(body)
          ? body
          : {
              ...body,
              diaryNumber: inference?.normalized ?? identifierRaw,
            };
      const handled = await handleDiaryViaCaseApi(res, diaryBody, {
        profile,
        includeDocuments,
        includeParseGuide,
        courtType: 'sc',
        inference: inference ?? undefined,
      });
      if (handled) return;
    } else if (inference?.kind === 'case_number') {
      res.status(422).json({
        success: false,
        claimEcourts: false,
        error: {
          code: 'CNR_CASE_NUMBER_ONLY',
          message:
            'SC case number detected — supply diaryNumber for pending matters or retry after CNR is assigned',
          retryable: false,
        },
        meta: {
          inferredCourtType: inference.courtType,
          identifierKind: inference.kind,
        },
      });
      return;
    } else if (extractFilingRef(body)) {
      const filingRef = extractFilingRef(body)!;
      const courtTypeHint = resolveCourtTypeHint(body, opts, inference ?? undefined) ?? 'dc';
      const courtLevel = parseCaseApiCourtType(courtTypeHint) ?? 'DC';
      const search = await fetchCasesSearch({
        court_type: courtLevel,
        filing_number: filingRef.filingNumber,
        filing_number_year: filingRef.filingYear,
        page: '1',
        page_size: '5',
        want_total: 'false',
      });
      if (search.ok && (search.body.cases?.length ?? 0) > 0) {
        const hit = search.body.cases![0]!;
        const resolvedCnr = extractCnrFromCaseRow(hit).cnr || normalizeCnrInput(String(hit.cnr ?? ''));
        if (resolvedCnr) {
          const handled = await handleCnrViaCaseApi(req, res, resolvedCnr, {
            profile,
            includeDocuments,
            includeTimeline,
            includeParseGuide,
            courtType: courtTypeHint,
            explicitCourtType: Boolean(extractExplicitCourtType(body, opts)),
            inference: inference ?? undefined,
          });
          if (handled) return;
        }
      }
      if (search.ok) {
        res.status(200).json({
          success: true,
          claimEcourts: false,
          source: 'nys-case-api',
          data: {
            cnr: '',
            status: 'not_found',
            matchType: 'none',
            source: null,
            sourcesTried: ['nys_case_api'],
            confidence: 0,
            claimEcourts: false as const,
            validation: 'ok',
            ui: {
              badge: 'Suggested · Judgment corpus',
              subtitle: partnerSafeMessage.filingRefNotFound,
            },
            fields: null,
            documents: [],
            candidates: [],
            meta: {
              source: 'nys-case-api',
              latencyMs: search.latencyMs,
              extra: {
                filingNumber: filingRef.filingNumber,
                filingYear: filingRef.filingYear,
                courtType: courtTypeHint,
              },
            },
          },
        });
        return;
      }
      sendCaseApiUpstreamError(res, search.status);
      return;
    } else {
      const cnr = extractResolveCnr(body);
      if (cnr) {
        const courtTypeHint = resolveCourtTypeHint(body, opts, inference ?? undefined);
        const handled = await handleCnrViaCaseApi(req, res, cnr, {
          profile,
          includeDocuments,
          includeTimeline,
          includeParseGuide,
          courtType: courtTypeHint,
          explicitCourtType,
          inference: inference ?? undefined,
        });
        if (handled) return;
      }
    }

    const isCaseCreate = profile === 'caseCreate';
    const proxyBody = { ...(req.body as Record<string, unknown>) };
    if (inference && inference.courtType !== 'unknown') {
      const options =
        proxyBody.options && typeof proxyBody.options === 'object'
          ? { ...(proxyBody.options as Record<string, unknown>) }
          : {};
      if (!options.courtType) {
        options.courtType = inference.courtType;
      }
      proxyBody.options = options;
    }

    if (!ensureNys(res)) return;
    const result = await nysKnowledgeRequest({
      method: 'POST',
      path: '/cnr/resolve',
      body: proxyBody,
      timeoutMs: isCaseCreate ? CNR_CASECREATE_TIMEOUT_MS : CNR_DEFAULT_TIMEOUT_MS,
      forwardApiKey: forwardKeyFromReq(req),
      retries: 0,
    });
    const payload = result.data as Record<string, unknown> | null;
    if (
      !result.ok &&
      payload &&
      typeof payload === 'object' &&
      ('success' in payload || 'error' in payload || 'data' in payload)
    ) {
      const out = {
        ...payload,
        claimEcourts: false,
        source: 'nys-cnr-corpus',
      };
      res
        .status(result.status >= 400 && result.status < 600 ? result.status : 502)
        .json(inference ? attachInferenceMeta(out, inference) : out);
      return;
    }
    if (!result.ok) {
      const safeMsg = sanitizeErrorForClient(result.error ?? 'NYS upstream unavailable');
      const isTimeout = /abort|timeout|timed out/i.test(String(result.error ?? ''));
      const isBusy =
        result.status === 503 &&
        payload &&
        typeof payload === 'object' &&
        (payload as { error?: { code?: string } }).error?.code === 'CNR_UPSTREAM_BUSY';
      const upstreamStatus = isTimeout || isBusy
        ? 504
        : result.status >= 400 && result.status < 600
          ? result.status
          : 502;
      res.status(upstreamStatus).json({
        success: false,
        error: {
          code: isTimeout || isBusy ? 'CNR_UPSTREAM_TIMEOUT' : 'NYS_UPSTREAM',
          message: safeMsg,
          retryable: isTimeout || isBusy || result.status === 503,
        },
        ...(inference
          ? {
              meta: {
                inferredCourtType: inference.courtType,
                identifierKind: inference.kind,
              },
            }
          : {}),
      });
      return;
    }
    if (payload && typeof payload === 'object' && 'success' in payload) {
      const out = {
        ...payload,
        claimEcourts: false,
        source: 'nys-cnr-corpus',
      };
      maybeAttachParseGuide((out as { data?: unknown }).data, includeParseGuide);
      res
        .status(result.status === 204 ? 200 : result.status)
        .json(inference ? attachInferenceMeta(out, inference) : out);
      return;
    }
    const out = {
      success: true,
      claimEcourts: false,
      source: 'nys-cnr-corpus',
      data: result.data,
    };
    res.status(result.status).json(inference ? attachInferenceMeta(out, inference) : out);
  } catch (err: any) {
    logger.warn('[CNR] resolve proxy failed', { err: err?.message });
    res.status(500).json({
      success: false,
      error: { code: 'CNR_PROXY_FAILED', message: partnerSafeMessage.cnrResolveFailed },
    });
  }
});

/** POST /api/jrx/v1/sdk/cnr/enrich — lawyer enrichment write-through */
router.post('/enrich', async (req, res) => {
  await proxy(req, res, {
    method: 'POST',
    nysPath: '/cnr/enrich',
    body: req.body,
  });
});

/** GET /api/jrx/v1/sdk/cnr/search — nysapi party/diary search (P2+, additive) */
router.get('/search', async (req, res) => {
  if (!isCaseApiCnrEnabled() || !isCaseApiConfigured()) {
    sendApiError(res, 'QUEUE_UNAVAILABLE', {
      overrideMessage: partnerSafeMessage.caseSearchNotConfigured,
    });
    return;
  }

  const query = req.query as Record<string, string | string[] | undefined>;
  const forward = buildCaseApiSearchForwardQuery(query);
  if (!forward.court_type) {
    res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'court_type is required' },
    });
    return;
  }

  const result = await fetchCasesSearch(forward);
  if (!result.ok) {
    sendCaseApiUpstreamError(res, result.status);
    return;
  }

  res.status(200).json(
    sanitizeCnrHttpJsonForPartner(req, {
      success: true,
      claimEcourts: false,
      source: 'nys-case-api',
      data: {
        ...result.body,
        meta: {
          source: 'nys-case-api',
          latencyMs: result.latencyMs,
        },
      },
    }),
  );
});

async function handleCnrDocumentsViaCaseApi(
  req: Request,
  res: Response,
  cnrRaw: string,
): Promise<boolean> {
  if (!isCaseApiCnrEnabled() || !isCaseApiConfigured()) {
    return false;
  }

  const cnr = normalizeCnrInput(cnrRaw);
  if (!cnr) return false;

  const shadow = isCaseApiCnrShadowMode();
  const query = req.query as Record<string, unknown>;
  const courtTypeHint = resolveCourtTypeHint({}, {}, undefined, query);
  const courtTypeLevel = parseCaseApiCourtType(courtTypeHint);

  const lookup = await resolveCnrViaUnifiedCascade({
    cnr,
    courtType: courtTypeLevel,
    explicitCourtType: Boolean(extractExplicitCourtType({}, {}, query)),
    includeDocuments: true,
    includeTimeline: false,
  });

  if (shadow) {
    if (lookup.kind === 'resolved') {
      logCaseApiShadowDiff(
        cnr,
        lookup.data.status,
        null,
        lookup.data.documents.length,
        0,
      );
    }
    return false;
  }

  if (lookup.kind === 'resolved') {
    res.status(200).json(
      sanitizeCnrHttpJsonForPartner(req, {
        success: true,
        claimEcourts: false,
        source: 'nys-case-api',
        data: {
          cnr: lookup.data.cnr,
          claimEcourts: false as const,
          documents: lookup.data.documents,
          meta: lookup.data.meta,
        },
      }),
    );
    return true;
  }

  if (lookup.kind === 'fallback') {
    logger.info('[CNR] case-api documents fallback to legacy', {
      cnr,
      status: lookup.status,
      error: lookup.error,
    });
    return false;
  }

  sendCaseApiUpstreamError(res, lookup.status);
  return true;
}

function parseBundleQuery(query: Record<string, unknown>): {
  includeTimelineOrders: boolean;
  refresh: boolean;
} {
  const flag = (key: string, defaultTrue: boolean): boolean => {
    const v = query[key];
    if (typeof v !== 'string') return defaultTrue;
    const lower = v.toLowerCase();
    if (lower === '0' || lower === 'false' || lower === 'no') return false;
    if (lower === '1' || lower === 'true' || lower === 'yes') return true;
    return defaultTrue;
  };
  return {
    includeTimelineOrders: flag('includeTimelineOrders', true),
    refresh: flag('refresh', true),
  };
}

/** POST /api/jrx/v1/sdk/cnr/live-fetch — Tier-4b async portal fetch (non-blocking) */
router.post('/live-fetch', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cnrRaw = String(body.cnr ?? body.identifier ?? '').trim();
    const diaryNumber = extractDiaryNumber(body);

    if (!cnrRaw && !diaryNumber) {
      res.status(400).json({
        success: false,
        error: { code: 'CNR_LIVE_FETCH_INPUT', message: 'cnr or diaryNumber required' },
      });
      return;
    }

    if (!isEcourtsPortalFetchEnabled()) {
      res.status(503).json({
        success: false,
        claimEcourts: false,
        error: {
          code: 'ECOURTS_PORTAL_DISABLED',
          message: partnerSafeMessage.liveCourtFetchDisabled,
        },
        sourcesTried: ['ecourts_portal_attempted'],
      });
      return;
    }

    const cnr = cnrRaw ? normalizeCnrInput(cnrRaw) : undefined;
    const queued = enqueueEcourtsPortalJob({ cnr, diaryNumber: diaryNumber ?? undefined });
    if (!queued) {
      res.status(503).json({
        success: false,
        claimEcourts: false,
        error: { code: 'ECOURTS_PORTAL_QUEUE_FAILED', message: 'Could not enqueue portal job' },
      });
      return;
    }

    res.status(202).json({
      success: true,
      claimEcourts: false,
      jobId: queued.jobId,
      status: 'queued',
      poll: `/api/jrx/v1/sdk/cnr/live-fetch/${queued.jobId}`,
      sourcesTried: ['ecourts_portal_attempted'],
    });
  } catch (err: unknown) {
    logger.warn('[CNR] live-fetch enqueue failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({
      success: false,
      error: { code: 'CNR_LIVE_FETCH_FAILED', message: 'Portal live-fetch enqueue failed' },
    });
  }
});

/** GET /api/jrx/v1/sdk/cnr/live-fetch/:jobId — poll Tier-4b async result */
router.get('/live-fetch/:jobId', async (req, res) => {
  const jobId = String(req.params.jobId ?? '').trim();
  if (!jobId) {
    res.status(400).json({ success: false, error: { code: 'CNR_JOB_ID_REQUIRED', message: 'jobId required' } });
    return;
  }

  const job = getEcourtsPortalJob(jobId);
  if (!job) {
    res.status(404).json({
      success: false,
      error: { code: 'CNR_JOB_NOT_FOUND', message: 'Portal fetch job not found or expired' },
    });
    return;
  }

  res.status(200).json({
    success: true,
    claimEcourts: false,
    jobId: job.jobId,
    status: job.status,
    sourcesTried: job.sourcesTried.length > 0 ? job.sourcesTried : ['ecourts_portal_attempted'],
    data: job.result,
    error: job.error,
    meta: {
      tier: 'ecourts_portal',
      portalFetchEnabled: isEcourtsPortalFetchCascadeEnabled(),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
});

/** GET /api/jrx/v1/sdk/cnr/:cnr/document-bundle — P3 multi-PDF bundle */
router.get('/:cnr/document-bundle', async (req, res) => {
  try {
    const cnrRaw = String(req.params.cnr ?? '');
    const query = req.query as Record<string, unknown>;
    const { includeTimelineOrders } = parseBundleQuery(query);
    const courtType = resolveCourtTypeHint({}, {}, undefined, query);

    const result = await fetchCnrDocumentBundle({
      cnr: cnrRaw,
      courtType,
      includeTimelineOrders,
      refresh: true,
    });

    if (result.kind === 'disabled') {
      sendApiError(res, 'QUEUE_UNAVAILABLE', {
        overrideMessage: partnerSafeMessage.documentBundleUnavailable,
      });
      return;
    }
    if (result.kind === 'upstream_error') {
      sendCaseApiUpstreamError(res, result.status);
      return;
    }

    res.status(200).json(
      sanitizeCnrHttpJsonForPartner(req, {
        success: true,
        claimEcourts: false,
        source: result.bundle.meta.source,
        data: result.bundle,
      }),
    );
  } catch (err: unknown) {
    logger.warn('[CNR] document-bundle failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({
      success: false,
      error: { code: 'CNR_BUNDLE_FAILED', message: 'Document bundle fetch failed' },
    });
  }
});

/** GET /api/jrx/v1/sdk/cnr/:cnr/documents — register before bare :cnr */
router.get('/:cnr/documents', async (req, res) => {
  const cnrRaw = String(req.params.cnr ?? '');
  const handled = await handleCnrDocumentsViaCaseApi(req, res, cnrRaw);
  if (handled) return;

  const cnr = encodeURIComponent(cnrRaw);
  await proxy(req, res, { method: 'GET', nysPath: `/cnr/${cnr}/documents` });
});

/** GET /api/jrx/v1/sdk/cnr/:cnr */
router.get('/:cnr', async (req, res) => {
  const cnrRaw = String(req.params.cnr ?? '');
  const query = req.query as Record<string, unknown>;
  const profile = parseProfile({}, {}, query);

  const handled = await handleCnrViaCaseApi(req, res, cnrRaw, {
    profile,
    includeDocuments: parseIncludeDocuments({}, query),
    includeTimeline: parseIncludeTimeline({}, query),
    courtType: resolveCourtTypeHint({}, {}, undefined, query),
    explicitCourtType: Boolean(extractExplicitCourtType({}, {}, query)),
  });
  if (handled) return;

  const cnr = encodeURIComponent(cnrRaw);
  await proxy(req, res, { method: 'GET', nysPath: `/cnr/${cnr}` });
});

export default router;
