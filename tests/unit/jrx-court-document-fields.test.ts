/**
 * NV-COURT-DOC-FIELDS-001 — structured extraction for Indian court documents.
 *
 * NSP's ask: "make analyzeDocument return real fields for Indian court documents so
 * extraction can badge NYV instead of Heuristic". Baseline probed live before the
 * fix: `documents/analyze` returned only `analysis` prose (1,462 chars) with no
 * `fields`, `entities`, `caseNumber`, `court` or `parties` keys.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractCourtDocumentFields } from '../../src/services/jrx-court-document-fields.js';

/** The exact document used in the live baseline probe. */
const PETITION = `IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
FOR THE STATE OF TELANGANA

Criminal Petition No. 4471 of 2025

BETWEEN:
Ram Kumar S/o Late Shri Mohan Lal, aged 42 years, R/o 12-3-45 Banjara Hills, Hyderabad
... PETITIONER

AND

The State of Telangana, rep. by its Public Prosecutor, High Court of Telangana
... RESPONDENT No. 1
Meridian Textiles Pvt Ltd, rep. by its Managing Director
... RESPONDENT No. 2

PETITION UNDER SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023 FOR GRANT OF ANTICIPATORY BAIL

The Petitioner respectfully submits:
1. That FIR No. 221 of 2025 was registered at Banjara Hills Police Station on 12 March 2025 under Sections 318 and 316(2) of the Bharatiya Nyaya Sanhita, 2023.
2. That the alleged amount involved is Rs 47,00,000 (Rupees Forty Seven Lakhs only).
3. That the matter is listed before the Hon'ble Justice A. Rajashekar Reddy on 28 March 2025.

PRAYER:
It is therefore prayed that this Hon'ble Court may be pleased to grant anticipatory bail to the Petitioner.

Hyderabad
Date: 20 March 2025
Counsel for the Petitioner`;

const keys = (r: { fields: Array<{ key: string }> }) => new Set(r.fields.map((f) => f.key));
const val = (r: { fields: Array<{ key: string; value: string }> }, k: string) =>
  r.fields.find((f) => f.key === k)?.value;

describe('NV-COURT-DOC-FIELDS-001 — filing metadata', () => {
  it('extracts the filing number a reported-citation regex could never match', async () => {
    const r = await extractCourtDocumentFields(PETITION);
    expect(val(r, 'filing_number')).toBe('Criminal Petition No. 4471 of 2025');
    expect(val(r, 'case_year')).toBe('2025');
    expect(val(r, 'case_type')).toMatch(/Criminal Petition/i);
  });

  it('extracts court, FIR, police station, judge and prayer', async () => {
    const r = await extractCourtDocumentFields(PETITION);
    expect(val(r, 'court')).toMatch(/HIGH COURT/i);
    expect(val(r, 'fir_number')).toBe('FIR No. 221 of 2025');
    expect(val(r, 'police_station')).toMatch(/Banjara Hills Police Station/);
    expect(val(r, 'judge')).toMatch(/Rajashekar/);
    expect(val(r, 'prayer')).toMatch(/anticipatory bail/i);
  });

  it('extracts the next hearing date, not just any date', async () => {
    expect(val(await extractCourtDocumentFields(PETITION), 'next_hearing_date')).toBe('28 March 2025');
  });

  it('classifies the document from its own text', async () => {
    const r = await extractCourtDocumentFields(PETITION);
    expect(r.detectedDocumentType).toBe('anticipatory_bail_petition');
    expect(r.isIndianCourtDocument).toBe(true);
  });
});

describe('NV-COURT-DOC-FIELDS-001 — cause-title parties', () => {
  it('reads roles positionally and numbers repeated roles', async () => {
    const r = await extractCourtDocumentFields(PETITION);
    expect(val(r, 'petitioner')).toMatch(/^Ram Kumar/);
    expect(val(r, 'respondent')).toMatch(/State of Telangana/);
    expect(val(r, 'respondent_2')).toMatch(/Meridian Textiles/);
  });
});

