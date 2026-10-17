/**
 * NV-DRAFT-BREADTH-P2-001 — routing + skeleton coverage for the eight court
 * instruments added in P2 (rejoinder, counter-affidavit, review petition,
 * execution petition, caveat, written statement, SLP, interim application).
 *
 * `inferDraftDocFamily` is a first-match-wins regex chain, so the risk this file
 * exists to catch is SHADOWING: a generic pattern ("affidavit", "petition",
 * "fir") swallowing a specific instrument that needs its own paper-book. That bug
 * has already shipped once in this repo (DOC_TYPE_HINTS read a cheque-dishonour
 * complaint as an FIR because it mentioned one), so the negative assertions below
 * are the point of the file, not decoration.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLegalDraftSystemPrompt,
  buildLegalDraftUserPrompt,
  constraintRuleFor,
  inferDraftDocFamily,
  indiaStructureFor,
  type LegalDraftDocFamily,
} from '../../src/services/jrx-legal-drafting-prompt.js';

const NEW_FAMILIES = [
  'rejoinder',
  'counter_affidavit',
  'review_petition',
  'execution_petition',
  'caveat',
  'written_statement',
  'slp',
  'interim_application',
] as const satisfies readonly LegalDraftDocFamily[];

/** Realistic caller phrasings, as they arrive from Console / partner SDK callers. */
const ROUTING_CASES: Array<[LegalDraftDocFamily, string]> = [
  ['rejoinder', 'draft a rejoinder to the counter-affidavit filed by respondent no. 2'],
  ['rejoinder', 'prepare rejoinder in WP 4412 of 2025'],
  ['rejoinder', 'replication to the written statement of the defendant'],
  ['rejoinder', 'reply to the written statement filed in the commercial suit'],

  ['counter_affidavit', 'draft a counter affidavit on behalf of the State'],
  ['counter_affidavit', 'counter-affidavit opposing the writ petition for quashing of FIR No. 221/2025'],
  ['counter_affidavit', 'reply affidavit of respondent no. 1 in the writ petition'],
  ['counter_affidavit', 'affidavit in opposition to the interim prayer'],

  ['review_petition', 'draft a review petition against the judgment dated 12 March 2026'],
  ['review_petition', 'review application under Order XLVII CPC'],
  ['review_petition', 'petition for review of the order passed in the second appeal'],
  ['review_petition', 'review under Article 137 of the Constitution'],

  ['execution_petition', 'file an execution petition to recover the decretal amount'],
  ['execution_petition', 'execution application under Order XXI CPC for attachment of the bank account'],
  ['execution_petition', 'petition for execution of the money decree'],
  ['execution_petition', 'darkhast for delivery of possession'],

  ['caveat', 'lodge a caveat before the High Court'],
  ['caveat', 'caveat under section 148A CPC anticipating an appeal'],
  ['caveat', 'draft a caveat petition for the caveator'],

  ['written_statement', 'draft a written statement on behalf of defendant no. 3'],
  ['written_statement', 'written statement with set-off in the recovery suit'],
  ['written_statement', 'prepare the counter-claim to be filed with the defence'],
  ['written_statement', 'reply under Order VIII CPC to the plaint'],

  ['slp', 'draft an SLP against the High Court judgment'],
  ['slp', 'special leave petition under Article 136 of the Constitution'],
  ['slp', 'special leave to appeal against the order of acquittal'],

  ['interim_application', 'draft an interim application for stay of the demolition notice'],
  ['interim_application', 'interlocutory application in the pending suit'],
  ['interim_application', 'application for ad-interim injunction under Order XXXIX Rules 1 and 2'],
  ['interim_application', 'application for temporary injunction restraining alienation'],
];

