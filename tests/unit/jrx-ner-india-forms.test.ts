/**
 * NV-NER-INDIA-FORMS-001 — legal NER must recognise the citation and date forms
 * Indian practitioners actually write.
 *
 * Live defect this locks (`POST /api/jrx/intelligence/legal-ner`, 2026-08-17):
 * "Ram Kumar filed a petition under BNSS 482 before the Telangana High Court on
 *  12 March 2025 against Meridian Textiles Pvt Ltd for Rs 47,00,000."
 * returned only AMOUNT and COURT — the statute reference, the date and the company
 * were all missed on an India-only product.
 *
 * NV-DOC-SUMMARY-ENVELOPE-001 — a partner-facing summary must never be a raw
 * orchestration envelope. Live, `summarize` returned a summary beginning
 * "```json {\"agentId\": \"A-129\", \"agentName\": \"Document Assembly Agent\"…"
 * because `parsed.summary || llmResponse.content` fell back to the whole envelope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { nvLegalNerV2Service } from '../../src/services/jrx-legal-ner-v2-service.js';

const LIVE_SENTENCE =
  'Ram Kumar filed a petition under BNSS 482 before the Telangana High Court on ' +
  '12 March 2025 against Meridian Textiles Pvt Ltd for Rs 47,00,000.';

async function typesFor(text: string): Promise<Set<string>> {
  const r = await nvLegalNerV2Service.extractEntities(text, 'IN' as never);
  return new Set(r.entities.map((e) => e.type));
}

describe('NV-NER-INDIA-FORMS-001 — the live miss is closed', () => {
  it('extracts the statute ref, date and org that were previously all missed', async () => {
    const types = await typesFor(LIVE_SENTENCE);
    // Regression baseline: only AMOUNT + COURT were found before this fix.
    expect(types.has('AMOUNT')).toBe(true);
    expect(types.has('COURT')).toBe(true);
    expect(types.has('SECTION_REF')).toBe(true); // BNSS 482
    expect(types.has('DATE')).toBe(true);        // 12 March 2025
    expect(types.has('ORG')).toBe(true);         // Meridian Textiles Pvt Ltd
  });
});

describe('NV-NER-INDIA-FORMS-001 — Indian citation forms', () => {
  it.each([
    'BNSS 482',
    'BNS 103',
    'u/s 482 BNSS',
    'under section 138 of the NIA',
    'Section 482 of the Bharatiya Nagarik Suraksha Sanhita, 2023',
  ])('recognises %s as a section reference', async (s) => {
    expect((await typesFor(`The application was filed under ${s} today.`)).has('SECTION_REF')).toBe(true);
  });

  it('does NOT treat an invoice or ordinary token as a section reference', async () => {
    // Guard against over-matching: the bare-code branch is restricted to a known
    // list of Indian codes precisely so this cannot happen.
    const types = await typesFor('Invoice INV 88421 relates to COVID 19 relief and PO 4471.');
    expect(types.has('SECTION_REF')).toBe(false);
  });
});

describe('NV-NER-INDIA-FORMS-001 — Indian date ordering', () => {
  it.each(['12 March 2025', '12th March 2025', '01/04/2025', 'March 12, 2025'])(
    'recognises %s as a date',
    async (d) => {
      expect((await typesFor(`The hearing is listed on ${d}.`)).has('DATE')).toBe(true);
    },
  );
});

describe('NV-NER-INDIA-FORMS-001 — commercial parties', () => {
  it.each([
    'Meridian Textiles Pvt Ltd',
    'Acme Industries Limited',
    'Sharma & Co LLP',
  ])('recognises %s as an organisation', async (o) => {
    expect((await typesFor(`A claim was filed against ${o} last week.`)).has('ORG')).toBe(true);
  });

  it('still recognises regulators', async () => {
    expect((await typesFor('SEBI issued a show cause notice.')).has('ORG')).toBe(true);
  });
});

describe('NV-DOC-SUMMARY-ENVELOPE-001 — no orchestration envelope in a summary', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/services/sdk/sdk-document-pipeline-service.ts'),
    'utf8',
  );

  it('strips a fenced wrapper before parsing (reuses the existing convention)', () => {
    expect(SRC).toContain("replace(/```json\\s*|```/gi, '')");
  });

  it('never assigns raw model content to summary as a bare fallback', () => {
    // This exact expression is what leaked `{"agentId":"A-129"...}` to a partner.
    expect(SRC).not.toContain('summary = parsed.summary || llmResponse.content');
  });

  it('only accepts a string summary, and refuses envelope-shaped text', () => {
    expect(SRC).toContain("typeof parsed.summary === 'string'");
    expect(SRC).toContain('"agent(Id|Name)"');
  });

  it('declares the extract-only degradation instead of claiming 0.91 confidence', () => {
    expect(SRC).toContain('degradedReason');
    expect(SRC).toContain('confidence: degraded ? 0.2 : 0.91');
  });

  it('no longer passes off long words as legal key points', () => {
    expect(SRC).not.toContain('words.filter((w) => w.length > 4)');
  });
});
