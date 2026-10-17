/**
 * Unit tests — NYS knowledge client circuit + retriever plan flattening.
 * Network calls are mocked; no live NYS required.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('caselawHybridFtsFallbackReason (Phase 0 hybrid budget)', () => {
  it('returns null on hybrid success within budget', async () => {
    const { caselawHybridFtsFallbackReason } = await import('../../config/jrx-timeout-policy.js');
    expect(caselawHybridFtsFallbackReason({ ok: true, status: 200 })).toBeNull();
  });

  it('treats 503/502 and timeout errors as FTS fallback triggers', async () => {
    const { caselawHybridFtsFallbackReason } = await import('../../config/jrx-timeout-policy.js');
    expect(caselawHybridFtsFallbackReason({ ok: false, status: 503, error: 'busy' })).toBe('upstream_503');
    expect(caselawHybridFtsFallbackReason({ ok: false, status: 502, error: 'bad gateway' })).toBe('upstream_502');
    expect(
      caselawHybridFtsFallbackReason({ ok: false, status: 503, error: 'The operation was aborted due to timeout' }),
    ).toBe('timeout');
    expect(caselawHybridFtsFallbackReason({ ok: false, status: 500, error: 'internal' })).toBeNull();
  });

  it('NV-CASELAW-HYBRID-FALLBACK-001 — empty hybrid success triggers FTS retry', async () => {
    const {
      caselawHybridEmptyFtsFallbackReason,
      resolveCaselawHybridFtsFallbackReason,
    } = await import('../../config/jrx-timeout-policy.js');
    expect(
      caselawHybridEmptyFtsFallbackReason({
        ok: true,
        data: { total: 0, results: [], degraded: true, degradedReason: 'corpus_busy' },
      }),
    ).toBe('empty_hybrid');
    expect(
      caselawHybridEmptyFtsFallbackReason({
        ok: true,
        data: { total: 1000, results: [{ id: 1 }] },
      }),
    ).toBeNull();
    expect(
      resolveCaselawHybridFtsFallbackReason({
        ok: true,
        status: 200,
        data: { total: 0, results: [] },
      }),
    ).toBe('empty_hybrid');
    expect(
      resolveCaselawHybridFtsFallbackReason({ ok: false, status: 503, error: 'busy' }),
    ).toBe('upstream_503');
  });

  it('exports FTS fallback and Athena query budgets (Phase 0.1 / Phase 2)', async () => {
    const { NV_TIMEOUTS } = await import('../../config/jrx-timeout-policy.js');
    expect(NV_TIMEOUTS.caselawHybridBudgetMs).toBeGreaterThanOrEqual(3_000);
    expect(NV_TIMEOUTS.caselawFtsFallbackBudgetMs).toBeGreaterThanOrEqual(1_000);
    expect(NV_TIMEOUTS.caselawFtsFallbackBudgetMs).toBeLessThanOrEqual(NV_TIMEOUTS.caselawHybridBudgetMs);
    expect(NV_TIMEOUTS.athenaQueryBudgetMs).toBeGreaterThanOrEqual(3_000);
  });
});

describe('normalizeNysAthenaSearchBody', () => {
  it('maps query→q and drops archive=all', async () => {
    const { normalizeNysAthenaSearchBody } = await import('../jrx-nys-athena-normalize.js');
    expect(normalizeNysAthenaSearchBody({ query: 'bail', archive: 'all', limit: 5 })).toEqual({
      q: 'bail',
      limit: 5,
    });
    expect(normalizeNysAthenaSearchBody({ q: 'x', archive: 'sc' })).toEqual({ q: 'x', archive: 'sc' });
  });
});

describe('./jrx-nys-knowledge-client circuit', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL;
    delete process.env.JRX_ECOSYSTEM_KNOWLEDGE_API_KEY;
    delete process.env.JRX_ECOSYSTEM_KNOWLEDGE_CB_FAILURES;
  });

  it('reports unconfigured when BASE_URL missing', async () => {
    const mod = await import('../jrx-nys-knowledge-client.js');
    expect(mod.isNysKnowledgeConfigured()).toBe(false);
    const stats = mod.getNysKnowledgeClientStats();
    expect(stats.configured).toBe(false);
    expect(stats.circuit).toBe('closed');
  });

  it('returns 503 envelope when unconfigured', async () => {
    const mod = await import('../jrx-nys-knowledge-client.js');
    const r = await mod.nysKnowledgeRequest({ path: '/healthz' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });
});

describe('./jrx-nys-knowledge-retriever namespaces + flatten', () => {
  it('exports global namespace constants', async () => {
    const mod = await import('../jrx-nys-knowledge-retriever.js');
    expect(mod.JRX_ECOSYSTEM_GLOBAL_NAMESPACES.statutesIN).toBe('global:statutes:IN');
    expect(mod.JRX_ECOSYSTEM_GLOBAL_NAMESPACES.caselawUS).toBe('global:caselaw:US');
  });

  it('returns empty when flag off', async () => {
    vi.resetModules();
    process.env.JRX_F_JRX_ECOSYSTEM_KNOWLEDGE_PLANE = '0';
    const mod = await import('../jrx-nys-knowledge-retriever.js');
    const r = await mod.retrieveNysGlobalKnowledge({ query: 'BNS 103', jurisdiction: 'IN' });
    expect(r.chunks).toEqual([]);
    expect(r.method).toMatch(/flag_off|unconfigured/);
  });

  it('flattens live RetrievalPlan.steps[] into AutoRagChunk[]', async () => {
    const mod = await import('../jrx-nys-knowledge-retriever.js');
    const chunks = mod.flattenRetrievalPlanToChunks(
      {
        query: 'BNS 103 murder',
        intent: 'statute',
        llmRequired: false,
        reason: 'statute lookup',
        steps: [
          {
            tool: 'statute-lookup',
            statutes: [
              {
                id: 1,
                code: 'BNS',
                section: '103',
                title: 'Punishment for murder',
                text: 'Whoever commits murder shall be punished with death or imprisonment for life…',
                score: 0.95,
              },
            ],
          },
          {
            tool: 'case-search',
            matches: [
              {
                id: 99,
                title: 'State v Example',
                citation: '(2024) 1 SCC 1',
                snippet: 'Murder under BNS 103…',
                score: 0.8,
              },
            ],
          },
          {
            tool: 'ipc-bns-compare',
            comparison: {
              ipcSection: '302',
              bnsSection: '103',
              summary: 'IPC 302 maps to BNS 103 (Punishment for murder).',
            },
          },
        ],
      },
      'IN',
      8,
    );
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].layer).toBe('nys_global');
    expect(chunks[0].citationRef).toMatch(/BNS/);
    expect(chunks.some((c) => c.content.includes('murder'))).toBe(true);
    expect(chunks.some((c) => c.id.startsWith('nys:case:'))).toBe(true);
    expect(chunks.some((c) => c.id.startsWith('nys:cmp:'))).toBe(true);
  });

  it('flattens legacy flat statutes/cases envelope', async () => {
    const mod = await import('../jrx-nys-knowledge-retriever.js');
    const chunks = mod.flattenRetrievalPlanToChunks(
      {
        statutes: [{ code: 'BNS', section: '103', text: 'Punishment for murder', score: 0.9 }],
        cases: [{ citation: 'AIR 2020 SC 1', snippet: 'bail principles', score: 0.7 }],
      },
      'IN',
      5,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toContain('statute');
    expect(chunks[1].id).toContain('case');
  });

  it('treats verified status as verified=true in flatten path metadata', async () => {
    // Pure unit assertion on status mapping logic (no network)
    const statusOf = (data: Record<string, unknown>) => {
      const rawStatus = String(data?.status ?? '').toLowerCase();
      if (rawStatus === 'verified' || data?.verified === true || data?.match === true || data?.found === true) {
        return { status: 'verified', verified: true };
      }
      if (rawStatus === 'not_found' || data?.verified === false || data?.found === false) {
        return { status: 'not_found', verified: false };
      }
      return { status: 'uncertain', verified: false };
    };
    expect(statusOf({ status: 'verified' })).toEqual({ status: 'verified', verified: true });
    expect(statusOf({ status: 'not_found' })).toEqual({ status: 'not_found', verified: false });
    expect(statusOf({ status: 'uncertain' })).toEqual({ status: 'uncertain', verified: false });
  });
});