describe('NV-DRAFT-BREADTH-P2-001: routing for the eight new instruments', () => {
  for (const [expected, phrasing] of ROUTING_CASES) {
    it(`routes "${phrasing.slice(0, 58)}" → ${expected}`, () => {
      expect(inferDraftDocFamily('custom', undefined, phrasing)).toBe(expected);
    });
  }

  it('routes from the template slug and the documentType hint, not only the instruction', () => {
    /* Callers pass underscore slugs. `\b` does not fire between a word character
     * and `_`, so a `\s`-only pattern drops every slug form to `custom` — that was
     * a real failure here before `[\s_-]` was used throughout the P2 block. */
    expect(inferDraftDocFamily('written_statement')).toBe('written_statement');
    expect(inferDraftDocFamily('special_leave_petition')).toBe('slp');
    expect(inferDraftDocFamily('counter_affidavit')).toBe('counter_affidavit');
    expect(inferDraftDocFamily('review_petition')).toBe('review_petition');
    expect(inferDraftDocFamily('execution_petition')).toBe('execution_petition');
    expect(inferDraftDocFamily('interim_application')).toBe('interim_application');
    expect(inferDraftDocFamily('custom', 'special leave petition')).toBe('slp');
    expect(inferDraftDocFamily('caveat')).toBe('caveat');
    expect(inferDraftDocFamily('rejoinder')).toBe('rejoinder');
    expect(inferDraftDocFamily('custom', 'counter-affidavit')).toBe('counter_affidavit');
  });

  it('a rejoinder to a counter-affidavit is a rejoinder, not a counter-affidavit', () => {
    /* Order matters both ways: a rejoinder always NAMES the pleading it answers,
     * so testing counter_affidavit first captured the answering pleading. */
    expect(inferDraftDocFamily('custom', undefined, 'rejoinder to the counter-affidavit')).toBe('rejoinder');
    expect(inferDraftDocFamily('custom', undefined, 'rejoinder to the reply affidavit of respondent 1')).toBe(
      'rejoinder',
    );
  });
});

describe('NV-DRAFT-BREADTH-P2-001: shadowing — the specific instrument must win', () => {
  it('counter-affidavit is NOT swallowed by the bare affidavit rule', () => {
    const f = inferDraftDocFamily('custom', undefined, 'counter affidavit in the writ petition');
    expect(f).toBe('counter_affidavit');
    expect(f).not.toBe('affidavit');
  });

  it('a counter-affidavit that recites an FIR number is not classed as an FIR', () => {
    // The exact shape of the shipped DOC_TYPE_HINTS bug, in this classifier.
    const f = inferDraftDocFamily(
      'custom',
      undefined,
      'counter-affidavit of the Investigating Officer in the petition to quash FIR No. 118 of 2025 under BNS 318(4)',
    );
    expect(f).toBe('counter_affidavit');
    expect(f).not.toBe('fir');
  });

  it('review and execution petitions are NOT swallowed by the plain petition rule', () => {
    expect(inferDraftDocFamily('custom', undefined, 'review petition in writ petition no. 900 of 2025')).toBe(
      'review_petition',
    );
    expect(inferDraftDocFamily('custom', undefined, 'execution petition arising out of the decree in the suit')).toBe(
      'execution_petition',
    );
    for (const p of ['review petition', 'execution petition']) {
      expect(inferDraftDocFamily('custom', undefined, p)).not.toBe('petition');
    }
  });

  it('review petition is NOT captured by the "revision petition" BNSS application rule', () => {
    expect(inferDraftDocFamily('custom', undefined, 'review petition against the sessions order')).toBe(
      'review_petition',
    );
  });

  it('rejoinder does not fall through to notice or memo', () => {
    for (const p of ['rejoinder', 'replication to the written statement']) {
      const f = inferDraftDocFamily('custom', undefined, p);
      expect(f).toBe('rejoinder');
      expect(['notice', 'memo', 'letter']).not.toContain(f);
    }
  });

  it('written statement is not read as a notice, memo, or bare application', () => {
    const f = inferDraftDocFamily('custom', undefined, 'written statement to the plaint in the recovery suit');
    expect(f).toBe('written_statement');
    expect(['notice', 'memo', 'application', 'plaint']).not.toContain(f);
  });

  it('SLP now gets its own family instead of the generic petition skeleton', () => {
    const f = inferDraftDocFamily('custom', undefined, 'slp against the impugned judgment');
    expect(f).toBe('slp');
    expect(f).not.toBe('petition');
  });

  it('an interim application inside a writ petition routes to the IA, not the petition', () => {
    expect(
      inferDraftDocFamily('custom', undefined, 'interim application for stay in writ petition no. 77 of 2026'),
    ).toBe('interim_application');
  });

  it('caveat is not read as a petition merely because it is titled a caveat petition', () => {
    expect(inferDraftDocFamily('custom', undefined, 'caveat petition under section 148A')).toBe('caveat');
  });

  it('"Article 136" resolves by instrument, not by the bare number', () => {
    /* A genuine collision in Indian practice: Article 136 of the CONSTITUTION is the
     * SLP jurisdiction, while Article 136 of the LIMITATION ACT 1963 is the twelve-year
     * period for executing a decree. The execution patterns are therefore tested
     * before the SLP pattern, so a limitation question about executing a decree does
     * not become a Supreme Court petition. */
    expect(
      inferDraftDocFamily('custom', undefined, 'execution petition; limitation under Article 136 of the Limitation Act'),
    ).toBe('execution_petition');
    expect(inferDraftDocFamily('custom', undefined, 'petition under Article 136 of the Constitution')).toBe('slp');
  });
});