describe('NV-COURT-DOC-FIELDS-001 — NER enrichment is reused, not duplicated', () => {
  it('carries statutes, amount and dates through from the NER service', async () => {
    const r = await extractCourtDocumentFields(PETITION);
    expect(val(r, 'statutes_invoked')).toMatch(/482|318|316/);
    expect(val(r, 'amount_in_dispute')).toMatch(/47,00,000/);
    expect(val(r, 'dates_mentioned')).toMatch(/March 2025/);
    expect(r.fields.some((f) => f.source === 'legal-ner')).toBe(true);
  });

  it('does not re-implement statute/date/amount patterns locally', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/services/jrx-court-document-fields.ts'),
      'utf8',
    );
    expect(SRC).toContain('nvLegalNerV2Service.extractEntities');
    // NV-NO-DUPLICATE-001: no second copy of the entity patterns.
    expect(SRC).not.toContain('AMOUNT_PATTERN');
    expect(SRC).not.toContain('DATE_PATTERN');
  });
});

describe('NV-COURT-DOC-FIELDS-001 — must not over-claim', () => {
  it('does not treat an invoice number as a filing number', async () => {
    const r = await extractCourtDocumentFields(
      'Invoice No. 4471 of 2025 was raised against the buyer for Rs 5,00,000.',
    );
    expect(keys(r).has('filing_number')).toBe(false);
  });

  it('a commercial contract is not labelled an Indian court filing', async () => {
    const r = await extractCourtDocumentFields(
      'This Agreement is made between A and B for supply of goods. Disputes shall be referred to the courts at Hyderabad.',
    );
    expect(r.isIndianCourtDocument).toBe(false);
    expect(keys(r).has('filing_number')).toBe(false);
  });

  it('omits absent values instead of emitting empty strings', async () => {
    const r = await extractCourtDocumentFields('Short note about a meeting.');
    expect(r.fields.every((f) => f.value.trim().length > 0)).toBe(true);
  });

  it('empty input yields no fields and does not throw', async () => {
    const r = await extractCourtDocumentFields('');
    expect(r.fieldCount).toBe(0);
    expect(r.isIndianCourtDocument).toBe(false);
  });

  it('every field carries a source so partners can badge provenance', async () => {
    const r = await extractCourtDocumentFields(PETITION);
    expect(r.fields.length).toBeGreaterThan(8);
    expect(r.fields.every((f) => ['cause-title', 'regex-rules', 'legal-ner'].includes(f.source))).toBe(true);
    expect(r.fields.every((f) => f.confidence > 0 && f.confidence <= 1)).toBe(true);
  });
});

describe('NV-COURT-DOC-FIELDS-001 — wiring into the analyze route', () => {
  const ROUTES = readFileSync(
    join(process.cwd(), 'src/routes/jrx-sdk-gateway-routes.ts'),
    'utf8',
  );

  it('analyze returns fields + a badge source', () => {
    expect(ROUTES).toContain('extractCourtDocumentFields(content, effectiveJurisdiction, extractOpts)');
    /* NV-COURT-DOC-FIELDS-004: the `fieldSource` ternary moved out of this handler
     * into the shared `buildCourtDocFieldBlock`, because three handlers each built the
     * block by hand while the orchestrate path NSP actually calls had none. Assert the
     * handler DELEGATES; the block's own shape is asserted in
     * nv-court-doc-fields-all-paths.test.ts against the builder's real output. */
    expect(ROUTES).toContain('buildCourtDocFieldBlock(extraction');
  });

  it('extraction failure can never fail the analysis (additive only)', () => {
    const i = ROUTES.indexOf('extractCourtDocumentFields(content, effectiveJurisdiction');
    const slice = ROUTES.slice(i - 400, i + 600);
    expect(slice).toContain('catch');
    expect(slice).toContain('non-fatal');
  });

  it('the prose analysis field is unchanged for existing consumers', () => {
    expect(ROUTES).toContain('analysis: llmResponse.content');
  });

  it('the gateway now enforces India-only scope for NSP/NYM', () => {
    // This router was the last partner surface without it.
    expect(ROUTES).toContain('router.use(partnerIndiaScopeMiddleware)');
    const authIdx = ROUTES.indexOf('router.use(sdkGatewayAuth)');
    const scopeIdx = ROUTES.indexOf('router.use(partnerIndiaScopeMiddleware)');
    // Must run AFTER auth, because it reads req.sdkContext to identify the platform.
    expect(scopeIdx).toBeGreaterThan(authIdx);
  });
});

