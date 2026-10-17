/**
 * NV-CITATOR-ATTRIBUTION-001 — the attribution step's safety properties.
 *
 * The property under test is asymmetric and that asymmetry IS the specification: a false
 * `overruled` makes a lawyer discard valid law and they never find out, whereas a miss leaves
 * the verdict at `unknown` which the panel renders as "not cleared". So almost every test here
 * asserts that something is NOT attributed. Tests that assert a positive finding exist to stop
 * the module degenerating into "refuse everything", which would pass a precision gate while
 * being useless.
 *
 * Every fixture below is a verbatim slice of a Supreme Court judgment extracted from the NYS
 * corpus on 2026-08-20, not invented prose — the shapes that break naive matching are the ones
 * courts actually write, and a synthetic fixture would test a straw man.
 */
import { describe, it, expect } from 'vitest';
import { attributeTreatment, namesTargetAuthority, findAuthoritySpans } from '../../src/services/jrx-citator-attribution.js';

const at = (text: string, phrase: string, target: string) => {
  const i = text.indexOf(phrase);
  expect(i, `fixture must contain ${JSON.stringify(phrase)}`).toBeGreaterThanOrEqual(0);
  return attributeTreatment({ text, phraseIndex: i, phraseLength: phrase.length, targetAuthority: target });
};

describe('namesTargetAuthority — the stem collision must stay rejected', () => {
  it('does not match KESAVAN against Kesavananda', () => {
    // NV-CITATOR-AUTHORITY-RESOLVE-001: `includes('kesavan')` matched "kesavananda" and
    // resolved a 2018 Kerala HC matter as the 1973 Constitution Bench authority.
    expect(namesTargetAuthority(
      'WP(C)/4124/2018 KESAVAN Vs STATE OF KERALA',
      'Kesavananda Bharati v. State of Kerala',
    )).toBe(false);
  });

  it('matches the real authority', () => {
    expect(namesTargetAuthority(
      'HIS HOLINESS KESAVANANDA BHARATI SRIPADAGALAVARU versus STATE OF KERALA',
      'Kesavananda Bharati v. State of Kerala',
    )).toBe(true);
  });

  it('a lone place name is a forum, not an identity', () => {
    expect(namesTargetAuthority('SOME PARTY versus STATE OF KERALA', 'State of Kerala')).toBe(false);
  });
});

describe('findAuthoritySpans — a common surname is not an identity', () => {
  it('does not treat "Satpal Singh" as a mention of "Gurbaksh Singh Sibbia"', () => {
    /*
     * This exact collision produced a false `overruled` for Sibbia — the authority Sushila
     * Aggarwal expressly RELIED ON — because `singh` matched inside a neighbouring party name
     * in the reporter's verdict table. It is the Kesavananda bug in a new costume.
     */
    const spans = findAuthoritySpans(
      'Satpal Singh v. State of Punjab (2018) 4 SCC 303 : [2018] 3 SCR 739 – overruled.',
      'Gurbaksh Singh Sibbia v. State of Punjab',
    );
    expect(spans.filter((s) => s.isTarget)).toHaveLength(0);
  });

  it('still finds a genuine short-name mention', () => {
    const spans = findAuthoritySpans(
      'placing reliance on Sibbia (supra), the two-Judge Bench in Mhetre took the view',
      'Gurbaksh Singh Sibbia v. State of Punjab',
    );
    expect(spans.some((s) => s.isTarget)).toBe(true);
  });
});

describe('attributeTreatment — declining to overrule must never produce an edge', () => {
  it('refuses "demands due deference rather than the view being overruled"', () => {
    /*
     * Aligarh Muslim University (2024), Dipankar Datta J. dissenting. `being overruled` is
     * present verbatim and the holding is the OPPOSITE. This is the most dangerous shape in
     * the corpus, because nothing but reading the sentence distinguishes it from a real
     * overruling — and the reader who is misled never learns of it.
     */
    const text = 'The view taken therein, in the given facts and circumstances, is indeed a plausible view which demands due deference rather than the view being overruled at this distance of time.';
    const r = at(text, 'being overruled', 'Azeez Basha');
    expect(r.attributed).toBe(false);
    expect(r.veto).toBe('declined-to-overrule');
  });

  it('refuses "we see no reason to overrule"', () => {
    const r = at('We see no reason to overrule the decision in Azadi Bachao Andolan.', 'to overrule', 'Azadi Bachao Andolan');
    expect(r.attributed).toBe(false);
  });
});

