/**
 * NV-KNOWLEDGE-PLANE-001 — Additive proxy routes for the NYS federated
 * Knowledge Plane. Mounted at /api/jrx/knowledge/* (caselaw, statutes,
 * retrieve, citations, archive, templates) — does NOT replace the existing
 * knowledge-modules alias at /api/jrx/knowledge for module routes that
 * already exist; this router is mounted MORE SPECIFICALLY at
 * /api/jrx/knowledge/plane and also /api/jrx/knowledge/{caselaw,statutes,...}.
 *
 * Auth: authenticateToken (JWT or SDK key via existing gateway stack).
 * Proxies → JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL with X-API-Key.
 */
import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { partnerIndiaScopeMiddleware } from '../middleware/jrx-partner-india-scope.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import {
  forwardKeyFromReq,
  getNysKnowledgeClientStats,
  isNysKnowledgeConfigured,
  nysKnowledgeHealthz,
  nysKnowledgeRequest,
} from '../services/jrx-nys-knowledge-client.js';
import { normalizeNysAthenaSearchBody } from '../services/jrx-nys-athena-normalize.js';
import {
  authorityTokens,
  resolveAuthority,
} from '../services/jrx-authority-identity.js';
import {
  fetchJudgmentFullText,
  mergeTruncation,
  buildParasMeta,
  type JudgmentArchiveScope,
} from '../services/jrx-nys-judgment-fulltext.js';
import { sendApiError } from '../utils/jrx-api-error.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';
import {
  NV_TIMEOUTS,
  resolveCaselawHybridFtsFallbackReason,
} from '../config/jrx-timeout-policy.js';

const router = Router();
const logger = createLogger('./jrx-knowledge-plane-routes');

router.use(dualSdkOrJwt);
router.use(partnerIndiaScopeMiddleware);

function flagOr503(res: Response): boolean {
  if (!isJrxFeatureOn('nysKnowledgePlane')) {
    sendApiError(res, 'FORBIDDEN', {
      status: 503,
      overrideMessage: 'NYS knowledge plane flag JRX_F_JRX_ECOSYSTEM_KNOWLEDGE_PLANE is off',
    });
    return false;
  }
  if (!isNysKnowledgeConfigured()) {
    sendApiError(res, 'QUEUE_UNAVAILABLE', {
      overrideMessage: 'JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL is not configured',
    });
    return false;
  }
  return true;
}

async function proxy(
  req: Request,
  res: Response,
  opts: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    nysPath: string;
    body?: unknown;
    query?: Record<string, string | number | undefined | null>;
    timeoutMs?: number;
  },
): Promise<void> {
  if (!flagOr503(res)) return;
  const result = await nysKnowledgeRequest({
    method: opts.method,
    path: opts.nysPath,
    body: opts.body,
    query: opts.query,
    timeoutMs: opts.timeoutMs,
    forwardApiKey: forwardKeyFromReq(req),
  });
  if (!result.ok) {
    const safeMsg = sanitizeErrorForClient(result.error ?? 'NYS upstream unavailable');
    const upstreamStatus = result.status >= 400 && result.status < 600 ? result.status : 502;
    // Never echo raw Postgres/AWS credential failures to Console clients.
    const clientStatus =
      /unavailable|authentication|password|AccessDenied|token/i.test(String(result.error ?? ''))
        ? 503
        : upstreamStatus;
    res.status(clientStatus).json({
      success: false,
      error: { code: 'JRX_ECOSYSTEM_UPSTREAM', message: safeMsg },
    });
    return;
  }
  res.status(result.status === 204 ? 200 : result.status).json({
    success: true,
    source: 'nys-knowledge-plane',
    data: result.data,
  });
}

/** GET /api/jrx/knowledge/plane/health */
router.get('/plane/health', async (_req, res) => {
  const stats = getNysKnowledgeClientStats();
  const probe = isNysKnowledgeConfigured() ? await nysKnowledgeHealthz() : null;
  res.json({
    success: true,
    flag: isJrxFeatureOn('nysKnowledgePlane'),
    client: stats,
    upstream: probe,
  });
});

