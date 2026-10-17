/**
 * NV-CITE-GROUND-001 — retrieved authorities must reach the model, and
 * `trust.citationsPresent` must mean what it says.
 *
 * The shipped defect, measured live on jrx-prod: asked for "leading Supreme Court
 * authorities on anticipatory bail for economic offences", `/api/jrx/orchestrate`
 * returned 6,925 chars of well-structured prose containing ZERO case citations,
 * while reporting `trust: { grounded: true, citationsPresent: true }` and
 * `citations: { verified: 0, unverified: 1 }`. The corpus was not at fault —
 * Sushila Aggarwal (2018) and Gurbaksh Singh Sibbia (1980) are both present and
 * retrievable.
 *
 * Two independent faults, both covered here:
 *
 *  (a) `caseToChunk()` populated `citationRef`, but the only place it was ever
 *      RENDERED into an LLM-visible block was the SDK research route
 *      (`jrx-sdk-gateway-routes.ts:1147`) — not `formatAutoRagContext`, which is
 *      what the Queen/orchestrate path (NSP + console) actually uses. The model
 *      received snippet prose with nothing quotable, and our own
 *      anti-fabrication rule then guaranteed a citation-free answer.
 *
 *  (b) `citationsPresent` was
 *      `Array.isArray(c) ? c.length > 0 : !!(c && typeof c === 'object')`. The
 *      verifier returns an OBJECT (`{ verified, unverified, details }`), so the
 *      second branch always won and any envelope — including
 *      `{ verified: 0, unverified: 0, details: [] }` — reported `true`.
 *
 * The corpus constraint that shapes the renderer: `citation` is populated only
 * for `court_type='sc'` rows (43,505 of 26,259,225 ≈ 0.17%) because
 * `ingest-rds.ts` `mapHcRow` and `mapDcRow` hardcode `citation: null`. Rendering
 * only `citation` would leave ~99.8% of retrieved authorities blank, so the
 * reference is synthesised from court/year/CNR/case-number when there is no
 * reporter citation. Each of those three row shapes is asserted separately
 * below — a single "renders something" assertion could not fail.
 */
import { describe, it, expect } from 'vitest';
import {
  formatAutoRagContext,
  type AutoRagChunk,
  type AutoRagResult,
} from '../../src/services/jrx-auto-rag-router.js';
import {
  buildCaseAuthorityRef,
  flattenRetrievalPlanToChunks,
} from '../../src/services/jrx-nys-knowledge-retriever.js';
import { countDeliveredAuthorities } from '../../src/orchestration/jrx-orchestration-response-contract.js';
import { buildUniversalLegalIntelligenceOverlay } from '../../src/services/jrx-legal-intelligence-overlay.js';

const BUDGET = { ragChunkCharCap: 1_200, ragTotalCharCap: 20_000 };

const mkResult = (chunks: AutoRagChunk[]): AutoRagResult =>
  ({
    chunks,
    contextBlock: '',
    intent: 'precedent_research',
    capabilityTier: 'enterprise',
    layersUsed: ['unified-base', 'nys_global'],
    retrievalMethods: ['nys:retrieve:case-search'],
    totalFound: chunks.length,
    confidence: 0.72,
    latencyMs: 400,
  }) as AutoRagResult;

/** The two authorities the live probe proved are in the corpus, plus HC/DC shapes. */
const SC_WITH_CITATION = {
  id: 101,
  title: 'SUSHILA AGGARWAL & ORS. versus STATE (NCT OF DELHI)',
  citation: '(2020) 5 SCC 1',
  court: 'Supreme Court of India',
  courtType: 'sc',
  year: 2018,
  cnr: 'SCIN010012342018000001',
  description: 'Anticipatory bail under Section 438 CrPC need not invariably be limited in time.',
  disposalNature: 'Allowed',
  score: 0.91,
};
const SC_NULL_CITATION = {
  id: 102,
  title: 'GURBAKSH SINGH SIBBIA ETC. versus STATE OF PUNJAB',
  citation: null,
  court: 'Supreme Court of India',
  courtType: 'sc',
  year: 1980,
  cnr: 'SCIN010098762980000001',
  description: 'The High Court and the Court of Session must apply their own mind.',
  score: 0.88,
};
const HC_NULL_CITATION = {
  id: 103,
  title: 'XYZ versus STATE OF TELANGANA',
  citation: null,
  court: 'High Court for the State of Telangana',
  courtType: 'hc',
  year: 2023,
  cnr: 'HCTS010044442023000123',
  decisionDate: '2023-07-14',
  description: 'Economic offences constitute a class apart.',
  score: 0.71,
};
const DC_SYNTHESISED_TITLE = {
  id: 104,
  title: 'CRL.MP No. 4412/2024 · Rangareddy District Court',
  citation: null,
  court: 'Rangareddy District Court',
  courtType: 'dc',
  year: 2024,
  cnr: null,
  caseType: 'CRL.MP',
  caseNo: '4412/2024',
  description: 'Petition under Section 482 BNSS.',
  score: 0.55,
};

