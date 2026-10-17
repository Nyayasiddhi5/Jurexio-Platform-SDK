/**
 * NV-NYS-FULLTEXT-001 — on-demand full judgment text via the NYS Athena path.
 *
 * The shapes asserted here are the shapes actually observed against the live
 * NYS host on 2026-08-19 (instance i-000115b19219bb766), so the mock cannot
 * drift into fiction:
 *
 *   POST /athena/search  {"q":"Kesavananda","archive":"sc"}
 *     → {"results":[{"title":"HIS HOLINESS KESAVANANDA BHARATI ...",
 *                    "citation":"[1973] SUPP. 1 S.C.R. 1","year":"1973",
 *                    "s3_path":"s3://your-supreme-court-data-bucket/data/tar/year=1973/english/S_1973_1_1_1002_EN.pdf"}],
 *        "bytesScanned":1663834,"estimatedCostUsd":0.000008}
 *   POST /athena/extract {"s3Path":"...S_1973_1_1_1002_EN.pdf"}
 *     → 413 {"error":"This PDF is 35.8 MB, above the 20 MB extraction limit."}
 *   POST /athena/extract {"s3Path":".../1950_1_806_821_EN.pdf"}
 *     → 200 {"byteSize":538413,"textLength":35536,"ocrUsed":false,"cached":false,"text":"..."}
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const nysKnowledgeRequest = vi.fn();

vi.mock('../../src/services/jrx-nys-knowledge-client.js', () => ({
  nysKnowledgeRequest: (...args: unknown[]) => nysKnowledgeRequest(...args),
}));

const {
  fetchJudgmentFullText,
  isFullJudgmentTextRequest,
  mergeTruncation,
  NYS_EXTRACT_MAX_PDF_BYTES,
} = await import('../../src/services/jrx-nys-judgment-fulltext.js');

const SC_S3 =
  's3://your-supreme-court-data-bucket/data/tar/year=1950/english/1950_1_806_821_EN.pdf';
const KESAVANANDA_S3 =
  's3://your-supreme-court-data-bucket/data/tar/year=1973/english/S_1973_1_1_1002_EN.pdf';

const searchOk = {
  ok: true,
  status: 200,
  data: {
    results: [
      {
        title: 'HIS HOLINESS KESAVANANDA BHARATI SRIPADAGALAVARU versus STATE OF KERALA',
        court: 'Supreme Court of India',
        year: '1973',
        citation: '[1973] SUPP. 1 S.C.R. 1',
        decision_date: '1973-04-24',
        s3_path: KESAVANANDA_S3,
        archive: 'sc',
      },
    ],
    bytesScanned: 1663834,
    estimatedCostUsd: 0.000008,
  },
};

const extractOk = {
  ok: true,
  status: 200,
  data: {
    s3Path: SC_S3,
    requestedPath: SC_S3,
    title: null,
    byteSize: 538413,
    textLength: 35536,
    ocrUsed: false,
    cached: false,
    text: 'SRI RANGA NILAYAM RAMA KRISHNA RAO v. KANDOKOLU CHELLA Y AMMA — judgment body',
  },
};

beforeEach(() => {
  nysKnowledgeRequest.mockReset();
});

describe('fetchJudgmentFullText — instrument control', () => {
  it('POSITIVE CONTROL: a direct s3Path performs exactly one call, to /athena/extract', async () => {
    nysKnowledgeRequest.mockResolvedValueOnce(extractOk);
    const r = await fetchJudgmentFullText({ s3Path: SC_S3 });

    expect(nysKnowledgeRequest).toHaveBeenCalledTimes(1);
    const call = nysKnowledgeRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(call.path).toBe('/athena/extract');
    expect(call.body).toEqual({ s3Path: SC_S3 });
    // A direct path must not incur any Athena scan cost.
    expect(r.ok && r.bytesScanned).toBe(0);
    expect(r.ok && r.resolvedVia).toBe('direct');
    expect(r.ok && r.text.length).toBeGreaterThan(10);
  });
});

describe('fetchJudgmentFullText — resolve then extract', () => {
  it('resolves a case NAME through Athena and then extracts that row s3_path', async () => {
    nysKnowledgeRequest.mockResolvedValueOnce(searchOk).mockResolvedValueOnce(extractOk);
    const r = await fetchJudgmentFullText({ query: 'Kesavananda' });

    expect(nysKnowledgeRequest).toHaveBeenCalledTimes(2);
    const [search, extract] = nysKnowledgeRequest.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(search.path).toBe('/athena/search');
    expect(extract.path).toBe('/athena/extract');
    // The extract hop must use the path Athena returned, not the raw query.
    expect((extract.body as Record<string, unknown>).s3Path).toBe(KESAVANANDA_S3);
    expect(r.ok && r.resolvedVia).toBe('athena-search');
    expect(r.ok && r.citation).toBe('[1973] SUPP. 1 S.C.R. 1');
    expect(r.ok && r.bytesScanned).toBe(1663834);
  });

  it('defaults the archive scope to the cheap SC table, never SC ∪ HC', async () => {
    nysKnowledgeRequest.mockResolvedValueOnce(searchOk).mockResolvedValueOnce(extractOk);
    await fetchJudgmentFullText({ query: 'Kesavananda' });
    const body = nysKnowledgeRequest.mock.calls[0][0].body as Record<string, unknown>;
    expect(body.archive).toBe('sc');
  });

  it('honours an explicit hc scope (the ~1.3GB scan) when asked for', async () => {
    nysKnowledgeRequest.mockResolvedValueOnce(searchOk).mockResolvedValueOnce(extractOk);
    await fetchJudgmentFullText({ query: 'bail', archive: 'hc', year: 2020 });
    const body = nysKnowledgeRequest.mock.calls[0][0].body as Record<string, unknown>;
    expect(body.archive).toBe('hc');
    expect(body.year).toBe(2020);
  });
});

describe('fetchJudgmentFullText — real failure modes', () => {
  it('maps the observed 413 size cap to TOO_LARGE (Kesavananda is 35.8 MB)', async () => {
    nysKnowledgeRequest.mockResolvedValueOnce({
      ok: false,
      status: 413,
      error: 'This PDF is 35.8 MB, above the 20 MB extraction limit.',
    });
    const r = await fetchJudgmentFullText({ s3Path: KESAVANANDA_S3 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('TOO_LARGE');
    expect(!r.ok && r.status).toBe(413);
  });

  it('rejects a District Court directory prefix before spending an upstream call', async () => {
    const r = await fetchJudgmentFullText({
      s3Path: 's3://indian-district-court-judgments/data/tar/year=2020/state=1/district=1/complex=1/',
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('BAD_REQUEST');
    expect(nysKnowledgeRequest).not.toHaveBeenCalled();
  });

  it('requires one of s3Path | query', async () => {
    const r = await fetchJudgmentFullText({});
    expect(!r.ok && r.code).toBe('BAD_REQUEST');
    expect(nysKnowledgeRequest).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND with candidates when Athena matches nothing extractable', async () => {
    nysKnowledgeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { results: [], bytesScanned: 1663834, estimatedCostUsd: 0.000008 },
    });
    const r = await fetchJudgmentFullText({ query: 'no such case' });
    expect(!r.ok && r.code).toBe('NOT_FOUND');
    expect(!r.ok && r.bytesScanned).toBe(1663834);
    // Must not attempt an extract with no resolved path.
    expect(nysKnowledgeRequest).toHaveBeenCalledTimes(1);
  });
});

describe('fetchJudgmentFullText — truncation is never silent (NYS-ARCHIVE-LARGE-PDF-001)', () => {
  it('surfaces upstream truncated:true so a partial judgment is distinguishable', async () => {
    /* Kesavananda: 1,006 pages, 2,878,447 chars. NYS stops at its page/time
     * budget and stamps `truncated`. A caller that cannot see this flag would
     * quote a judgment it only partly read. */
    nysKnowledgeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        s3Path: KESAVANANDA_S3,
        byteSize: 37_514_544,
        textLength: 71_500,
        ocrUsed: false,
        cached: false,
        truncated: true,
        text:
          'HIS HOLINESS KESAVANANDA BHARATI ... [Note: text extracted from the first 25 of 1006 pages]',
      },
    });
    const r = await fetchJudgmentFullText({ s3Path: KESAVANANDA_S3 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.truncated).toBe(true);
  });

  it('reports a complete extraction as truncated:false, not as null', async () => {
    nysKnowledgeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...extractOk.data, truncated: false },
    });
    const r = await fetchJudgmentFullText({ s3Path: SC_S3 });
    expect(r.ok && r.truncated).toBe(false);
  });

  it('reports an absent upstream flag as null — absence is not evidence of completeness', async () => {
    // Pre-NYS-ARCHIVE-LARGE-PDF-001 hosts omit the field entirely. Coercing
    // that to `false` would assert a complete body we cannot vouch for.
    nysKnowledgeRequest.mockResolvedValueOnce(extractOk);
    const r = await fetchJudgmentFullText({ s3Path: SC_S3 });
    expect(r.ok && r.truncated).toBeNull();
    expect(r.ok && r.truncated).not.toBe(false);
  });

  it('EXECUTED PROOF that NYS_EXTRACT_MAX_PDF_BYTES is inert: a 63.9 MB body still returns ok', async () => {
    /*
     * The constant is documentation-only. Rather than trust a grep, this drives
     * the whole function with Maneka Gandhi's real byte size (63,851,267 —
     * 3.2x the OLD 20 MB cap) and asserts the body comes back. If any branch
     * ever starts enforcing the constant locally, this test goes red, and the
     * "documentation only" comment on it stops being true silently.
     */
    nysKnowledgeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...extractOk.data, byteSize: 63_851_267, textLength: 529_765 },
    });
    const r = await fetchJudgmentFullText({ s3Path: SC_S3 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.byteSize).toBe(63_851_267);
    expect(NYS_EXTRACT_MAX_PDF_BYTES).toBe(96 * 1024 * 1024);
  });
});

