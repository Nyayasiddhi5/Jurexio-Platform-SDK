/**
 * NV-ANALYZE-STATUS-005 / NV-NSP-503-PERMANENCE-006 — NSP blocker regressions.
 *
 * Two defects, one shape: a value that cannot distinguish two different facts.
 *
 * NYV-6: `entities: []` / `statutes: []` meant BOTH "we read the document and it has
 * no statutes" and "extraction threw". NSP could neither trust an empty result nor
 * retry a broken one. `analysisStatus` must therefore report at least two DIFFERENT
 * values across the two cases — a status field pinned to one value is the same defect
 * wearing a new key, so every test below asserts the negative case as well.
 *
 * NYV-7/8/9/10: the NYS circuit breaker was process-global, so slow `mode=hybrid`
 * calls opened it and then answered `mode=fts` — the mode NSP was told was safe — with
 * a local 503 for the whole cooldown. Partitioning must confine a trip to its surface.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCourtDocFieldBlock,
  extractCourtDocumentFields,
} from '../../src/services/jrx-court-document-fields.js';
import {
  __resetNysBreakersForTest,
  getNysKnowledgeClientStats,
  nysKnowledgeRequest,
} from '../../src/services/jrx-nys-knowledge-client.js';
import { deriveAnalysisStatus } from '../../src/services/legal-doc-analyze-service.js';

const PETITION = `IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
Criminal Petition No. 4471 of 2025
Between: Sri Ramesh Kumar Reddy, S/o Late Venkat Reddy, aged 42 years, R/o Jubilee Hills, Hyderabad ... Petitioner
AND
The State of Telangana, rep. by its Public Prosecutor ... Respondent
Crime No. 221 of 2025 of Banjara Hills Police Station, registered under Sections 420 and 406 of the Bharatiya Nyaya Sanhita, 2023.
Statutory notice under Section 138 of the Negotiable Instruments Act, 1881 was issued on 5 February 2025.
PRAYER: The petitioner prays that this Honourable Court may grant anticipatory bail.`;

describe('NYV-6 analysisStatus — empty must be distinguishable from failed', () => {
  it('reports "unstructured" for an analysis that completed and found nothing', () => {
    const block = buildCourtDocFieldBlock(null, null, null);
    expect(block.analysisStatus).toBe('unstructured');
    expect(block.fieldCount).toBe(0);
    // The reason must say the arrays are a RESULT, or a reader still cannot tell.
    expect(String(block.analysisStatusReason)).toMatch(/not a failure/i);
  });

  it('reports "failed" when extraction threw, with the SAME empty arrays', () => {
    const block = buildCourtDocFieldBlock(null, null, {
      failed: true,
      reason: 'extraction did not complete',
    });
    expect(block.analysisStatus).toBe('failed');
    // This is the crux: the arrays are byte-identical to the unstructured case, so
    // only the status carries the difference.
    expect(block.statutes).toEqual([]);
    expect(block.entitiesFlat).toEqual([]);
    expect(block.fieldCount).toBe(0);
  });

  it('the two cases differ ONLY in status — proving status is load-bearing', () => {
    const empty = buildCourtDocFieldBlock(null, null, null);
    const failed = buildCourtDocFieldBlock(null, null, { failed: true, reason: 'boom' });
    expect(empty.analysisStatus).not.toBe(failed.analysisStatus);
    for (const k of ['fields', 'statutes', 'entitiesFlat', 'deadlinesFlat', 'obligationsFlat', 'risksFlat', 'fieldCount', 'fieldSource']) {
      expect(empty[k], `${k} should be identical across the two cases`).toEqual(failed[k]);
    }
  });

  it('reports "structured" for a real filing — the success value is reachable', async () => {
    const extraction = await extractCourtDocumentFields(PETITION, 'IN');
    expect(extraction.fieldCount).toBeGreaterThan(0);
    const block = buildCourtDocFieldBlock(extraction, null, null);
    expect(block.analysisStatus).toBe('structured');
    expect(block.fieldSource).toBe('nyv');
  });

  it('reports "structured" from flat aliases alone (contract with no filing metadata)', () => {
    // The docs-pipeline path returns entities/risks for a contract that has no court
    // filing number. `fieldCount` is 0 there, but the result is genuinely structured.
    const block = buildCourtDocFieldBlock(null, {
      entities: [{ name: 'Acme Pvt Ltd' }],
      risks: [],
      deadlines: [],
      obligations: [],
    }, null);
    expect(block.analysisStatus).toBe('structured');
    expect(block.fieldCount).toBe(0);
  });

  it('failed outranks populated — a throw is never masked by salvaged fields', async () => {
    const extraction = await extractCourtDocumentFields(PETITION, 'IN');
    const block = buildCourtDocFieldBlock(extraction, null, { failed: true, reason: 'llm down' });
    // The degraded docs-pipeline branch hits exactly this: deterministic extraction
    // succeeded while the analyzer threw. Reporting "structured" would tell NSP the
    // analysis was fine.
    expect(block.analysisStatus).toBe('failed');
    expect(block.analysisStatusReason).toBe('llm down');
  });

  it('every status value is one of the three documented strings', () => {
    for (const block of [
      buildCourtDocFieldBlock(null, null, null),
      buildCourtDocFieldBlock(null, null, { failed: true }),
      buildCourtDocFieldBlock(null, { entities: [{ a: 1 }] }, null),
    ]) {
      expect(['structured', 'unstructured', 'failed']).toContain(block.analysisStatus);
      expect(typeof block.analysisStatusReason).toBe('string');
      expect(String(block.analysisStatusReason).length).toBeGreaterThan(0);
    }
  });
});

describe('NYV-6 EDJ worker path — a rejected extractor is not silently an empty array', () => {
  /* Closing a real mutation gap: the EDJ status was previously only asserted by
   * source-text grep, so a mutation that replaced the rejection filter with
   * `.filter(() => false)` left the suite GREEN. Grep proves a string exists; it does
   * not prove the logic works. `deriveAnalysisStatus` is pure precisely so this can be
   * exercised without Postgres or an LLM. */
  const ok = { status: 'fulfilled' } as const;
  const bad = { status: 'rejected' } as const;
  const all = (s: typeof ok | typeof bad) =>
    (['summary', 'clauses', 'obligations', 'risks', 'missingTerms', 'privacyAlerts'] as const)
      .map((n) => [n, s] as const);

  it('reports failed and NAMES the rejected extractor', () => {
    const out = deriveAnalysisStatus(
      [['summary', ok], ['clauses', ok], ['obligations', ok], ['risks', bad], ['missingTerms', ok], ['privacyAlerts', ok]],
      true,
    );
    expect(out.analysisStatus).toBe('failed');
    expect(out.failedExtractors).toEqual(['risks']);
    // Without the name, a consumer knows something broke but not which section to distrust.
    expect(out.analysisStatusReason).toContain('risks');
  });

  it('a rejection outranks content — partial data must not read as success', () => {
    const out = deriveAnalysisStatus([['risks', bad], ['clauses', ok]], true);
    expect(out.analysisStatus).toBe('failed');
  });

  it('reports unstructured when everything ran and found nothing', () => {
    const out = deriveAnalysisStatus(all(ok), false);
    expect(out.analysisStatus).toBe('unstructured');
    expect(out.failedExtractors).toEqual([]);
    expect(out.analysisStatusReason).toMatch(/not a failure/i);
  });

  it('reports structured when everything ran and found something', () => {
    const out = deriveAnalysisStatus(all(ok), true);
    expect(out.analysisStatus).toBe('structured');
  });

  it('lists every rejection, not just the first', () => {
    const out = deriveAnalysisStatus(all(bad), false);
    expect(out.failedExtractors).toHaveLength(6);
  });

  it('all three values are reachable — no status pinned to one outcome', () => {
    const seen = new Set([
      deriveAnalysisStatus(all(ok), true).analysisStatus,
      deriveAnalysisStatus(all(ok), false).analysisStatus,
      deriveAnalysisStatus(all(bad), false).analysisStatus,
    ]);
    expect(seen).toEqual(new Set(['structured', 'unstructured', 'failed']));
  });
});