describe('NV-CITE-GROUND-001: authority reference synthesis across the real corpus shapes', () => {
  it('uses the reporter citation for an SC row that HAS one', () => {
    // Positive control for the 0.17% slice where `citation` is populated.
    expect(buildCaseAuthorityRef(SC_WITH_CITATION)).toBe('(2020) 5 SCC 1');
  });

  it('synthesises court + year + CNR for an SC row with citation: null', () => {
    const ref = buildCaseAuthorityRef(SC_NULL_CITATION)!;
    expect(ref).toContain('Supreme Court of India');
    expect(ref).toContain('1980');
    expect(ref).toContain('CNR SCIN010098762980000001');
  });

  it('synthesises a usable reference for an HC row (mapHcRow hardcodes citation: null)', () => {
    const ref = buildCaseAuthorityRef(HC_NULL_CITATION)!;
    expect(ref).toContain('High Court for the State of Telangana');
    expect(ref).toContain('2023');
    expect(ref).toContain('CNR HCTS010044442023000123');
    // It must NOT invent a reporter citation to fill the gap.
    expect(ref).not.toMatch(/\(\d{4}\)\s+\d+\s+(SCC|AIR)/);
  });

  it('falls back to case type + number for a DC row with no CNR', () => {
    const ref = buildCaseAuthorityRef(DC_SYNTHESISED_TITLE)!;
    expect(ref).toContain('Case No CRL.MP 4412/2024');
    expect(ref).toContain('2024');
  });

  it('returns undefined rather than an empty reference when there is no metadata at all', () => {
    // Must be `undefined` so the renderer can suppress the " — " separator
    // instead of emitting a dangling one.
    expect(buildCaseAuthorityRef({ title: 'Some Judgment' })).toBeUndefined();
    expect(buildCaseAuthorityRef({})).toBeUndefined();
  });

  it('never echoes the title back as the reference', () => {
    // The corpus habit that made the naive fix a no-op: `citationRef` is
    // `citation || title`, so on 99.8% of rows it IS the title.
    expect(buildCaseAuthorityRef({ title: 'A versus B', citation: 'A versus B' })).toBeUndefined();
  });

  it('reads the decision-date year when `year` is absent', () => {
    const ref = buildCaseAuthorityRef({
      title: 'P versus Q',
      court: 'Bombay High Court',
      decisionDate: '2019-03-02',
    })!;
    expect(ref).toContain('2019');
  });
});

describe('NV-CITE-GROUND-001: caseToChunk carries the reference AND real content', () => {
  const chunks = flattenRetrievalPlanToChunks(
    {
      steps: [
        {
          tool: 'case-search',
          jurisdiction: 'IN',
          results: [SC_WITH_CITATION, SC_NULL_CITATION, HC_NULL_CITATION, DC_SYNTHESISED_TITLE],
        },
      ],
    } as never,
    'IN',
    8,
  );

  it('populates authorityRef on every retrieved judgment', () => {
    expect(chunks).toHaveLength(4);
    for (const c of chunks) {
      expect(c.authorityRef, c.title).toBeTruthy();
    }
  });

  it('reads `description` as the headnote — NYS never returns snippet/summary', () => {
    // Before this fix `content` fell through to `citation || title`, i.e. the
    // model was handed an authority whose entire content was its own name.
    expect(chunks[0].content).toContain('Anticipatory bail under Section 438');
    expect(chunks[0].content).not.toBe(chunks[0].title);
  });

  it('leaves citationRef untouched so RRF dedup identity does not change', () => {
    // `chunkKey()` uses `citationRef`. Two 1980 SC judgments with no reporter
    // citation would collide on a synthesised "Supreme Court, 1980" key and one
    // would be silently fused away.
    expect(chunks[1].citationRef).toBe(SC_NULL_CITATION.title);
    expect(chunks[1].authorityRef).not.toBe(chunks[1].citationRef);
  });

  it('says so explicitly when a row is metadata-only, instead of inviting invention', () => {
    const [meta] = flattenRetrievalPlanToChunks(
      { steps: [{ tool: 'case-search', results: [{ id: 9, title: 'R versus S', court: 'Delhi High Court', year: 2020 }] }] } as never,
      'IN',
      4,
    );
    expect(meta.content).toContain('Do not invent passages');
  });
});