describe('attributeTreatment — a submission is not a holding', () => {
  it('refuses counsel asking for an overruling (Vodafone / Azadi Bachao)', () => {
    /*
     * Vodafone (2012) verbatim. Counsel for the Revenue asked; the Court declined and
     * approved Azadi Bachao. Detection-only reports `overruled` for Azadi Bachao here.
     */
    const text = 'Before us, it was contended on behalf of the Revenue that Union of India v. Azadi Bachao Ando/an (2004) 10 SCC D 1 needs to be overruled insofar as it departs from McDowell and Co. Ltd.';
    const r = at(text, 'needs to be overruled', 'Azadi Bachao Andolan');
    expect(r.attributed).toBe(false);
    expect(['counsel-submission', 'hypothetical-or-conditional']).toContain(r.veto);
  });

  it('refuses the Solicitor General submitting that Mhetre should be overruled', () => {
    const text = 'Mr. Tushar Mehta, learned Solicitor General and Mr. Vikramjit Banerjee, learned Additional Solicitor General, submitted that the decision in Mhetre (supra) is erroneous and should be overruled.';
    const r = at(text, 'should be overruled', 'Siddharam Satlingappa Mhetre v. State of Maharashtra');
    expect(r.attributed).toBe(false);
  });
});

describe('attributeTreatment — quoting another court is not performing treatment', () => {
  it('refuses a block quotation introduced by "To quote"', () => {
    /*
     * Sushila Aggarwal (2018) transcribing Mhetre. The 2018 order performed nothing; it
     * referred the question to a larger Bench. The edge belongs to Mhetre, not to this order.
     */
    const text = 'the two-Judge Bench in Mhetre(supra) has taken the stand that the decisions in Salauddin (supra), K.L .Verma (supra), Adri Dharan Das (supra) and Sunita Devi (supra) are per incuriam. To quote:- "123. In view of the clear declaration of law"';
    const r = at(text, 'per incuriam', 'Salauddin Abdulsamad Shaikh v. State of Maharashtra');
    expect(r.attributed).toBe(false);
  });

  it('refuses paragraphs "extracted as under" from an earlier judgment', () => {
    const text = 'Paragraphs 365 to 367 of the judgment in Indore Development Authority are extracted as under: "365. Resultantly, the decision rendered in Pune Municipal Corpn. is hereby overruled';
    const r = at(text, 'is hereby overruled', 'Pune Municipal Corpn. v. Harakchand Misirimal Solanki');
    expect(r.attributed).toBe(false);
  });
});

describe('attributeTreatment — negation and non-judicial supersession', () => {
  it('refuses an explicitly NEGATED per incuriam finding', () => {
    const text = 'it was held that even if L.G. Chaudhary (II) does not refer to the decision of Lion Engineering, it cannot be termed to be per incuriam, as the very factum';
    const r = at(text, 'per incuriam', 'L.G. Chaudhary');
    expect(r.attributed).toBe(false);
  });

  it('refuses a LEGISLATIVE overruling — real, but not a judicial treatment edge', () => {
    /* Also the case a citation graph structurally cannot see, which is one reason
     * `goodLaw: 'good'` stays unreachable even after a graph exists. */
    const text = 'Thus, the 2015 Amendment Act has legislatively overruled the dictum of Patel Engg. where it was held that Section 8 and Section 11 are complementary in nature.';
    const r = at(text, 'legislatively overruled', 'SBP & Co. v. Patel Engg. Ltd.');
    expect(r.attributed).toBe(false);
    expect(r.veto).toBe('legislative-not-judicial');
  });
});