describe('NYV-10 NYS breaker is partitioned per surface', () => {
  const REAL_BASE = process.env.NYS_KNOWLEDGE_BASE_URL;

  beforeEach(() => {
    __resetNysBreakersForTest();
    // Point at a closed port so every call fails fast and deterministically without
    // touching the live NYS host.
    process.env.NYS_KNOWLEDGE_BASE_URL = 'http://127.0.0.1:9';
    process.env.NYS_KNOWLEDGE_RETRIES = '0';
    process.env.NYS_KNOWLEDGE_CB_FAILURES = '2';
    process.env.NYS_KNOWLEDGE_CB_COOLDOWN_MS = '60000';
  });

  it('opening caselaw/search does NOT open legal-work — the NSP defect', async () => {
    for (let i = 0; i < 3; i++) {
      await nysKnowledgeRequest({ path: '/caselaw/search', query: { q: 'x' }, timeoutMs: 800 });
    }
    const open = getNysKnowledgeClientStats().openCircuits ?? [];
    expect(open).toContain('caselaw/search');

    // A different surface must still attempt the upstream. Before partitioning this
    // returned the local "circuit open" 503 without a network call at all.
    const other = await nysKnowledgeRequest({ path: '/legal-work/tasks', timeoutMs: 800 });
    expect(other.ok).toBe(false);
    expect(String((other as { error: string }).error)).not.toMatch(/circuit open/i);
  });

  it('a tripped surface DOES report circuit open — protection still works', async () => {
    for (let i = 0; i < 3; i++) {
      await nysKnowledgeRequest({ path: '/caselaw/search', timeoutMs: 800 });
    }
    const again = await nysKnowledgeRequest({ path: '/caselaw/search', timeoutMs: 800 });
    expect(String((again as { error: string }).error)).toMatch(/circuit open/i);
    expect(again.status).toBe(503);
  });

  it('names the tripped surface so an operator can see WHICH one failed', async () => {
    for (let i = 0; i < 3; i++) {
      await nysKnowledgeRequest({ path: '/caselaw/search', timeoutMs: 800 });
    }
    const again = await nysKnowledgeRequest({ path: '/caselaw/search', timeoutMs: 800 });
    expect(String((again as { error: string }).error)).toContain('caselaw/search');
  });

  it('search modes share a bucket — hybrid and fts are the same NYS surface', async () => {
    // Deliberate: `mode` is a query param on one endpoint, so it cannot be partitioned
    // further without pretending two modes are two upstreams. The fix that protects
    // `fts` is the raised threshold + shorter cooldown, asserted by the env pins.
    for (let i = 0; i < 3; i++) {
      await nysKnowledgeRequest({ path: '/caselaw/search', query: { mode: 'hybrid' }, timeoutMs: 800 });
    }
    const fts = await nysKnowledgeRequest({ path: '/caselaw/search', query: { mode: 'fts' }, timeoutMs: 800 });
    expect(String((fts as { error: string }).error)).toMatch(/circuit open/i);
  });

  it('aggregate stats report the worst bucket, not a healthy average', async () => {
    for (let i = 0; i < 3; i++) {
      await nysKnowledgeRequest({ path: '/caselaw/search', timeoutMs: 800 });
    }
    expect(getNysKnowledgeClientStats().circuit).toBe('open');
  });

  it('restores the real base URL for other suites', () => {
    if (REAL_BASE === undefined) delete process.env.NYS_KNOWLEDGE_BASE_URL;
    else process.env.NYS_KNOWLEDGE_BASE_URL = REAL_BASE;
    delete process.env.NYS_KNOWLEDGE_CB_FAILURES;
    delete process.env.NYS_KNOWLEDGE_CB_COOLDOWN_MS;
    delete process.env.NYS_KNOWLEDGE_RETRIES;
    __resetNysBreakersForTest();
    expect(getNysKnowledgeClientStats().openCircuits).toEqual([]);
  });
});