describe('NV-CITE-GROUND-001: the orchestrate context block renders the authorities', () => {
  const chunks = flattenRetrievalPlanToChunks(
    {
      steps: [
        {
          tool: 'case-search',
          jurisdiction: 'IN',
          results: [SC_WITH_CITATION, SC_NULL_CITATION, HC_NULL_CITATION, DC_SYNTHESISED_TITLE],
        },
      ],
    } as never,
    'IN',
    8,
  );
  const block = formatAutoRagContext(mkResult(chunks), BUDGET);

  it('emits a numbered AUTHORITIES SUPPLIED roll-up', () => {
    expect(block).toContain('AUTHORITIES SUPPLIED (4)');
    expect(block).toContain('1. SUSHILA AGGARWAL & ORS. versus STATE (NCT OF DELHI) — (2020) 5 SCC 1');
  });

  it('renders a reference for every one of the four row shapes', () => {
    // The whole point of the corpus constraint: no row may render blank.
    expect(block).toContain('(2020) 5 SCC 1');
    expect(block).toContain('Supreme Court of India, 1980');
    expect(block).toContain('High Court for the State of Telangana, 2023');
    expect(block).toContain('Case No CRL.MP 4412/2024');
  });

  it('instructs the model to cite only what was supplied', () => {
    expect(block).toMatch(/cite nothing that is not here/i);
  });

  it('keeps the excerpt tags numbered consistently with the roll-up', () => {
    // "authority 2" must be unambiguous in both directions.
    expect(block).toContain('[2|nys_global|global:caselaw:IN] GURBAKSH SINGH SIBBIA');
    expect(block).toMatch(/^2\. GURBAKSH SINGH SIBBIA/m);
  });

  it('does not attach a reference to a chunk that has no authority metadata', () => {
    // NEGATIVE CONTROL. Without this the suite could pass by unconditionally
    // appending " — <title>" to every chunk, which is the no-op fix.
    const withGraph = formatAutoRagContext(
      mkResult([
        ...chunks,
        {
          id: 'graphrag:0',
          source: 'graphrag',
          title: 'Anticipatory bail',
          content: 'Entity: Anticipatory bail',
          jurisdiction: 'IN',
          score: 0.5,
          layer: 'graphrag',
        },
      ]),
      BUDGET,
    );
    expect(withGraph).toContain('[5|graphrag|graphrag] Anticipatory bail\n');
    expect(withGraph).toContain('AUTHORITIES SUPPLIED (4)');
    expect(withGraph).not.toMatch(/^5\. Anticipatory bail —/m);
  });

  it('emits no roll-up at all when nothing retrieved carries a reference', () => {
    const out = formatAutoRagContext(
      mkResult([
        {
          id: 'rd:1',
          source: 'tenant',
          title: 'Internal memo',
          content: 'Some tenant document text.',
          jurisdiction: 'IN',
          score: 0.6,
          layer: 'rag_documents',
        },
      ]),
      BUDGET,
    );
    expect(out).not.toContain('AUTHORITIES SUPPLIED');
    expect(out).toContain('Internal memo');
  });

  it('never lists an authority whose excerpt was dropped for budget', () => {
    // Inviting the model to cite a judgment it cannot see is how a grounding fix
    // becomes a fabrication vector.
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...SC_WITH_CITATION,
      id: 200 + i,
      title: `AUTHORITY ${i + 1} versus STATE`,
      citation: `(20${10 + i}) ${i + 1} SCC 1`,
      description: 'x'.repeat(1_000),
    }));
    const out = formatAutoRagContext(
      mkResult(
        flattenRetrievalPlanToChunks(
          { steps: [{ tool: 'case-search', results: many }] } as never,
          'IN',
          12,
        ),
      ),
      { ragChunkCharCap: 900, ragTotalCharCap: 4_000 },
    );
    expect(out).toContain('omitted for budget');
    const listed = [...out.matchAll(/^\d+\. (AUTHORITY \d+) versus STATE —/gm)].map((m) => m[1]);
    for (const name of listed) {
      expect(out, `${name} listed but not rendered`).toContain(`] ${name} versus STATE`);
    }
    expect(listed.length).toBeLessThan(12);
  });

  it('keeps the whole block inside the declared total ceiling', () => {
    // NV-RAG-CHAR-BUDGET-001 must not be widened by the new section: the
    // roll-up is reserved OUT of the total, not added on top of it.
    const many = Array.from({ length: 16 }, (_, i) => ({
      ...HC_NULL_CITATION,
      id: 300 + i,
      title: `HC AUTHORITY ${i + 1}`,
      description: 'y'.repeat(4_500),
    }));
    const out = formatAutoRagContext(
      mkResult(
        flattenRetrievalPlanToChunks(
          { steps: [{ tool: 'case-search', results: many }] } as never,
          'IN',
          16,
        ),
      ),
      { ragChunkCharCap: 1_200, ragTotalCharCap: 20_000 },
    );
    // Header + labels are overhead on top of the content budget; allow 25%.
    expect(out.length).toBeLessThan(20_000 * 1.25);
    expect(Math.ceil(out.length / 4)).toBeLessThan(8_000);
  });
});