/** POST /api/jrx/knowledge/retrieve */
router.post('/retrieve', async (req, res) => {
  if (!flagOr503(res)) return;
  const result = await nysKnowledgeRequest({
    method: 'POST',
    path: '/retrieve',
    body: req.body,
    forwardApiKey: forwardKeyFromReq(req),
  });
  if (!result.ok) {
    const safeMsg = sanitizeErrorForClient(result.error ?? 'NYS upstream unavailable');
    const upstreamStatus = result.status >= 400 && result.status < 600 ? result.status : 502;
    const clientStatus =
      /unavailable|authentication|password|AccessDenied|token/i.test(String(result.error ?? ''))
        ? 503
        : upstreamStatus;
    res.status(clientStatus).json({
      success: false,
      error: { code: 'JRX_ECOSYSTEM_UPSTREAM', message: safeMsg },
    });
    return;
  }

  // NV-JRX-RETRIEVE-SHAPE-001: normalize hybrid Athena/NYS payloads so NSP/NYM
  // always receive flat chunks + rankedResults (statutes/acts/amendments).
  const raw = (result.data ?? {}) as Record<string, any>;
  const chunks: Array<Record<string, unknown>> = [];
  const pushChunk = (c: Record<string, unknown>, i: number) => {
    chunks.push({
      id: c.id || c.code || c.citationRef || `hit-${chunks.length || i}`,
      title: c.title || c.name || c.section || c.code || `Result ${chunks.length + 1}`,
      content: c.content || c.text || c.excerpt || c.summary || '',
      score: typeof c.score === 'number' ? c.score : typeof c.similarity === 'number' ? c.similarity : Math.max(0.2, 1 - chunks.length * 0.05),
      source: c.source || c.tool || c.jurisdiction || 'nys',
      jurisdiction: c.jurisdiction || req.body?.jurisdiction || 'IN',
      citationRef: c.citationRef || c.code || c.section || c.title,
      ...c,
    });
  };

  if (Array.isArray(raw.chunks)) raw.chunks.forEach((c: any, i: number) => pushChunk(c, i));
  if (Array.isArray(raw.results)) raw.results.forEach((c: any, i: number) => pushChunk(c, i));
  if (Array.isArray(raw.hits)) raw.hits.forEach((c: any, i: number) => pushChunk(c, i));
  if (Array.isArray(raw.steps)) {
    for (const step of raw.steps) {
      if (Array.isArray(step?.statutes)) step.statutes.forEach((c: any, i: number) => pushChunk({ ...c, tool: step.tool || 'statute-lookup' }, i));
      if (Array.isArray(step?.cases)) step.cases.forEach((c: any, i: number) => pushChunk({ ...c, tool: step.tool || 'caselaw' }, i));
      if (Array.isArray(step?.chunks)) step.chunks.forEach((c: any, i: number) => pushChunk(c, i));
      if (Array.isArray(step?.results)) step.results.forEach((c: any, i: number) => pushChunk(c, i));
    }
  }

  const rankedResults = chunks.map((c, i) => ({
    id: c.id,
    title: c.title,
    content: c.content,
    score: c.score,
    source: c.source,
    jurisdiction: c.jurisdiction,
    citationRef: c.citationRef,
    rank: i + 1,
  }));

  // NV-JRX-LLMREQUIRED-001 — NYS returns `llmRequired` on every plan and this
  // route forwarded it as opaque passthrough, leaving each partner to re-derive
  // whether a model was needed (and most did not, so they paid for one). Render
  // the grounded answer here, from the plan we already have, so a partner can
  // return it directly with zero completions.
  let deterministicAnswer: Record<string, unknown> | undefined;
  try {
    const { renderDeterministicAnswerFromPlan } = await import(
      '../services/jrx-nys-deterministic-answer.js'
    );
    const answer = renderDeterministicAnswerFromPlan(raw, {
      query: String(raw.query || req.body?.query || ''),
      jurisdiction: String(req.body?.jurisdiction || 'IN'),
    });
    if (answer) {
      deterministicAnswer = {
        content: answer.content,
        citations: answer.citations,
        model: answer.resolver,
        provider: './jrx-deterministic',
        intent: answer.intent,
        reason: answer.nysReason,
        tokens: { prompt: 0, completion: 0, total: 0 },
      };
    }
  } catch (e) {
    logger.warn('knowledge/retrieve deterministic render failed (non-fatal)', {
      error: (e as Error).message,
    });
  }

  res.status(result.status === 204 ? 200 : result.status).json({
    success: true,
    source: 'nys-knowledge-plane',
    data: {
      ...raw,
      chunks,
      results: rankedResults,
      rankedResults,
      query: raw.query || req.body?.query,
      count: chunks.length,
      ...(deterministicAnswer ? { deterministicAnswer } : {}),
    },
  });
});

