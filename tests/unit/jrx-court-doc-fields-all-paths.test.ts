/**
 * NV-COURT-DOC-FIELDS-004 — the field block must be identical on EVERY path.
 *
 * Why this file exists: the 17-field block was implemented on three REST handlers and
 * reported to NSP as shipped — twice — while the path NSP actually calls (document
 * analysis via `POST /api/jrx/orchestrate`) had no field block at all. They kept
 * reporting `entities: []` and no `fieldSource`, and they were right both times.
 *
 * These tests assert the *shape contract* of the shared builder and the gate that
 * decides when it runs, so "fixed on one path only" fails CI rather than reaching a
 * partner.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildCourtDocFieldBlock,
  looksLikeCourtDocumentInput,
  extractCourtDocumentFields,
} from '../../src/services/jrx-court-document-fields.js';

const PETITION = `IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
Criminal Petition No. 4471 of 2025
Between: Sri Ramesh Kumar Reddy, S/o Late Venkat Reddy, aged 42 years, R/o Jubilee Hills, Hyderabad ... Petitioner
AND
The State of Telangana, rep. by its Public Prosecutor ... Respondent
Crime No. 221 of 2025 of Banjara Hills Police Station, registered under Sections 420 and 406 of the Bharatiya Nyaya Sanhita, 2023.
Cheque bearing No. 445512 dated 14 January 2025 for Rs. 12,50,000/- was dishonoured on 22 January 2025.
Statutory notice under Section 138 of the Negotiable Instruments Act, 1881 was issued on 5 February 2025.
Posted before the Honourable Justice A. Rajashekar Reddy for hearing on 28 March 2025.
PRAYER: The petitioner prays that this Honourable Court may grant anticipatory bail.`;

/** Every key a partner may map. Adding a path must not drop any of these. */
const CONTRACT_KEYS = [
  'fields',
  'fieldCount',
  'fieldSource',
  'detectedDocumentType',
  'isIndianCourtDocument',
  'statutes',
  'entitiesFlat',
  'deadlinesFlat',
  'obligationsFlat',
  'risksFlat',
] as const;

describe('buildCourtDocFieldBlock — one shape for every path', () => {
  it('emits the full key set even when extraction is null (no undefined holes)', () => {
    const block = buildCourtDocFieldBlock(null, null);
    for (const k of CONTRACT_KEYS) {
      expect(block, `missing key ${k}`).toHaveProperty(k);
    }
    // A null extraction must never claim NYV provenance.
    expect(block.fieldSource).toBe('none');
    expect(block.fieldCount).toBe(0);
  });

  it('every array-typed alias is an ARRAY, never undefined — this is what broke NSP', () => {
    const block = buildCourtDocFieldBlock(null, null);
    for (const k of ['fields', 'statutes', 'entitiesFlat', 'deadlinesFlat', 'obligationsFlat', 'risksFlat']) {
      expect(Array.isArray(block[k]), `${k} must be an array`).toBe(true);
    }
  });

  it('reports fieldSource=nyv only when fields were actually extracted', async () => {
    const extraction = await extractCourtDocumentFields(PETITION, 'IN');
    expect(extraction.fieldCount).toBeGreaterThan(0);
    const block = buildCourtDocFieldBlock(extraction, null);
    expect(block.fieldSource).toBe('nyv');
    expect(block.fieldCount).toBe(extraction.fieldCount);
    // statutes must be a real citation list, not a stub.
    expect((block.statutes as string[]).length).toBeGreaterThan(0);
    expect((block.statutes as string[]).join(' ')).toMatch(/Negotiable Instruments|Bharatiya Nyaya/i);
  });

  it('never labels a zero-field extraction as nyv', () => {
    const empty = { fields: [], fieldCount: 0, isIndianCourtDocument: false };
    expect(buildCourtDocFieldBlock(empty, null).fieldSource).toBe('none');
  });

  it('flattens the nested entities container into entitiesFlat', () => {
    const nested = {
      entities: [{ name: 'High Court at Hyderabad', role: 'organization' }],
      deadlines: [{ date: '28 March 2025' }],
      obligations: [],
      risks: [],
    };
    const block = buildCourtDocFieldBlock(null, nested);
    // `data.entities.length` is undefined because entities is a CONTAINER — this
    // alias is the fix for that, so it must mirror the nested array exactly.
    expect(block.entitiesFlat).toHaveLength(1);
    expect(block.deadlinesFlat).toHaveLength(1);
  });

  it('carries analysisStatus on EVERY path — including the null-extraction path', () => {
    /* NV-ANALYZE-STATUS-005. The previous fix shipped the field block to three of four
     * paths and was reported done twice; the status field must not repeat that, so it is
     * asserted on the same builder every path funnels through. */
    for (const block of [
      buildCourtDocFieldBlock(null, null),
      buildCourtDocFieldBlock(null, null, null),
      buildCourtDocFieldBlock({ fields: [], fieldCount: 0, isIndianCourtDocument: false }, null),
    ]) {
      expect(block).toHaveProperty('analysisStatus');
      expect(block).toHaveProperty('analysisStatusReason');
    }
  });
});