describe('NV-CITE-GROUND-001: the overlay requires using supplied authorities', () => {
  const full = buildUniversalLegalIntelligenceOverlay({
    prompt: 'leading Supreme Court authorities on anticipatory bail for economic offences',
    jurisdiction: 'IN',
    taskKind: 'research',
  });
  const compact = buildUniversalLegalIntelligenceOverlay({
    prompt: 'What is BNS 318?',
    jurisdiction: 'IN',
    depth: 'compact',
  });

  it('names the AUTHORITIES SUPPLIED contract in the full tier', () => {
    expect(full).toContain('AUTHORITIES SUPPLIED');
    expect(full).toMatch(/carry its reference inline/i);
  });

  it('requires an explicit statement when no authority was supplied', () => {
    expect(full).toMatch(/No corpus authority was retrieved/i);
  });

  it('carries the obligation into the compact tier too', () => {
    expect(compact).toMatch(/AUTHORITIES SUPPLIED/);
  });

  it('does not contradict the anti-fabrication rule', () => {
    // The two rules must coexist: "cite what you were given" must never read as
    // "produce a citation".
    expect(full).toMatch(/Never invent a case name, citation, section number/i);
    expect(full).toMatch(/never manufacture a citation/i);
    expect(compact).toMatch(/Never invent a case name, citation, section number or URL/i);
  });
});

describe('NV-CITE-GROUND-001: trust.citationsPresent is honest', () => {
  it('is FALSE for the exact live zero-authority envelope', () => {
    // `{ verified: 0, unverified: 0, details: [] }` reported `true` before.
    expect(countDeliveredAuthorities({ verified: 0, unverified: 0, details: [] })).toBe(0);
  });

  it('is FALSE for a bare object — the shape that always passed', () => {
    expect(countDeliveredAuthorities({})).toBe(0);
  });

  it('is FALSE for null / undefined / a non-object', () => {
    expect(countDeliveredAuthorities(null)).toBe(0);
    expect(countDeliveredAuthorities(undefined)).toBe(0);
    expect(countDeliveredAuthorities('(2020) 5 SCC 1')).toBe(0);
  });

  it('is TRUE and counts correctly when an authority WAS delivered', () => {
    // POSITIVE CONTROL — a test that can only report false is not a test.
    expect(
      countDeliveredAuthorities({
        verified: 0,
        unverified: 1,
        details: [{ text: 'Article 21 of the Constitution' }],
      }),
    ).toBe(1);
    expect(
      countDeliveredAuthorities({
        verified: 2,
        unverified: 1,
        details: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      }),
    ).toBe(3);
  });

  it('counts a DeterministicCitation[] from the zero-LLM path', () => {
    expect(
      countDeliveredAuthorities([
        { kind: 'case', ref: '(2020) 5 SCC 1', title: 'Sushila Aggarwal' },
        { kind: 'statute', ref: 'BNSS §482' },
      ]),
    ).toBe(2);
  });

  it('does not count empty or blank array entries', () => {
    expect(countDeliveredAuthorities([])).toBe(0);
    expect(countDeliveredAuthorities([{ ref: '   ' }, null, {}, 'x'])).toBe(1);
  });

  it('prefers details[] over the verified/unverified counters when both exist', () => {
    // The counters can disagree with the list; the list is what was delivered.
    expect(countDeliveredAuthorities({ verified: 9, unverified: 9, details: [] })).toBe(0);
  });
});