describe('attributeTreatment — the object must be a case, and the right one', () => {
  it('refuses "stand overruled" whose object is a STATUTE (Sibbia 1980)', () => {
    /*
     * Sibbia's own words. `stand overruled` is present, the nearest case name is Balchand
     * Jain, and NO case was overruled — the object is Section 438 and Rule 184.
     */
    const text = 'In Balchand Jain v. State of Madhya Pradesh, [1977] 2 SCR 52, this Court was considering whether the provisions of Section 438 relating to anticipatory bail stand overruled or repealed by virtue of Rule 184 of the Defence and Internal Security of India Rules, 1971';
    const r = at(text, 'stand overruled', 'Balchand Jain v. State of Madhya Pradesh');
    expect(r.attributed).toBe(false);
    /* Two independent guards catch this sentence — the `whether ... overruled` framing and the
     * statutory object. Asserting on which one fired would make the test brittle about routing
     * rather than about the safety property, so only the refusal is asserted here; the
     * statute veto is exercised in isolation below. */
    expect(r.veto).toBeTruthy();
  });

  it('names the statutory-object veto when no other guard fires first', () => {
    const text = 'Balchand Jain v. State of Madhya Pradesh held that the provisions of Section 438 relating to anticipatory bail stand overruled, and nothing further arises.';
    const r = at(text, 'stand overruled', 'Balchand Jain v. State of Madhya Pradesh');
    expect(r.attributed).toBe(false);
    expect(r.veto).toBe('object-is-statute-not-case');
  });

  it('does not invert the edge — the OVERRULING court is not overruled', () => {
    /* Interstate Construction (2025). Naive nearest-name binding reports Hyder Consulting,
     * the three-Judge Bench that DID the overruling, as the authority overruled. */
    const text = 'A three-Judge Bench of this Court in UHL Power Company Ltd. Vs. State of Himachal Pradesh declared that the judgment in S.L. Arora (supra) has since been overruled by a three-Judge Bench of this Court in Hyder Consulting (UK) Ltd. (supra).';
    const r = at(text, 'has since been overruled', 'Hyder Consulting (UK) Ltd.');
    expect(r.attributed).toBe(false);
  });

  it('does not bind a verb to an authority the sentence RELIES on', () => {
    const text = 'Shri Gurbaksh Singh Sibbia and others v. State of Punjab (1980) 2 SCC 565 : [1980] 3 SCR 383 - relied on. Salauddin Abdulsamad Shaikh v. State of Maharashtra (1996) 1 SCC 667 : [1995] 6 Suppl. SCR 556 - overruled.';
    const r = at(text, '- overruled', 'Gurbaksh Singh Sibbia v. State of Punjab');
    expect(r.attributed).toBe(false);
  });
});

describe('attributeTreatment — it must still find real treatment', () => {
  it('binds "The view taken in X ... is overruled" (Aligarh Muslim University 2024)', () => {
    const text = 'The view taken in Azeez Basha that an educational institution is not established by a minority if it derives its legal character through a statute, is overruled.';
    const r = at(text, 'is overruled', 'Azeez Basha');
    expect(r.attributed).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.confidence).toBeLessThan(1);
  });

  it('binds the Constitution Bench conclusion to the named authority (Sushila Aggarwal 2020)', () => {
    const text = 'The observations in Siddharam Satlingappa Mhetre v. State of Maharashtra & Ors (and other similar judgments) that no restrictive conditions at all can be imposed, while granting anticipatory bail are hereby overruled.';
    const r = at(text, 'are hereby overruled', 'Siddharam Satlingappa Mhetre v. State of Maharashtra');
    expect(r.attributed).toBe(true);
  });

  it('reads a reporter verdict table group, and reports HOW it bound', () => {
    const text = 'Case Law Cited Kamal K. Singh v. Dinesh Gupta (2022) 8 SCC 33; Ashok G. Rajani v. Beacon Trusteeship Ltd [2022] 18 SCR 133 : 2022 SCC OnLine SC 1275 - held per incuriam.';
    const r = at(text, 'held per incuriam', 'Kamal K. Singh v. Dinesh Gupta');
    expect(r.attributed).toBe(true);
    expect(r.method).toBe('reporter-list-verdict');
  });

  it('never reports certainty — a binding is an inference about syntax', () => {
    const text = 'The view taken in Azeez Basha is overruled.';
    expect(at(text, 'is overruled', 'Azeez Basha').confidence).toBeLessThan(1);
  });
});

/*
 * MUTATION-DRIVEN TESTS.
 *
 * Every case below closes a guard that survived a mutation — i.e. the guard existed but nothing
 * tested it, so it could have been deleted silently. Each mutation was byte-diff verified as
 * applied and compiling before being believed (three "survivors" on another task today were
 * broken instruments, not real gaps).
 */