describe('mergeTruncation — the route flag POST /judgments/full-text returns', () => {
  it('reports upstream page-budget truncation even when the caller passed no maxChars', () => {
    /* The bug this guards: computing `truncated` only from `maxChars` and
     * spreading `result` would report `false` about a body NYS had already cut
     * short at 1,006 pages. The caller would quote a partial Kesavananda with no
     * signal to come back for the rest. */
    expect(mergeTruncation({ upstreamTruncated: true, clippedHere: false })).toEqual({
      truncated: true,
      truncationReason: 'upstream-extraction-budget',
      upstreamTruncated: true,
    });
  });

  it('reports the caller cap on its own', () => {
    expect(mergeTruncation({ upstreamTruncated: false, clippedHere: true })).toEqual({
      truncated: true,
      truncationReason: 'maxChars',
      upstreamTruncated: false,
    });
  });

  it('names BOTH causes rather than letting one mask the other', () => {
    expect(mergeTruncation({ upstreamTruncated: true, clippedHere: true }).truncationReason)
      .toBe('upstream-extraction-budget+maxChars');
  });

  it('reports a complete body as not truncated with no reason', () => {
    expect(mergeTruncation({ upstreamTruncated: false, clippedHere: false })).toEqual({
      truncated: false,
      truncationReason: null,
      upstreamTruncated: false,
    });
  });

  it('preserves an unreported upstream flag as null while still answering truncated', () => {
    // `truncated: false` is the honest answer for the FLAG the route computes,
    // but `upstreamTruncated: null` must survive so a caller can see we do not
    // actually know whether the extractor ran to the end.
    const merged = mergeTruncation({ upstreamTruncated: null, clippedHere: false });
    expect(merged.upstreamTruncated).toBeNull();
    expect(merged.truncated).toBe(false);
    const clipped = mergeTruncation({ upstreamTruncated: null, clippedHere: true });
    expect(clipped.truncated).toBe(true);
    expect(clipped.upstreamTruncated).toBeNull();
  });
});

describe('isFullJudgmentTextRequest', () => {
  it('fires on genuine full-text asks', () => {
    for (const q of [
      'give me the full text of the judgment in Kesavananda Bharati',
      'I need the complete judgment in Maneka Gandhi',
      'show me the entire order',
      'fetch the verbatim judgment',
      'judgment full text please',
      'read me the full ruling',
    ]) {
      expect(isFullJudgmentTextRequest(q), q).toBe(true);
    }
  });

  it('NEGATIVE CONTROL: does not fire on ordinary legal prompts that merely say judgment/order', () => {
    for (const q of [
      'summarise the judgment in Kesavananda Bharati',
      'what did the court hold in Maneka Gandhi?',
      'draft a bail application',
      'is this order appealable?',
      'find precedents on anticipatory bail',
      'what is the ratio of this judgment',
    ]) {
      expect(isFullJudgmentTextRequest(q), q).toBe(false);
    }
  });

  it('ignores empty / junk input', () => {
    expect(isFullJudgmentTextRequest('')).toBe(false);
    expect(isFullJudgmentTextRequest('ab')).toBe(false);
    expect(isFullJudgmentTextRequest(undefined as unknown as string)).toBe(false);
  });
});