describe('NV-COURT-DOC-TYPE-ORDER-001 — cause of action outranks a referenced document', () => {
  const CHEQUE = `IN THE COURT OF THE XIV ADDITIONAL CHIEF METROPOLITAN MAGISTRATE, HYDERABAD
Crl.M.P. No. 4471 of 2025
Complaint under Section 138 of the Negotiable Instruments Act, 1881
BETWEEN:
Meridian Textiles Pvt Ltd
... COMPLAINANT
AND
Ram Kumar S/o Late Shri Mohan Lal
... ACCUSED
1. That the accused issued cheque no. 004512 for Rs 8,40,000 which was returned unpaid with the endorsement 'funds insufficient'.
2. That FIR No. 221 of 2025 was registered at Banjara Hills Police Station.
3. That the matter is listed on 20 September 2025.`;

  it('classifies a s.138 NI Act matter as cheque dishonour, NOT as an FIR', async () => {
    // Live defect reported by NSP: an incidental "FIR No. 221 of 2025" reference made
    // the loop (first-match-wins) return `fir` for a cheque-dishonour complaint.
    const r = await extractCourtDocumentFields(CHEQUE);
    expect(r.detectedDocumentType).toBe('cheque_dishonour_complaint');
  });

  it('still extracts the referenced FIR as a FIELD (the reference is real)', async () => {
    const r = await extractCourtDocumentFields(CHEQUE);
    expect(r.fields.find((f) => f.key === 'fir_number')?.value).toBe('FIR No. 221 of 2025');
  });

  it('resolves s.138 to the Negotiable Instruments Act, never a BNS section', async () => {
    const r = await extractCourtDocumentFields(CHEQUE);
    const statutes = r.fields.find((f) => f.key === 'statutes_invoked')?.value || '';
    expect(statutes).toMatch(/Negotiable Instruments/i);
    expect(statutes).not.toMatch(/BNS|Bharatiya Nyaya/i);
  });

  it('a document that IS an FIR is still classified fir', async () => {
    const r = await extractCourtDocumentFields(
      'FIR No. 221 of 2025\nFirst Information Report registered at Banjara Hills Police Station under Sections 318 of the Bharatiya Nyaya Sanhita, 2023.',
    );
    expect(r.detectedDocumentType).toBe('fir');
  });

  it('does not regress the anticipatory-bail classification', async () => {
    const r = await extractCourtDocumentFields(PETITION);
    expect(r.detectedDocumentType).toBe('anticipatory_bail_petition');
  });
});

describe('NV-ANALYZE-FLAT-ALIASES-001 — the arrays partners map are present', () => {
  const PIPE = readFileSync(
    join(process.cwd(), 'src/routes/jrx-sdk-doc-pipeline-routes.ts'),
    'utf8',
  );

  it('adds flat aliases without disturbing the nested entities object', () => {
    // NSP read data.entities as a flat array, but it is a CONTAINER
    // (entities.entities|obligations|risks|deadlines) — and statutes never existed.
    /* The aliases are now emitted by the shared builder (NV-COURT-DOC-FIELDS-004),
     * so assert delegation here and the alias CONTENT in the builder's own test.
     * NV-ANALYZE-STATUS-005 added the outcome argument, which is what reports
     * failed-vs-empty, so the happy path must pass it too. */
    expect(PIPE).toContain('buildCourtDocFieldBlock(courtFields, nested, courtOutcome)');
    // Purely additive: the original result object is still spread in first.
    expect(PIPE).toContain('...(result as Record<string, unknown>)');
  });

  it('the DEGRADED branch uses the same builder, so aliases survive an LLM outage', () => {
    /* This branch previously emitted fields/fieldSource but NOT the flat aliases, so a
     * client mapping them broke exactly when the LLM was already down. */
    expect(PIPE).toContain('buildCourtDocFieldBlock(degradedFields, null, {');
  });

  it('the degraded branch reports failed, not merely empty (NV-ANALYZE-STATUS-005)', () => {
    /* Reaching this branch means the analyzer threw. Emitting empty arrays with no
     * status is the exact ambiguity NSP reported, so the literal `failed: true` must
     * be present on this path. */
    const degraded = PIPE.slice(PIPE.indexOf('intel_degraded_'));
    expect(degraded).toContain('failed: true');
  });
});