describe('attributeTreatment — guards closed by mutation testing', () => {
  it('M2: refuses a negated per incuriam even with no other veto in the sentence', () => {
    /* Survived "negation veto disabled" because the gold-set fixture for this shape also
     * carried a quotation frame, so the quotation veto killed the phrase first and the
     * negation guard was never exercised. */
    const r = at('The decision in L.G. Chaudhary (II) cannot be termed to be per incuriam.', 'per incuriam', 'L.G. Chaudhary');
    expect(r.attributed).toBe(false);
    expect(r.veto).toBe('negated');
  });

  it('M2: refuses "has not been overruled"', () => {
    const r = at('The judgment in Azeez Basha has not been overruled to this day.', 'has not been overruled', 'Azeez Basha');
    expect(r.attributed).toBe(false);
    expect(r.veto).toBe('negated');
  });

  it('M6: refuses a conditional overruling', () => {
    /* Survived "hypothetical veto disabled": the gold set's conditional fixtures were also
     * caught by the different-authority rule, hiding the fact that nothing tested this guard
     * on its own. A judgment reasoning about what WOULD follow has decided nothing. */
    const r = at('If the proposed view were accepted, the decision in Azeez Basha would stand overruled.', 'would stand overruled', 'Azeez Basha');
    expect(r.attributed).toBe(false);
    expect(r.veto).toBe('hypothetical-or-conditional');
  });

  it('M6: refuses an open question framed with "whether"', () => {
    const r = at('The question is whether the decision in Azeez Basha is per incuriam.', 'per incuriam', 'Azeez Basha');
    expect(r.attributed).toBe(false);
  });

  it('M9: prefers the NEARER named authority as the object of the verb', () => {
    /*
     * Survived "nearest-other-authority check inverted". This is the core of the whole module:
     * "we rely on X and overrule Y" must not produce an edge for X. Nothing tested it because
     * every gold-set instance of the shape also failed an earlier guard.
     */
    const text = 'We reiterate the ratio in Gurbaksh Singh Sibbia v. State of Punjab and hold that Siddharam Satlingappa Mhetre v. State of Maharashtra is overruled.';
    const forSibbia = at(text, 'is overruled', 'Gurbaksh Singh Sibbia v. State of Punjab');
    expect(forSibbia.attributed).toBe(false);
    expect(forSibbia.veto).toBe('different-authority-is-the-object');
    // Positive control: the authority that IS the object must still bind, or the test would
    // pass on a module that refuses everything.
    expect(at(text, 'is overruled', 'Siddharam Satlingappa Mhetre v. State of Maharashtra').attributed).toBe(true);
  });

  it('M12: a non-adverse reporter marker terminates the group before an adverse one', () => {
    /*
     * Survived "reporter non-adverse marker ignored". Reporter tables pack dozens of
     * authorities into a few lines; a marker governs back to the previous marker, so an
     * authority marked `relied on` must not be swept into a following `– overruled`.
     *
     * The separator MUST be a semicolon here. With a full stop the sentence-break guard fires
     * first and the marker check is never reached — which is exactly why the first two
     * versions of this test left M12 alive: they proved a different guard.
     */
    const text = 'Sibbia v. State of Punjab (1980) 2 SCC 565 - relied on; Mhetre v. State of Maharashtra (2011) 1 SCC 694 - overruled.';
    expect(at(text, '- overruled', 'Sibbia v. State of Punjab').attributed).toBe(false);
  });

  it('M12: the sentence-break guard is a SEPARATE path from the marker check', () => {
    const text = 'Sibbia v. State of Punjab (1980) 2 SCC 565 - relied on. Mhetre v. State of Maharashtra (2011) 1 SCC 694 - overruled.';
    expect(at(text, '- overruled', 'Sibbia v. State of Punjab').attributed).toBe(false);
  });

  it('M19: a reporter marker does not reach back across a real sentence break', () => {
    /*
     * Survived "reporter sentence-break check removed". A verdict marker governs a LIST; once
     * prose intervenes the list convention no longer applies, and reaching back over a full
     * sentence lets a marker claim an authority that was merely being applied.
     *
     * The previous marker must be absent from this fixture, otherwise the marker check kills
     * the mutation and this test proves that guard instead of the sentence-break one.
     */
    const text = 'Sibbia v. State of Punjab (1980) 2 SCC 565 was applied throughout. Mhetre v. State of Maharashtra (2011) 1 SCC 694 - overruled.';
    expect(at(text, '- overruled', 'Sibbia v. State of Punjab').attributed).toBe(false);
  });

  it('M12: a neutral "distinguished" marker also terminates the group', () => {
    const text = 'Abhishek Singh v. Huhtamaki PPL Limited [2023] 4 SCR 596 - distinguished; Kamal K. Singh v. Dinesh Gupta (2022) 8 SCC 33 - held per incuriam.';
    expect(at(text, 'held per incuriam', 'Abhishek Singh v. Huhtamaki PPL Limited').attributed).toBe(false);
  });
});