describe('NV-DRAFT-BREADTH-P2-001: the pre-existing families must not regress', () => {
  /* Positive control. Every one of these routed correctly BEFORE the eight new
   * patterns were inserted ahead of them; if a new pattern is made greedier, one
   * of these fails, which is the whole reason the block is here. */
  const REGRESSION_CASES: Array<[LegalDraftDocFamily, string]> = [
    ['petition', 'writ petition under Article 226 for quashing of the transfer order'],
    ['petition', 'draft a writ petition in the nature of mandamus'],
    ['plaint', 'draft a plaint for recovery of ₹12,00,000 with interest'],
    ['bail', 'draft anticipatory bail under BNSS 482'],
    ['bail', 'regular bail application for the accused in judicial custody'],
    ['bail', 'default bail application under section 187 BNSS'],
    ['fir', 'draft an FIR complaint for registration at the police station'],
    ['affidavit', 'draft an affidavit of the deponent verifying the annexures'],
    ['application', 'discharge application sessions'],
    ['application', 'adjournment application for tomorrow'],
    ['application', 'application for suspension of sentence pending appeal'],
    ['notice', 'send legal notice under NI Act section 138'],
    ['contract', 'draft an NDA between the two companies'],
    ['memo', 'prepare a legal opinion on stamp duty'],
    ['letter', 'covering letter to the Registrar'],
  ];
  for (const [expected, phrasing] of REGRESSION_CASES) {
    it(`still routes "${phrasing.slice(0, 52)}" → ${expected}`, () => {
      expect(inferDraftDocFamily('custom', undefined, phrasing)).toBe(expected);
    });
  }

  it('an interim bail request stays on the bail path (surety rule must not be bypassed)', () => {
    // `bail` is checked before `interim_application` on purpose: the bail family
    // carries the mandatory no-sureties-pre-grant rule.
    expect(inferDraftDocFamily('custom', undefined, 'application for interim bail on medical grounds')).toBe('bail');
    expect(buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      instruction: 'application for interim bail on medical grounds',
    })).toMatch(/SURETIES RULE/);
  });
});

describe('NV-DRAFT-BREADTH-P2-001: every new family owns a real skeleton', () => {
  const ANCHORS: Record<(typeof NEW_FAMILIES)[number], RegExp[]> = {
    rejoinder: [/Cause title/i, /PARA-WISE REJOINDER/i, /PRAYER/, /VERIFICATION/],
    counter_affidavit: [/Cause title/i, /PRELIMINARY OBJECTIONS/i, /PARA-WISE REPLY/i, /PRAYER/, /VERIFICATION/],
    review_petition: [/error apparent on the face of the record/i, /Article 124/, /PRAYER/, /VERIFICATION/],
    execution_petition: [/DECREE PARTICULARS/i, /Order XXI/, /MODE OF EXECUTION/i, /PRAYER/, /VERIFICATION/],
    caveat: [/148A/, /Caveator/i, /ninety days/i, /PRAYER/, /VERIFICATION/],
    written_statement: [/Order VIII/, /PARA-WISE REPLY/i, /SET-OFF/i, /COUNTER-CLAIM/i, /PRAYER/, /VERIFICATION/],
    slp: [/SYNOPSIS/, /LIST OF DATES/, /QUESTIONS OF LAW/, /GROUNDS/, /CERTIFICATE/, /PRAYER/],
    interim_application: [/URGENCY/, /prima facie case/i, /balance of convenience/i, /irreparable injury/i, /PRAYER/],
  };

  for (const family of NEW_FAMILIES) {
    it(`${family}: skeleton is substantive and carries its structural anchors`, () => {
      const s = indiaStructureFor(family);
      expect(s.length).toBeGreaterThan(600);
      // Depth parity with the established bail/petition skeleton.
      expect(s.split('\n').filter((l) => /^\d+\./.test(l.trim())).length).toBeGreaterThanOrEqual(8);
      for (const re of ANCHORS[family]) expect(s, `${family} missing ${re}`).toMatch(re);
    });
  }

  it('no new family silently falls back to the generic instrument text', () => {
    const generic = indiaStructureFor('custom');
    for (const family of NEW_FAMILIES) {
      expect(indiaStructureFor(family), family).not.toBe(generic);
    }
  });

  it('the 30/120-day written-statement limitation is signalled, not left to the model', () => {
    const s = indiaStructureFor('written_statement');
    expect(s).toMatch(/thirty days/i);
    expect(s).toMatch(/ninety days/i);
    expect(s).toMatch(/one hundred and twenty days/i);
  });
});

