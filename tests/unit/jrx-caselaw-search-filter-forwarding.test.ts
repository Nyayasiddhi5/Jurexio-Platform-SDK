/**
 * NYV-2 / NYS-CASELAW-SEARCH-FILTERS-001 — every filter NYS accepts must be reachable through
 * the gateway.
 *
 * The defect this file exists to prevent: NYS shipped a court-tier filter and a
 * pagination/filter/sort surface, and the gateway's `baseQuery` was
 * `{ q, jurisdiction, year, court, limit }`. Measured live at deployed sha 232a92e4:
 * `courtType=sc` through the gateway returned the identical five Bombay High Court ids as the
 * unfiltered call (total 10,000), while the same call NYS-direct returned 12 rows, all
 * "Supreme Court of India". A partner could not express a court-tier filter at all.
 *
 * There was no test on this surface — which is why a whole parameter family could be built on
 * one side and be unreachable from the other. The guard below is deliberately derived from the
 * NYS route's own zod schema rather than a hand-written list, so a parameter added on the NYS
 * side fails HERE until the gateway forwards it, instead of shipping unreachable.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const nysRequestMock = vi.fn();

vi.mock('../../src/services/jrx-nys-knowledge-client.js', () => ({
  nysKnowledgeRequest: (...a: unknown[]) => nysRequestMock(...a),
  forwardKeyFromReq: () => undefined,
  getNysKnowledgeClientStats: () => ({}),
  isNysKnowledgeConfigured: () => true,
  nysKnowledgeHealthz: async () => ({ ok: true }),
}));

vi.mock('../../src/middleware/jrx-dual-auth.js', () => ({
  dualSdkOrJwt: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/middleware/jrx-partner-india-scope.js', () => ({
  partnerIndiaScopeMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/config/jrx-feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNyvFeatureOn: () => true,
}));

const NYS_ROUTE_SRC = readFileSync(
  join(process.cwd(), 'jrx-search/artifacts/api-server/src/routes/caselaw.ts'),
  'utf8',
);

/** Every key of NYS's own `searchQuerySchema` — the authoritative accepted-parameter list. */
function nysAcceptedSearchParams(): string[] {
  const start = NYS_ROUTE_SRC.indexOf('const searchQuerySchema = z.object({');
  expect(start, 'NYS searchQuerySchema must be findable').toBeGreaterThan(-1);
  const end = NYS_ROUTE_SRC.indexOf('\n});', start);
  const block = NYS_ROUTE_SRC.slice(start, end);
  const keys = [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*z\./gm)].map((m) => m[1]);
  expect(keys.length, 'schema key extraction must not come back empty').toBeGreaterThan(10);
  return keys;
}

let base: string;
let server: Server;

