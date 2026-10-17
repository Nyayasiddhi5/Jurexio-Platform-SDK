/**
 * NV-CITATOR-ATTRIBUTION-001 — gold-set integrity and the detector's attribution gate.
 *
 * A gold set with fabricated labels makes every downstream precision number fiction, so the set
 * is defended here as an artefact, not only as an input: every item's `evidence` must be a
 * verbatim substring of its own `passage`, every label must be text-derived, and the negative
 * controls must actually be present — a "gold set" of nothing but positives would score any
 * naive matcher at 100% precision and tell us nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectNegativeTreatment } from '../../src/services/jrx-citator-treatment.js';

interface GoldItem {
  id: string;
  target: string;
  expected: 'overruled' | 'doubted' | 'unknown';
  control: string;
  labelBasis: string;
  evidence: string;
  passage: string;
  source: { judgmentId: string };
}

const gold = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/audit/eval/jrx-treatment-attribution-set.v1.json'), 'utf8'),
) as { items: GoldItem[]; provenance: { unsourceable: string[] } };

const norm = (s: string) => s
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

describe('gold set — labels cannot drift away from the text they describe', () => {
  it('every evidence slice is verbatim in its own passage', () => {
    for (const it of gold.items) {
      expect(norm(it.passage), it.id).toContain(norm(it.evidence));
    }
  });

  it('every scored label is text-derived, never a legal-status claim', () => {
    // A legal-status label needs a practising advocate. Scoring against one would launder an
    // unverified claim into a precision number.
    for (const it of gold.items) {
      expect(['text-derived', 'needs-counsel'], it.id).toContain(it.labelBasis);
    }
  });

  it('carries enough negative controls to be worth anything', () => {
    const negatives = gold.items.filter((i) => i.control.startsWith('negative-'));
    // A set of positives alone scores a naive proximity matcher at 100% precision.
    expect(negatives.length).toBeGreaterThan(gold.items.length / 2);
  });

  it('covers every linguistic trap the attribution step exists to catch', () => {
    const controls = new Set(gold.items.map((i) => i.control));
    for (const required of [
      'negative-declined',
      'negative-quotation',
      'negative-submission',
      'negative-negated',
      'negative-statutory-object',
      'negative-relied-on',
      'negative-third-party-report',
      'negative-legislative',
    ]) {
      expect(controls, `missing control class: ${required}`).toContain(required);
    }
  });

  it('records the landmarks it could NOT source, rather than quietly omitting them', () => {
    // Kesavananda and Maneka Gandhi are above the deployed 20 MB extraction cap. Silence here
    // would read as "we covered them".
    expect(gold.provenance.unsourceable.length).toBeGreaterThan(0);
  });

  it('has at least one positive per adverse verdict, so recall is measurable', () => {
    const expectations = gold.items.map((i) => i.expected);
    expect(expectations).toContain('overruled');
    expect(expectations).toContain('doubted');
  });
});

describe('detectNegativeTreatment — the attribution gate', () => {
  const kesavanandaPassage = 'The view taken in Azeez Basha is overruled. We respectfully follow the ratio in Kesavananda Bharati.';

  it('emits no adverse verdict for an authority the text does not treat', () => {
    const r = detectNegativeTreatment({
      passages: [{ text: kesavanandaPassage }],
      targetAuthority: 'Kesavananda Bharati v. State of Kerala',
    });
    expect(r.goodLaw).toBe('unknown');
    expect(r.treatments.filter((t) => t.treatment === 'overruled')).toHaveLength(0);
  });

  it('emits the adverse verdict for the authority the text DOES treat', () => {
    const r = detectNegativeTreatment({
      passages: [{ text: kesavanandaPassage }],
      targetAuthority: 'Azeez Basha',
    });
    expect(r.goodLaw).toBe('overruled');
  });

  it('labels every attributed row with HOW it bound, and never as unattributed', () => {
    const r = detectNegativeTreatment({
      passages: [{ text: kesavanandaPassage }],
      targetAuthority: 'Azeez Basha',
    });
    for (const t of r.treatments) {
      expect(t.attributionMethod).toBeTruthy();
      expect(t.attributionMethod).not.toBe('unattributed');
      // extractedBy must stay honest: the panel renders deterministic as "Verified phrase".
      expect(t.extractedBy).toBe('deterministic');
    }
  });

  it('scans past a vetoed first occurrence to a genuine later one', () => {
    /*
     * In a full body the first `overruled` is routinely a counsel submission. Stopping at the
     * first match would turn a real later holding into a miss for no reason.
     */
    const text = 'It was contended on behalf of the Revenue that Azeez Basha needs to be overruled. '
      + 'We have considered the matter afresh. The view taken in Azeez Basha is overruled.';
    const r = detectNegativeTreatment({ passages: [{ text }], targetAuthority: 'Azeez Basha' });
    expect(r.goodLaw).toBe('overruled');
  });

  it('legacy passage mode is unchanged — no targetAuthority, no attribution', () => {
    const r = detectNegativeTreatment({ passages: [{ text: 'That decision stands overruled.' }] });
    expect(r.goodLaw).toBe('overruled');
    expect(r.treatments[0].attributionMethod).toBeUndefined();
  });

  it('`good` stays unreachable even with attribution on', () => {
    const r = detectNegativeTreatment({
      passages: [{ text: 'We respectfully follow the ratio in Azeez Basha. The decision is affirmed.' }],
      targetAuthority: 'Azeez Basha',
    });
    expect(r.goodLaw).not.toBe('good');
  });
});