/** GET /api/jrx/knowledge/caselaw/search */
router.get('/caselaw/search', async (req, res) => {
  if (!flagOr503(res)) return;
  const q = String(req.query.q ?? '');
  const jurisdiction = String(req.query.jurisdiction ?? 'IN');
  const year = req.query.year ? Number(req.query.year) : undefined;
  const court = req.query.court ? String(req.query.court) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  // Phase 0.1: interactive / NSP default is FTS (<1s); hybrid only when mode=hybrid.
  const requestedMode = req.query.mode ? String(req.query.mode) : 'fts';

  /**
   * JRX-CASELAW-SEARCH-FILTERS-001 — forward the pagination / filter / sort
   * surface. Undefined keys are dropped by the query serializer, so an
   * unfiltered call is byte-identical to the previous behaviour.
   */
  const baseQuery = {
    q,
    jurisdiction,
    year,
    court,
    limit,
    offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
    yearFrom: req.query.yearFrom !== undefined ? Number(req.query.yearFrom) : undefined,
    yearTo: req.query.yearTo !== undefined ? Number(req.query.yearTo) : undefined,
    dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
    dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
    judge: req.query.judge ? String(req.query.judge) : undefined,
    reporter: req.query.reporter ? String(req.query.reporter) : undefined,
    benchStrength: req.query.benchStrength ? String(req.query.benchStrength) : undefined,
    courtType: req.query.courtType ? String(req.query.courtType) : undefined,
    sort: req.query.sort ? String(req.query.sort) : undefined,
  };
  const hybridBudgetMs = NV_TIMEOUTS.caselawHybridBudgetMs;
  const ftsFallbackBudgetMs = NV_TIMEOUTS.caselawFtsFallbackBudgetMs;
  const hybridStart = requestedMode === 'hybrid' ? Date.now() : 0;
  let result = await nysKnowledgeRequest({
    method: 'GET',
    path: '/caselaw/search',
    query: { ...baseQuery, mode: requestedMode },
    timeoutMs:
      requestedMode === 'hybrid'
        ? hybridBudgetMs
        : requestedMode === 'fts'
          ? 8_000
          : 60_000,
    retries: requestedMode === 'hybrid' || requestedMode === 'fts' ? 0 : 2,
    forwardApiKey: forwardKeyFromReq(req),
  });

  let fallbackMeta:
    | { searchMode: 'fts_fallback'; hybridMs: number; reason: string; fallbackMode: 'fts' }
    | undefined;
  if (requestedMode === 'hybrid') {
    const hybridMs = Date.now() - hybridStart;
    let ftsReason = resolveCaselawHybridFtsFallbackReason(result);
    if (!ftsReason && result.ok && hybridMs >= hybridBudgetMs) {
      ftsReason = 'budget_exceeded';
    }
    if (ftsReason) {
      logger.warn('caselaw hybrid empty or busy — falling back to FTS', {
        q: q.slice(0, 80),
        hybridMs,
        reason: ftsReason,
        status: result.ok ? undefined : result.status,
        error: result.ok ? undefined : result.error,
      });
      result = await nysKnowledgeRequest({
        method: 'GET',
        path: '/caselaw/search',
        query: { ...baseQuery, mode: 'fts' },
        timeoutMs: ftsFallbackBudgetMs,
        retries: 0,
        forwardApiKey: forwardKeyFromReq(req),
      });
      fallbackMeta = {
        searchMode: 'fts_fallback',
        hybridMs,
        reason: ftsReason,
        fallbackMode: 'fts',
      };
    }
  }

  const fallback = fallbackMeta?.fallbackMode;

  if (!result.ok) {
    const safeMsg = sanitizeErrorForClient(result.error ?? 'NYS upstream unavailable');
    logger.warn('caselaw search upstream failed — returning degraded empty envelope', {
      q: q.slice(0, 80),
      status: result.status,
      error: safeMsg,
      fallback,
    });
    res.status(200).json({
      success: true,
      source: 'nys-knowledge-plane',
      data: {
        jurisdiction,
        total: 0,
        totalCapped: false,
        totalIsLowerBound: false,
        results: [],
        degraded: true,
        degradedReason: safeMsg,
        retryable: result.status === 503 || result.status === 502 || result.status === 429,
        ...(fallback ? { attemptedFallback: fallback } : {}),
        message:
          'Caselaw search is temporarily degraded (corpus busy or upstream timeout). Retry with mode=fts or a narrower query.',
      },
    });
    return;
  }

  const payload =
    fallbackMeta && result.data && typeof result.data === 'object'
      ? { ...(result.data as object), ...fallbackMeta }
      : fallback && result.data && typeof result.data === 'object'
        ? { ...(result.data as object), fallbackMode: fallback }
        : result.data;
  res.status(200).json({
    success: true,
    source: 'nys-knowledge-plane',
    data: payload,
  });
});

/** GET /api/jrx/knowledge/caselaw/documents/:id */
router.get('/caselaw/documents/:id', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: `/caselaw/documents/${encodeURIComponent(req.params.id)}`,
  });
});

/** GET /api/jrx/knowledge/caselaw/documents/:id/similar */
router.get('/caselaw/documents/:id/similar', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: `/caselaw/documents/${encodeURIComponent(req.params.id)}/similar`,
    query: { limit: req.query.limit ? Number(req.query.limit) : undefined },
  });
});

/** POST /api/jrx/knowledge/caselaw/verify-citation */
router.post('/caselaw/verify-citation', async (req, res) => {
  await proxy(req, res, {
    method: 'POST',
    nysPath: '/caselaw/verify-citation',
    body: req.body,
  });
});

/** GET /api/jrx/knowledge/caselaw/stats */
router.get('/caselaw/stats', async (req, res) => {
  // NYS stats scans embed progress — can exceed 45s under load; keep generous.
  await proxy(req, res, { method: 'GET', nysPath: '/caselaw/stats', timeoutMs: 120_000 });
});

/** GET /api/jrx/knowledge/caselaw/embedding/coverage — embedding SLO (fast) */
router.get('/caselaw/embedding/coverage', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: '/caselaw/embedding/coverage',
    timeoutMs: 15_000,
  });
});

/** GET /api/jrx/knowledge/statutes/embedding/coverage — statute embed SLO */
router.get('/statutes/embedding/coverage', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: '/statutes/embedding/coverage',
    timeoutMs: 15_000,
  });
});