beforeAll(async () => {
  const { default: router } = await import('../../src/routes/jrx-knowledge-plane-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/jrx/knowledge', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return () => void server.close();
});

/** Run one gateway search and hand back the query object the NYS client was called with. */
async function forwardedQuery(qs: string): Promise<Record<string, unknown>> {
  nysRequestMock.mockReset();
  nysRequestMock.mockResolvedValue({ ok: true, status: 200, data: { results: [], total: 0 } });
  const res = await fetch(`${base}/api/jrx/knowledge/caselaw/search?${qs}`);
  expect(res.status, 'positive control: the route must have answered 200').toBe(200);
  expect(nysRequestMock, 'positive control: NYS must have been called').toHaveBeenCalled();
  return nysRequestMock.mock.calls[0][0].query as Record<string, unknown>;
}

describe('caselaw/search — the court-tier filter reaches NYS', () => {
  it('forwards courtType, which the gateway used to drop entirely', async () => {
    const q = await forwardedQuery('q=anticipatory+bail&courtType=sc');
    expect(q.courtType).toBe('sc');
  });

  it('does not invent a courtType when the caller sent none', async () => {
    /* An unfiltered call must stay byte-identical to the pre-change behaviour: a defaulted
     * `courtType` would silently narrow every existing partner query. */
    const q = await forwardedQuery('q=anticipatory+bail');
    expect(q.courtType).toBeUndefined();
  });

  it('forwards the value verbatim and lets NYS validate its own enum', async () => {
    /* Measured: NYS answers `courtType=SC` with a 400 naming the two legal values. Silently
     * lower-casing it here would hide a partner's mistake behind a different result set. */
    const q = await forwardedQuery('q=bail&courtType=SC');
    expect(q.courtType).toBe('SC');
  });
});

describe('caselaw/search — the full NYS parameter surface is reachable', () => {
  const sent =
    'q=anticipatory+bail&jurisdiction=IN&limit=5&offset=10&year=2019&yearFrom=2015&yearTo=2020' +
    '&dateFrom=2015-01-01&dateTo=2015-12-31&judge=chandrachud&reporter=SCC' +
    '&benchStrength=division&court=Supreme+Court+of+India&courtType=sc&sort=date&mode=fts';

  it('forwards every parameter NYS declares in its own schema', async () => {
    const q = await forwardedQuery(sent);
    const missing = nysAcceptedSearchParams().filter((k) => q[k] === undefined);
    expect(missing, 'NYS accepts these but the gateway drops them').toEqual([]);
  });

  it('invents no parameter NYS does not accept', async () => {
    const q = await forwardedQuery(sent);
    const accepted = new Set(nysAcceptedSearchParams());
    const extra = Object.keys(q).filter((k) => q[k] !== undefined && !accepted.has(k));
    expect(extra, 'gateway sends keys NYS would reject or ignore').toEqual([]);
  });

  it('coerces the numeric parameters and passes the string ones through', async () => {
    const q = await forwardedQuery(sent);
    expect(q.offset).toBe(10);
    expect(q.yearFrom).toBe(2015);
    expect(q.yearTo).toBe(2020);
    expect(q.judge).toBe('chandrachud');
    expect(q.reporter).toBe('SCC');
    expect(q.benchStrength).toBe('division');
    expect(q.sort).toBe('date');
    expect(q.dateFrom).toBe('2015-01-01');
  });

  it('keeps offset=0 rather than dropping it as falsy', async () => {
    /* `req.query.offset ? ... : undefined` would erase page one of an explicit pagination
     * loop, which is the kind of off-by-one that only shows up in a partner integration. */
    const q = await forwardedQuery('q=bail&offset=0');
    expect(q.offset).toBe(0);
  });

  it('sends nothing at all when the caller filters on nothing', async () => {
    const q = await forwardedQuery('q=bail');
    for (const k of ['offset', 'yearFrom', 'yearTo', 'dateFrom', 'dateTo', 'judge', 'reporter',
      'benchStrength', 'courtType', 'sort']) {
      expect(q[k], `${k} must stay absent`).toBeUndefined();
    }
  });

  it('carries the filters into the FTS retry, not just the first attempt', async () => {
    /* The hybrid→fts fallback rebuilds the query. A filter dropped only on the retry path is
     * worse than one dropped always: it works until the corpus is busy. */
    nysRequestMock.mockReset();
    nysRequestMock
      .mockResolvedValueOnce({ ok: false, status: 503, error: 'corpus is busy' })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { results: [], total: 0 } });
    const res = await fetch(
      `${base}/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&offset=5&mode=hybrid`,
    );
    expect(res.status).toBe(200);
    expect(nysRequestMock).toHaveBeenCalledTimes(2);
    const retry = nysRequestMock.mock.calls[1][0].query as Record<string, unknown>;
    expect(retry.courtType).toBe('sc');
    expect(retry.offset).toBe(5);
    expect(retry.mode).toBe('fts');
  });
});

describe('caselaw/search — NYS pagination metadata reaches the partner unchanged', () => {
  it('passes total, totalIsLowerBound, countCap, offset, sort and filterSupport through', async () => {
    const upstream = {
      jurisdiction: 'IN',
      total: 12,
      totalCapped: false,
      totalIsLowerBound: false,
      countCap: 1000,
      offset: 10,
      limit: 5,
      results: [{ id: 20525867, court: 'Supreme Court of India' }],
      method: 'fts',
      sort: 'date',
      filterSupport: { courtType: 'exact', benchStrength: 'high-court-only' },
      slo: { p95Ms: 1200 },
    };
    nysRequestMock.mockReset();
    nysRequestMock.mockResolvedValue({ ok: true, status: 200, data: upstream });
    const res = await fetch(`${base}/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc`);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    /* Unchanged means unchanged: a gateway that reshapes this block is how `citationRef` ended
     * up populated and never rendered. */
    expect(body.data).toEqual(upstream);
  });

  it('still marks a degraded answer without disturbing the upstream fields', async () => {
    nysRequestMock.mockReset();
    nysRequestMock
      .mockResolvedValueOnce({ ok: false, status: 503, error: 'corpus is busy' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { total: 3, results: [], filterSupport: { courtType: 'exact' } },
      });
    const res = await fetch(`${base}/api/jrx/knowledge/caselaw/search?q=bail&mode=hybrid`);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.fallbackMode).toBe('fts');
    expect(body.data.total).toBe(3);
    expect(body.data.filterSupport).toEqual({ courtType: 'exact' });
  });

  it('NV-CASELAW-HYBRID-FALLBACK-001 — retries FTS when hybrid returns empty within budget', async () => {
    nysRequestMock.mockReset();
    nysRequestMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { total: 0, results: [], degraded: true, degradedReason: 'corpus_busy' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { total: 1000, results: [{ id: 20525867, court: 'Supreme Court of India' }], method: 'fts' },
      });
    const res = await fetch(
      `${base}/api/jrx/knowledge/caselaw/search?q=Section%20420%20IPC&mode=hybrid`,
    );
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(nysRequestMock).toHaveBeenCalledTimes(2);
    expect(nysRequestMock.mock.calls[1][0].query.mode).toBe('fts');
    expect(body.data.searchMode).toBe('fts_fallback');
    expect(body.data.reason).toBe('empty_hybrid');
    expect(body.data.total).toBe(1000);
    expect(body.data.fallbackMode).toBe('fts');
  });
});