describe('NV-DRAFT-BREADTH-P2-001: constraint rules reach both prompts', () => {
  it('a review petition is told it is not a rehearing', () => {
    const rule = constraintRuleFor('review_petition');
    expect(rule).toMatch(/NOT a rehearing|appeal in disguise/i);
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'custom',
      instruction: 'draft a review petition against the judgment dated 12 March 2026',
      partnerBestOutcome: true,
    });
    expect(sp).toMatch(/REVIEW PETITION — SCOPE RULE/);
    expect(sp).toMatch(/error apparent on the face of the record/i);
    const up = buildLegalDraftUserPrompt({
      template: 'review petition',
      jurisdiction: 'IN',
      parameters: { judgmentDate: '2026-03-12' },
    });
    expect(up).toMatch(/NOT a rehearing/i);
  });

  it('an SLP is told the paper-book sections are mandatory', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'slp',
      instruction: 'special leave petition under Article 136',
      partnerBestOutcome: true,
    });
    expect(sp).toMatch(/SUPREME COURT PAPER-BOOK RULE/);
    expect(sp).toMatch(/SYNOPSIS/);
    expect(sp).toMatch(/CERTIFICATE/);
    expect(sp).toMatch(/Advocate-on-Record/);
    // The discretionary nature of Art 136 must be pleaded, not assumed.
    expect(sp).toMatch(/discretionary/i);
  });

  it('reply pleadings are told to traverse para-wise and not plead a new case', () => {
    for (const family of ['rejoinder', 'counter_affidavit', 'written_statement'] as const) {
      const rule = constraintRuleFor(family);
      expect(rule, family).toMatch(/TRAVERSE RULE/);
      expect(rule, family).toMatch(/Do NOT introduce a new case/i);
    }
  });

  it('families without a constraint rule emit nothing rather than an empty heading', () => {
    for (const family of ['plaint', 'contract', 'letter', 'caveat'] as const) {
      expect(constraintRuleFor(family), family).toBe('');
    }
  });

  it('the pre-existing bail rule still routes through the shared lookup', () => {
    expect(constraintRuleFor('bail')).toMatch(/SURETIES RULE/);
    expect(constraintRuleFor('bail')).toMatch(/deem fit and proper/);
  });
});

describe('NV-DRAFT-BREADTH-P2-001: the new instruments produce a usable system prompt', () => {
  it('an execution petition prompt carries the decree particulars and the forum', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'custom',
      instruction: 'execution petition for attachment of the judgment-debtor bank account',
      parameters: { courtName: 'Court of the Principal District Judge', district: 'Ernakulam', state: 'Kerala' },
      partnerBestOutcome: true,
    });
    expect(sp).toMatch(/DECREE PARTICULARS/);
    expect(sp).toMatch(/Order XXI/);
    expect(sp).toMatch(/Ernakulam/);
    expect(sp).toMatch(/Kerala/);
    // India core discipline must survive on the new families too.
    expect(sp).toMatch(/Never invent case citations/i);
    expect(sp).toMatch(/BNS 2023/);
  });

  it('a caveat stays short — it must not inherit the paper-book petition skeleton', () => {
    const s = indiaStructureFor('caveat');
    expect(s).toMatch(/do NOT pad it into a petition/i);
    expect(s).not.toMatch(/MOST RESPECTFULLY SHOWETH/);
  });
});