/**
 * POST /api/jrx/knowledge/sso/launch — mint one-time URL to open nyayasearch
 * with NYS session cookie (signed launch; shared JRX_ECOSYSTEM_SSO_LAUNCH_SECRET).
 * Body: { path?: string } — relative path on NYS UI (default "/").
 */
router.post('/sso/launch', async (req, res) => {
  try {
    const secret = (process.env.JRX_ECOSYSTEM_SSO_LAUNCH_SECRET ?? '').trim();
    if (!secret) {
      return sendApiError(res, 'QUEUE_UNAVAILABLE', {
        status: 503,
        overrideMessage: 'JRX_ECOSYSTEM_SSO_LAUNCH_SECRET is not set on the gateway',
        details: { code: 'SSO_NOT_CONFIGURED' },
      });
    }
    const user = (req as any).user as { role?: string; email?: string; username?: string; userId?: string } | undefined;
    const role = String(user?.role ?? (req as any).sdkPlatform ?? '').toLowerCase();
    const allowed =
      ['super_admin', 'org_admin', 'operator', 'admin', 'developer'].includes(role) ||
      Boolean((req as any).sdkKeyId);
    if (!allowed && user) {
      // JWT present but weak role
      const weakOk = ['manager', 'senior_analyst', 'analyst', 'sme'].includes(role);
      if (!weakOk) {
        return sendApiError(res, 'FORBIDDEN', {
          status: 403,
          overrideMessage: 'Insufficient role for NYS dashboard SSO',
          details: { code: 'SSO_FORBIDDEN' },
        });
      }
    }
    // SSO is Console/operator UX — require JWT user (not partner SDK key alone).
    // SDK keys can probe knowledge APIs; dashboard session mint needs an operator identity.
    if (!user) {
      return sendApiError(res, 'UNAUTHORIZED', {
        status: 401,
        overrideMessage: 'Operator JWT required for NYS dashboard SSO (use Console login)',
        details: { code: 'AUTH_REQUIRED' },
      });
    }

    const rawPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '/';
    const path =
      rawPath.startsWith('/') && !rawPath.startsWith('//') && !rawPath.includes('://')
        ? rawPath.slice(0, 200)
        : '/';
    const username = String(
      user?.email || user?.username || user?.userId || 'jrx-operator',
    ).slice(0, 120);
    const expMs = Date.now() + 60_000;
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = `v1|${username}|${path}|${expMs}|${nonce}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;

    const uiBase = (
      process.env.JRX_ECOSYSTEM_UI_BASE_URL ||
      process.env.JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL?.replace(/\/api\/?$/, '') ||
      'https://nyayasearch.jurexio.example'
    ).replace(/\/$/, '');
    const url = `${uiBase}/api/auth/sso/callback?token=${encodeURIComponent(token)}`;
    res.json({ success: true, url, expiresInSec: 60, path });
  } catch (err) {
    logger.warn('sso/launch failed', { error: (err as Error).message?.slice(0, 80) });
    return sendApiError(res, 'INTERNAL_ERROR', {
      status: 500,
      overrideMessage: 'Could not mint SSO launch URL',
      details: { code: 'SSO_LAUNCH_FAILED' },
    });
  }
});

/** GET /api/jrx/knowledge/statutes */
router.get('/statutes', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: '/statutes',
    query: req.query as Record<string, string>,
  });
});

/** GET /api/jrx/knowledge/statutes/acts */
router.get('/statutes/acts', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: '/statutes/acts',
    query: {
      q: req.query.q ? String(req.query.q) : undefined,
      practiceArea: req.query.practiceArea ? String(req.query.practiceArea) : undefined,
      jurisdiction: req.query.jurisdiction ? String(req.query.jurisdiction) : undefined,
    },
  });
});

/** GET /api/jrx/knowledge/statutes/search */
router.get('/statutes/search', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: '/statutes/search',
    query: {
      q: String(req.query.q ?? req.query.query ?? ''),
      code: req.query.code ? String(req.query.code) : undefined,
      jurisdiction: req.query.jurisdiction ? String(req.query.jurisdiction) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 10,
    },
  });
});

/*
 * NV-COMPARE-SLUG-ALIAS-001 (2026-08-18) — accept the slug names partners actually send.
 *
 * NYS implements exactly three: `ipc-bns`, `old-new`, `new-old`. NSP's SDK exposes
 * `compareNewToOld(section, from)` and has never received a result, and when verifying their
 * ask I reproduced the cause: `bns-ipc`, `new-to-old`, `bnss-crpc` and `bsa-iea` all 404,
 * because they are reasonable names for a route that is spelled `new-old`.
 *
 * Aliasing here rather than asking every partner to change a client: the reverse mapping is
 * fully built and NCRB-backed, so a 404 on a naming guess is a self-inflicted integration
 * failure. Unknown slugs are passed through untouched so a genuinely new NYS route needs no
 * change here.
 */
const COMPARE_SLUG_ALIASES: Readonly<Record<string, string>> = {
  'bns-ipc': 'new-old',
  'bnss-crpc': 'new-old',
  'bsa-iea': 'new-old',
  'new-to-old': 'new-old',
  newtoold: 'new-old',
  'old-to-new': 'old-new',
  oldtonew: 'old-new',
  'ipc-to-bns': 'ipc-bns',
  'crpc-bnss': 'old-new',
  'iea-bsa': 'old-new',
};

/**
 * Normalise a compare slug, and infer `from` when the slug itself names the source code.
 * `bnss-crpc` means "from BNSS", which NYS expects as `?from=BNSS` on `new-old`.
 */
function resolveCompareSlug(raw: string): { kind: string; inferredFrom?: string } {
  const key = String(raw || '').trim().toLowerCase();
  const kind = COMPARE_SLUG_ALIASES[key] ?? key;
  const FROM_BY_SLUG: Readonly<Record<string, string>> = {
    'bns-ipc': 'BNS',
    'bnss-crpc': 'BNSS',
    'bsa-iea': 'BSA',
  };
  return { kind, inferredFrom: FROM_BY_SLUG[key] };
}

/*
 * NV-CITATOR-NUMERIC-TOKEN-001 — the private copies of `normaliseAuthorityText`,
 * `authorityTokens`, `resolveAuthority`, both token sets and `CITATION_RE_LOOSE` that used to
 * live here are retired. They now come from `src/services/jrx-authority-identity.ts`, which the
 * attribution step already imports.
 *
 * The duplicate was not merely untidy: this endpoint and the attribution step have to agree
 * about who the authority IS, and the numeric-token defect had to be fixed in two places at
 * once precisely because they had diverged into two definitions of the same thing.
 */

/*
 * NV-CITATOR-NEGATIVE-TREATMENT-001 — GET /api/jrx/knowledge/caselaw/treatment
 *
 * The §1c interim NSP asked for: a negative-treatment check in the shape they specified, so
 * they can wire it now and we can widen it to the full graph later without a contract change.
 *
 * Deliberately NOT the full citator. `goodLaw` will be `"unknown"` for most authorities and
 * that is the honest answer — NSP renders it as "treatment unknown" rather than implying an
 * authority is safe. It exists because the thing that LOOKED like a citator
 * (`overruled_case_check`) is a semantic search over the words "overruled distinguished" and
 * would let a judgment that merely discusses overruling read as one that performs it.
 *
 * `good` is unreachable by construction (see jrx-citator-treatment.ts): absence of adverse
 * language in a bounded retrieval is not evidence of good law.
 */
router.get('/caselaw/treatment', async (req, res) => {
  if (!flagOr503(res)) return;
  const citation = String(req.query.citation ?? '').trim();
  const direction = String(req.query.direction ?? 'citing').trim();
  if (!citation) {
    return void res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'citation is required' },
    });
  }

  /*
   * Retrieve judgments whose text is likely to CITE this authority, then read the treatment
   * out of the text. Searching for the authority alongside treatment vocabulary is what
   * biases retrieval towards passages that act on it rather than merely list it — but note
   * this is retrieval bias, not a citation graph, which is exactly why `coverage` is
   * returned and why `good` is not assertable.
   */
  const search = await nysKnowledgeRequest({
    method: 'GET',
    path: '/caselaw/search',
    query: {
      q: `${citation} overruled per incuriam doubted correctness follow distinguished`,
      limit: 20,
      mode: 'hybrid',
      jurisdiction: 'IN',
    },
    timeoutMs: 60_000,
    retries: 1,
    forwardApiKey: forwardKeyFromReq(req),
  });

  let graphEdges = 0;
  try {
    const { nyvGraphRAGLegal } = await import('../services/rag/jrx-graphrag-legal-service.js');
    const g = await nyvGraphRAGLegal.getStats();
    graphEdges = g.totalEdges;
  } catch {
    graphEdges = 0;
  }

  const payload = (search.ok ? (search.data as any) : null) ?? {};
  const results: any[] = Array.isArray(payload.results) ? payload.results : [];
  const searchDegraded = !search.ok || payload.degraded === true;
  const passages = results.map((r) => ({
    /* Judgment bodies are large; the searchable fields carry the operative language and keep
     * the scan bounded. */
    text: [r.title, r.description, r.disposalNature, r.court].filter(Boolean).join('. '),
    citation: r.citation ?? null,
  }));

  const { detectNegativeTreatment } = await import('../services/jrx-citator-treatment.js');
  /*
   * NV-CITATOR-AUTHORITY-RESOLVE-001 — resolve the authority against its OWN lookup.
   *
   * The `search` above deliberately appends treatment vocabulary, so it returns judgments
   * likely to CITE the authority — the authority itself is usually NOT among them. Resolving
   * against that result set is what produced NSP's mislabelling: `results[0]` was a citing
   * (or merely stem-similar) judgment being reported as the authority.
   *
   * The query is built from the DISTINCTIVE tokens, not the raw citation. Measured on the
   * live corpus: `q=Kesavananda Bharati v. State of Kerala` returns 0 rows and
   * `q=Maneka Gandhi v. Union of India` returns 0, while `Kesavananda Bharati` returns the
   * real 1973 Supreme Court judgment and `Maneka Gandhi` returns 10. The connectives and
   * generic respondents ("v.", "Union of India") are what starve the match, so retrieval is
   * deliberately broad here and `resolveAuthority` does the strict verification against the
   * full token set.
   *
   * `mode=fts` because this is a title/citation lookup, not a semantic neighbourhood, and
   * because hybrid 503s under embed load — identity must not fail when the vector rail is busy.
   */
  const { distinctive } = authorityTokens(citation);
  const idQuery = distinctive.length > 0 ? distinctive.join(' ') : citation;
  const idLookup = await nysKnowledgeRequest({
    method: 'GET',
    path: '/caselaw/search',
    query: { q: idQuery, limit: 10, mode: 'fts', jurisdiction: 'IN' },
    timeoutMs: 30_000,
    retries: 1,
    forwardApiKey: forwardKeyFromReq(req),
  });
  const idCandidates: any[] = Array.isArray((idLookup.data as any)?.results)
    ? (idLookup.data as any).results
    : [];

  const exactOnly = /^(1|true|yes)$/i.test(String(req.query.exact ?? ''));
  const resolved = resolveAuthority(citation, idCandidates, { exactOnly });

  const verdict = detectNegativeTreatment({
    passages,
    corpusCoveragePct:
      typeof payload?.embeddingCoverage?.coveragePct === 'number'
        ? payload.embeddingCoverage.coveragePct
        : null,
    /* topK-capped, so a null result means "not found in 20 passages", not "not in the
     * corpus". NSP needs that distinction to avoid over-claiming. */
    retrievalLimited: results.length >= 20,
  });

  /*
   * When the authority could not be identified, the verdict describes passages that may
   * concern a different case entirely, so it must not be reported as a finding about the
   * requested authority. Force `unknown` with an explicit reason.
   */
  const authorityUnresolved = !resolved.matched;
  const goodLaw = authorityUnresolved ? 'unknown' : verdict.goodLaw;
  const unknownReason = authorityUnresolved
    ? 'authority_not_identified'
    : verdict.unknownReason;

  res.json({
    success: true,
    source: 'jrx-deterministic-treatment',
    data: {
      authority: {
        /* Echo what was asked for, always. */
        citation,
        /* NULL rather than a guess when unresolved. NSP reported that a caller trusting this
         * block would mislabel a 2018 Kerala HC matter as the 1973 Supreme Court authority. */
        title: resolved.matched ? (resolved.record?.title ?? null) : null,
        court: resolved.matched ? (resolved.record?.court ?? null) : null,
        year: resolved.matched ? (resolved.record?.year ?? null) : null,
        matchedCitation: resolved.matched ? (resolved.record?.citation ?? null) : null,
        /* The confidence field NSP asked for, plus HOW it was reached, so a UI can badge an
         * exact-citation match differently from one made on party names. */
        resolution: {
          matched: resolved.matched,
          confidence: resolved.confidence,
          method: resolved.method,
          exactModeRequested: exactOnly,
        },
      },
      direction,
      /* Always present, including "unknown" — a silent omission reads as "good law". */
      goodLaw,
      /* Withheld when unresolved: these rows may describe another case, and attributing them
       * to the requested authority is precisely the mislabelling NSP hit. */
      treatments: authorityUnresolved ? [] : verdict.treatments,
      coverage: verdict.coverage,
      ...(unknownReason ? { unknownReason } : {}),
      graph: {
        available: graphEdges > 0,
        edgeCount: graphEdges,
        ...(graphEdges === 0
          ? {
              unavailableReason:
                'Citation graph ingest is in progress or empty; treatment is phrase-based retrieval only.',
            }
          : {}),
      },
      ...(searchDegraded
        ? {
            searchDegraded: true,
            searchMessage:
              'Caselaw retrieval for treatment scan was degraded; goodLaw may reflect partial coverage only.',
          }
        : {}),
      /* Stated in the payload so a UI cannot present this as a full citator by accident. */
      limitations:
        'Deterministic phrase extraction over retrieved passages. Not a citation graph: '
        + 'absence of adverse treatment is not evidence of good law, and `good` is never asserted. '
        + 'Verify against official law reports before relying on this in filed work.',
    },
  });
});

/** GET /api/jrx/knowledge/statutes/compare/* — proxy remaining compare paths */
router.get('/statutes/compare/:kind', async (req, res) => {
  const { kind, inferredFrom } = resolveCompareSlug(req.params.kind);
  const query = { ...(req.query as Record<string, string>) };
  if (inferredFrom && !query.from) query.from = inferredFrom;
  await proxy(req, res, {
    method: 'GET',
    nysPath: `/statutes/compare/${encodeURIComponent(kind)}`,
    query,
  });
});

router.post('/statutes/compare/:kind', async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const { kind, inferredFrom } = resolveCompareSlug(req.params.kind);
  const query: Record<string, string | number | undefined | null> = {
    ...(req.query as Record<string, string>),
    section: body.section != null ? String(body.section) : undefined,
    from: body.from != null ? String(body.from) : inferredFrom,
    ipcSection: body.ipcSection != null ? String(body.ipcSection) : undefined,
  };
  if (!query.section && query.ipcSection) query.section = String(query.ipcSection);
  await proxy(req, res, {
    method: 'GET',
    nysPath: `/statutes/compare/${encodeURIComponent(kind)}`,
    query,
  });
});

/** POST /api/jrx/knowledge/citations/extract */
router.post('/citations/extract', async (req, res) => {
  await proxy(req, res, {
    method: 'POST',
    nysPath: '/citations/extract',
    body: req.body,
  });
});

/** POST /api/jrx/knowledge/documents/search — Athena archive (Phase 2 budget) */
router.post('/documents/search', async (req, res) => {
  await proxy(req, res, {
    method: 'POST',
    nysPath: '/athena/search',
    body: normalizeNysAthenaSearchBody(req.body as Record<string, unknown>),
    timeoutMs: NV_TIMEOUTS.athenaQueryBudgetMs,
  });
});

router.get('/documents/status', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: '/athena/status',
    timeoutMs: 5_000,
  });
});

router.get('/documents/document', async (req, res) => {
  await proxy(req, res, {
    method: 'GET',
    nysPath: '/athena/document',
    query: req.query as Record<string, string>,
  });
});

router.post('/documents/extract', async (req, res) => {
  await proxy(req, res, {
    method: 'POST',
    nysPath: '/athena/extract',
    body: req.body,
    timeoutMs: 60_000,
  });
});

/**
 * POST /api/jrx/knowledge/judgments/full-text — NV-JRX-FULLTEXT-001.
 *
 * The single call a caller needs for "give me the full judgment". Joins the two
 * NYS archive hops (Athena metadata resolve → S3 PDF extract) that were
 * previously only exposed as separate proxies with nothing connecting them, so
 * a caller holding a case NAME (not an s3Path) had no route to the body.
 *
 * On-demand by construction: nothing invokes this except an explicit request.
 * It is NOT in the RAG grounding path — judgment bodies run to hundreds of
 * thousands of characters and HC-scope resolution scans ~1.3 GB of Athena per
 * query, so pulling this into default context would be both wrong and costly.
 *
 * Body: { s3Path?, query?, archive?: 'sc'|'hc', year?, court?, title?,
 *         maxChars? } — one of s3Path | query is required.
 */
router.post('/judgments/full-text', async (req, res) => {
  if (!flagOr503(res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const archiveRaw = typeof body.archive === 'string' ? body.archive.toLowerCase() : '';
  const archive: JudgmentArchiveScope | undefined =
    archiveRaw === 'hc' ? 'hc' : archiveRaw === 'sc' ? 'sc' : undefined;
  const yearNum = body.year === undefined || body.year === null ? undefined : Number(body.year);
  // Callers that only want a citable excerpt can cap the payload rather than
  // receive a 500k-char body they will immediately truncate.
  const maxCharsNum =
    body.maxChars === undefined || body.maxChars === null ? undefined : Number(body.maxChars);
  const maxChars =
    maxCharsNum !== undefined && Number.isFinite(maxCharsNum) && maxCharsNum > 0
      ? Math.min(Math.floor(maxCharsNum), 500_000)
      : undefined;

  const result = await fetchJudgmentFullText({
    s3Path: typeof body.s3Path === 'string' ? body.s3Path : undefined,
    query: typeof body.query === 'string' ? body.query : undefined,
    archive,
    year: yearNum !== undefined && Number.isFinite(yearNum) ? yearNum : undefined,
    court: typeof body.court === 'string' ? body.court : undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
    // JRX-JUDGMENT-STRUCTURE-001 — opt-in `paras[]` + structured fields.
    structure: body.structure === true || body.structure === 'true',
  });

  if (!result.ok) {
    res.status(result.status).json({
      success: false,
      error: {
        code: result.code,
        message: sanitizeErrorForClient(result.error),
        ...(result.candidates?.length ? { candidates: result.candidates } : {}),
      },
    });
    return;
  }

  /*
   * Two independent causes of a partial body, and they must not mask each
   * other. `upstreamTruncated` is NYS stopping at its page / time / char budget
   * (Kesavananda is 1,006 pages and 2,878,447 chars); `clippedHere` is this
   * route honouring the caller's own `maxChars`. Spreading `result` first would
   * let the locally-computed flag overwrite the upstream one, so a caller that
   * passed no `maxChars` would be told `truncated: false` about a body NYS had
   * already cut short — silent truncation of an authority, which is worse than
   * a refusal because a caller cannot know to re-read.
   */
  const clippedHere = maxChars !== undefined && result.text.length > maxChars;
  res.json({
    success: true,
    source: 'nys-knowledge-plane',
    data: {
      ...result,
      text: clippedHere ? result.text.slice(0, maxChars) : result.text,
      textLength: clippedHere ? maxChars : result.textLength,
      /* Spread first, merged flags second: the locally-computed value must not
       * be overwritten by `result.truncated`, nor overwrite it. */
      ...mergeTruncation({ upstreamTruncated: result.truncated, clippedHere }),
      ...(clippedHere ? { fullTextLength: result.textLength } : {}),
      ...(result.structure ? { parasMeta: buildParasMeta(result.structure) } : {}),
    },
  });
});

/** GET /api/jrx/knowledge/templates — prefer NYS; fall back to JRX canonical catalog */
router.get('/templates', async (req, res) => {
  if (!flagOr503(res)) return;
  if (isNysKnowledgeConfigured()) {
    const result = await nysKnowledgeRequest({
      method: 'GET',
      path: '/templates',
      query: {
        kind: req.query.kind ? String(req.query.kind) : undefined,
        jurisdiction: req.query.jurisdiction ? String(req.query.jurisdiction) : undefined,
        search: String(req.query.search ?? req.query.q ?? '') || undefined,
      },
      forwardApiKey: forwardKeyFromReq(req),
    });
    if (result.ok) {
      res.status(result.status === 204 ? 200 : result.status).json({
        success: true,
        source: 'nys-knowledge-plane',
        data: result.data,
      });
      return;
    }
    logger.warn('knowledge/templates NYS failed; falling back to JRX catalog', {
      error: result.error,
      status: result.status,
    });
  }
  try {
    const { nspCatalogEnvelope } = await import('../services/jrx-templates-catalog-service.js');
    const envelope = nspCatalogEnvelope({
      jurisdiction: req.query.jurisdiction ? String(req.query.jurisdiction) : undefined,
      kind: req.query.kind ? String(req.query.kind) : undefined,
      q: String(req.query.search ?? req.query.q ?? '') || undefined,
    });
    res.json({ ...envelope, source: 'jrx-templates-catalog' });
  } catch (e) {
    logger.error('knowledge/templates catalog fallback failed', { error: (e as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (e as Error).message });
  }
});

router.get('/templates/:id', async (req, res) => {
  if (!flagOr503(res)) return;
  if (isNysKnowledgeConfigured()) {
    const result = await nysKnowledgeRequest({
      method: 'GET',
      path: `/templates/${encodeURIComponent(req.params.id)}`,
      forwardApiKey: forwardKeyFromReq(req),
    });
    if (result.ok) {
      res.status(result.status === 204 ? 200 : result.status).json({
        success: true,
        source: 'nys-knowledge-plane',
        data: result.data,
      });
      return;
    }
  }
  try {
    const { getTemplateById } = await import('../services/jrx-templates-catalog-service.js');
    const template = getTemplateById(String(req.params.id));
    if (!template) {
      sendApiError(res, 'NOT_FOUND', { overrideMessage: 'Template not found' });
      return;
    }
    res.json({ success: true, source: 'jrx-templates-catalog', data: template });
  } catch (e) {
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (e as Error).message });
  }
});

/** Catch-all knowledge search for SDK KnowledgeApi.search */
router.post('/search', async (req, res) => {
  if (!flagOr503(res)) return;
  const query = String(req.body?.query ?? '');
  const jurisdiction = String(req.body?.jurisdiction ?? 'IN');
  const limit = Number(req.body?.limit ?? 10);
  if (!query) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'query is required' });
    return;
  }
  // Prefer unified Auto-RAG (includes NYS layer when flag on)
  try {
    const { autoRagRetrieve, formatAutoRagContext } = await import('../services/jrx-auto-rag-router.js');
    const result = await autoRagRetrieve({
      query,
      jurisdiction,
      topK: limit,
      tier: 'pro',
      taskType: String(req.body?.taskType ?? 'research'),
    });
    res.json({
      success: true,
      query,
      jurisdiction,
      chunks: result.chunks,
      contextBlock: formatAutoRagContext(result),
      intent: result.intent,
      layersUsed: result.layersUsed,
      retrievalMethods: result.retrievalMethods,
      confidence: result.confidence,
      groundingConfidence: result.confidence,
      ungrounded: result.chunks.length === 0,
      latencyMs: result.latencyMs,
      source: 'auto-rag+nys',
      // NV-JRX-LLMREQUIRED-001 — surfaced so an SDK caller can skip its own
      // completion when the corpus already holds the whole answer.
      ...(result.deterministic
        ? {
            llmRequired: result.deterministic.llmRequired,
            ...(result.deterministic.answer
              ? {
                  deterministicAnswer: {
                    content: result.deterministic.answer.content,
                    citations: result.deterministic.answer.citations,
                    model: result.deterministic.answer.resolver,
                    provider: './jrx-deterministic',
                    intent: result.deterministic.answer.intent,
                    tokens: { prompt: 0, completion: 0, total: 0 },
                  },
                }
              : {}),
          }
        : {}),
    });
  } catch (e) {
    logger.error('knowledge/search failed', { error: (e as Error).message });
    sendApiError(res, 'INTERNAL_ERROR', { overrideMessage: (e as Error).message });
  }
});

router.get('/stats', async (req, res) => {
  const stats = getNysKnowledgeClientStats();
  const caselaw = isNysKnowledgeConfigured() && isJrxFeatureOn('nysKnowledgePlane')
    ? await nysKnowledgeRequest({ method: 'GET', path: '/caselaw/stats' })
    : null;
  res.json({
    success: true,
    plane: stats,
    caselaw: caselaw?.ok ? caselaw.data : null,
    flag: isJrxFeatureOn('nysKnowledgePlane'),
  });
});

export default router;