describe('NV-ANALYZE-STATUS-005 — all four analyze paths pass an outcome', () => {
  /* The regression this guards is precise: the field block was added to three of four
   * handlers and reported shipped twice while the path NSP calls had nothing. Asserting
   * the call SHAPE at each site is what makes a fourth omission fail CI. */
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('gateway analyze passes an outcome argument', () => {
    expect(read('src/routes/jrx-sdk-gateway-routes.ts'))
      .toContain('buildCourtDocFieldBlock(extraction, null, extractionOutcome)');
  });

  it('docs-pipeline analyze passes an outcome argument', () => {
    expect(read('src/routes/jrx-sdk-doc-pipeline-routes.ts'))
      .toContain('buildCourtDocFieldBlock(courtFields, nested, courtOutcome)');
  });

  it('orchestrate — the path NSP actually calls — emits a block unconditionally', () => {
    const ORCH = read('src/routes/jrx-orchestration-routes.ts');
    /* It used to attach the block only when `fieldCount > 0`, so a filing that yielded
     * no metadata looked exactly like a chat turn. That gate must be gone. */
    expect(ORCH).not.toContain('if (extraction && extraction.fieldCount > 0) {');
    expect(ORCH).toContain('buildCourtDocFieldBlock(extraction, null, null)');
    expect(ORCH).toContain('failed: true');
  });

  it('the EDJ worker path reports which extractors rejected', () => {
    /* Promise.allSettled + `? value : []` is the deepest form of the defect: a rejected
     * extractor becomes an empty array with nothing recorded. */
    const SVC = read('src/services/legal-doc-analyze-service.ts');
    expect(SVC).toContain('failedExtractors');
    expect(SVC).toContain('analysisStatus');
    // And the webhook payload NSP receives must carry it through.
    expect(read('src/services/jrx-ecosystem-document-job-service.ts'))
      .toContain('analysisStatus');
  });

  it('analyzeDocument returns the DERIVED status, not a hardcoded one', () => {
    /* Source-level by necessity: `analyzeDocument` needs Postgres and six LLM calls, so
     * the derivation was extracted into the pure `deriveAnalysisStatus` (tested
     * behaviourally in nv-nsp-analyze-status-and-breaker.test.ts) and this asserts only
     * the wiring between them. A mutation replacing the spread with literal values is
     * invisible to the behavioural tests, so this is the instrument that catches it. */
    const SVC = read('src/services/legal-doc-analyze-service.ts');
    expect(SVC).toContain('...statusBlock,');
    expect(SVC).toContain('const statusBlock = deriveAnalysisStatus(');
    /* Scoped to analyzeDocument's own return: `deriveAnalysisStatus` legitimately
     * contains literal status values, so an unscoped negative match flags the helper. */
    const returnBlock = SVC.slice(SVC.indexOf('const statusBlock = deriveAnalysisStatus('));
    expect(returnBlock).not.toMatch(/analysisStatus:\s*'(structured|unstructured|failed)'/);
  });
});

describe('looksLikeCourtDocumentInput — gate for the orchestrate path', () => {
  it('accepts a real court filing', () => {
    expect(looksLikeCourtDocumentInput(PETITION)).toBe(true);
  });

  it('rejects ordinary chat turns so normal traffic pays nothing', () => {
    for (const q of [
      'What is anticipatory bail?',
      'Draft a legal notice for cheque bounce.',
      'Explain Section 138 of the NI Act in simple terms.',
      '',
      'petitioner',
    ]) {
      expect(looksLikeCourtDocumentInput(q), `should reject: ${q}`).toBe(false);
    }
  });

  it('rejects a long prompt that has no court-document structure', () => {
    // Length alone must not be sufficient, or every research prompt would trip it.
    const longNonDoc = 'Please analyse the commercial implications of arbitration clauses. '.repeat(12);
    expect(longNonDoc.length).toBeGreaterThan(220);
    expect(looksLikeCourtDocumentInput(longNonDoc)).toBe(false);
  });

  it('is cheap: no async work, returns a boolean synchronously', () => {
    const out = looksLikeCourtDocumentInput(PETITION);
    expect(typeof out).toBe('boolean');
  });
});

describe('orchestrate document-text resolution — longest candidate wins', () => {
  /* Live verification caught this: a request sending an instruction in `prompt` AND the
   * document in `content` returned NO field block, because `applyPartnerPromptAlias`
   * only folds `content` into `prompt` when `prompt` is absent — so the fallback chain
   * saw the short instruction. Picking the longest candidate fixes it regardless of
   * which key a caller uses for the document. */
  const pick = (body: Record<string, unknown>, prompt: string): string =>
    [body.documentContent, body.documentText, body.content, body.text, prompt]
      .map((v) => (typeof v === 'string' ? v : ''))
      .reduce((longest, v) => (v.length > longest.length ? v : longest), '');

  it('prefers the document in `content` over a short explicit prompt', () => {
    const prompt = 'Analyse this court document.';
    const chosen = pick({ content: PETITION }, prompt);
    expect(chosen).toBe(PETITION);
    expect(looksLikeCourtDocumentInput(chosen)).toBe(true);
  });

  it('honours documentContent when present', () => {
    expect(pick({ documentContent: PETITION, content: 'short' }, 'p')).toBe(PETITION);
  });

  it('falls back to the prompt when no document key is supplied', () => {
    expect(pick({}, PETITION)).toBe(PETITION);
  });

  it('a chat-only request still resolves to a short string that fails the gate', () => {
    const chosen = pick({}, 'What is anticipatory bail?');
    expect(looksLikeCourtDocumentInput(chosen)).toBe(false);
  });
});
