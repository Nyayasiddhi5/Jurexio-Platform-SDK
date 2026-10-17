/**
 * NV-COUNSEL-GRADE-EVAL-001 — tests for the CHECKER, not for the platform.
 *
 * The whole point of this suite is to make the harness falsifiable without a live
 * gateway. Three properties are pinned:
 *
 *   1. Every assertion in `ASSERTION_IDS` goes RED on at least one fixture. An
 *      assertion nobody has ever seen fail is a decoration — that is the mistake
 *      the port-5000 health probe made during a 51-minute outage.
 *   2. Every fixture fails EXACTLY the assertions it declares. Over-firing is a
 *      false failure and is caught just as loudly as under-firing, because a
 *      board that cries wolf gets muted and then the real defect ships.
 *   3. A transport failure is `blocked`, never `fail`. Platform-down must not
 *      read as quality-regressed.
 */
import { describe, it, expect } from 'vitest';
import {
  assessAnswer,
  diffRuns,
  detectReporterCitations,
  detectCaseNames,
  detectImpossibleCitations,
  analyseStatuteCurrency,
  scoreStructure,
  readBody,
  readEnvelope,
  ASSERTION_IDS,
  type AssertionId,
  type CounselGradeAssessment,
} from '../../scripts/_nv-counsel-grade-assertions.js';
import { COUNSEL_GRADE_FIXTURES } from '../../scripts/_nv-counsel-grade-fixtures.js';

const assess = (f: (typeof COUNSEL_GRADE_FIXTURES)[number]): CounselGradeAssessment =>
  assessAnswer(
    { body: f.body, envelope: f.envelope, httpStatus: f.httpStatus, transportError: f.transportError },
    f.config,
  );

const failedIds = (a: CounselGradeAssessment): AssertionId[] =>
  a.assertions.filter((x) => x.status === 'fail').map((x) => x.id).sort();
const blockedIds = (a: CounselGradeAssessment): AssertionId[] =>
  a.assertions.filter((x) => x.status === 'blocked').map((x) => x.id).sort();

describe('NV-COUNSEL-GRADE-EVAL-001: every fixture grades exactly as declared', () => {
  for (const fixture of COUNSEL_GRADE_FIXTURES) {
    it(`${fixture.config.id} — ${fixture.why.split('.')[0]}`, () => {
      const a = assess(fixture);
      // The message carries the details so a failure here is actionable without
      // re-running anything.
      const detail = a.assertions
        .filter((x) => x.status === 'fail' || x.status === 'blocked')
        .map((x) => `${x.status}:${x.id}=${x.detail}`)
        .join('\n');
      expect(failedIds(a), detail).toEqual([...fixture.expectFailing].sort());
      expect(blockedIds(a), detail).toEqual([...(fixture.expectBlocked ?? [])].sort());
    });
  }
});

describe('NV-COUNSEL-GRADE-EVAL-001: the harness is provably capable of failing', () => {
  const everFailed = new Set<AssertionId>();
  const everPassed = new Set<AssertionId>();
  for (const f of COUNSEL_GRADE_FIXTURES) {
    for (const a of assess(f).assertions) {
      if (a.status === 'fail') everFailed.add(a.id);
      if (a.status === 'pass') everPassed.add(a.id);
    }
  }

  it('has a RED fixture for every quality assertion', () => {
    // `transport` is excluded: it goes `blocked`, never `fail`, by design.
    const quality = ASSERTION_IDS.filter((id) => id !== 'transport');
    expect([...everFailed].sort()).toEqual([...quality].sort());
  });

  it('has a GREEN fixture for every assertion — a stuck red light is not a check', () => {
    for (const id of ASSERTION_IDS) {
      expect(everPassed.has(id), `${id} never passes on any fixture`).toBe(true);
    }
  });

  it('has at least one fixture that is fully green', () => {
    expect(COUNSEL_GRADE_FIXTURES.some((f) => assess(f).ok)).toBe(true);
  });

  it('has at least one fixture that is red', () => {
    expect(COUNSEL_GRADE_FIXTURES.some((f) => assess(f).failed > 0)).toBe(true);
  });
});

describe('NV-COUNSEL-GRADE-EVAL-001: a platform outage is BLOCKED, never FAILED', () => {
  const cfg = { id: 'x', family: 'legal_research', prompt: 'p', minChars: 1_000, minCaseAuthorities: 1 };

  it('records a timeout as blocked with zero failures', () => {
    const a = assessAnswer({ body: '', transportError: 'aborted due to timeout' }, cfg);
    expect(a.failed).toBe(0);
    expect(a.blocked).toBe(true);
    expect(a.blockedCount).toBe(ASSERTION_IDS.length);
    expect(a.ok).toBe(false); // blocked is not "fine" either — it is unmeasured
  });

  it('records a 502 HTML body as blocked, not as a short answer', () => {
    // The instrument-validation lesson: a 2 ms HTML response means the probe hit
    // the wrong hop. Reading it as "answer too short" would be a quality lie.
    const a = assessAnswer({ body: '<html>502 Bad Gateway</html>', httpStatus: 502 }, cfg);
    expect(a.failed).toBe(0);
    expect(a.blockedCount).toBe(ASSERTION_IDS.length);
  });

  it('does NOT treat http 200 with a real body as blocked', () => {
    // POSITIVE CONTROL — otherwise everything would be blocked and nothing measured.
    const a = assessAnswer(
      { body: 'x'.repeat(2_000), httpStatus: 200, envelope: null },
      cfg,
    );
    expect(a.blocked).toBe(false);
    expect(a.assertions.find((x) => x.id === 'transport')?.status).toBe('pass');
  });
});

describe('NV-COUNSEL-GRADE-EVAL-001: authority detection does not trust the envelope', () => {
  it('finds the real Indian reporter shapes', () => {
    expect(detectReporterCitations('see Sushila Aggarwal, (2020) 5 SCC 1, at para 92')).toContain('(2020) 5 SCC 1');
    expect(detectReporterCitations('Sibbia, AIR 1980 SC 1632')).toContain('AIR 1980 SC 1632');
    expect(detectReporterCitations('P. Chidambaram, 2019 SCC OnLine SC 1549').length).toBe(1);
    expect(detectReporterCitations('reported as 2023 INSC 456').length).toBe(1);
  });

  it('does NOT match a statute table row as a case citation', () => {
    // The reason REPORTER_SERIES is an allowlist. A generic
    // "(year) N CAPS N" pattern matches an IPC→BNS mapping table, which would
    // let authority_density pass on an answer containing no case law at all.
    expect(detectReporterCitations('Section 420 IPC (2024) 3 BNS 318 renumbered')).toEqual([]);
    expect(detectReporterCitations('(2023) 12 BNSS 482')).toEqual([]);
  });

  it('counts a case name only when something locates it', () => {
    const located = detectCaseNames('In Sushila Aggarwal versus State (NCT of Delhi), (2020) 5 SCC 1, the Court held');
    expect(located.cited.length).toBe(1);
    expect(located.bare.length).toBe(0);

    const floating = detectCaseNames('The principle in Sushila Aggarwal versus State of Delhi is well settled.');
    expect(floating.cited.length).toBe(0);
    expect(floating.bare.length).toBe(1);
  });

  it('never counts a cause title or a role pair as an authority', () => {
    // A draft's own cause title would otherwise satisfy authority_density.
    expect(detectCaseNames('[APPLICANT NAME] versus The State of Telangana').cited).toEqual([]);
    expect(detectCaseNames('Petitioner versus Respondent, (2020) 5 SCC 1').cited).toEqual([]);
  });

  it('never counts a `[[ ]]`-wrapped name as a delivered authority', () => {
    // Measured live: the platform said the reporter citations were missing from the
    // corpus and wrapped the case names in its placeholder marker. An earlier build
    // counted those, so the citation-free answer PASSED authority_density.
    const wrapped = detectCaseNames(
      'The specific Supreme Court reporter citations are absent from the corpus.\n'
      + '* **[[P. Chidambaram v. Directorate of Enforcement]]**\n'
      + '* **[[Sushila Aggarwal v. State (NCT of Delhi)]]**',
    );
    expect(wrapped.cited).toEqual([]);
  });

  it('still counts a real High Court authority located by case number and court', () => {
    // POSITIVE CONTROL for the fix above: the exclusion must not swallow the
    // neutral-citation shape that 99.8% of the corpus actually carries.
    const real = detectCaseNames(
      'Suleman Mulla v. State of West Bengal [CRM (A)/755/2024] (Calcutta High Court)',
    );
    expect(real.cited.length).toBe(1);
  });

  it('does not report the same name as both located and bare', () => {
    // Otherwise `caseAuthorities` double-counts a placeholder as real.
    const both = detectCaseNames(
      '[[Sushila Aggarwal v. State of Delhi]] is the authority. See Sushila Aggarwal v. State of Delhi, (2020) 5 SCC 1.',
    );
    expect(both.cited.length).toBe(1);
    expect(both.bare).toEqual([]);
  });

  it('reads the corpus "versus" spelling as well as "v."', () => {
    // NYS stores titles as `X versus Y`; counsel types `X v. Y`. Both must count.
    expect(detectCaseNames('GURBAKSH SINGH SIBBIA versus STATE OF PUNJAB, AIR 1980 SC 1632').cited.length).toBe(1);
    expect(detectCaseNames('Kesavananda Bharati v. State of Kerala, (1973) 4 SCC 225').cited.length).toBe(1);
  });
});

describe('NV-COUNSEL-GRADE-EVAL-001: statute currency is not a keyword ban', () => {
  it('treats a repealed reference with its successor as TRANSITIONAL', () => {
    const c = analyseStatuteCurrency(
      'Cheating is now punishable under Section 318(4) BNS, corresponding to the erstwhile Section 420 of the Indian Penal Code.',
    );
    expect(c.legacyTransitionalMentions).toBeGreaterThan(0);
    expect(c.legacyOperativeMentions).toBe(0);
  });

  it('treats a bare repealed reference as STALE', () => {
    const c = analyseStatuteCurrency(
      'The applicant is charged under Section 420 of the Indian Penal Code and seeks bail under Section 438 CrPC.',
    );
    expect(c.legacyOperativeMentions).toBeGreaterThan(0);
    expect(c.staleReferences.join(' ')).toMatch(/420|438/);
  });

  it('does not let "Code of Criminal Procedure" satisfy its own transitional test', () => {
    // The match text is stripped before the transitional window is scanned,
    // otherwise the word "Code" inside the instrument name would make every
    // stale CrPC reference look correctly framed.
    const c = analyseStatuteCurrency('An application under Section 438 of the Code of Criminal Procedure is filed.');
    expect(c.legacyOperativeMentions).toBe(1);
  });

  it('reports the new-code count so a zero can be distinguished from a stale mention', () => {
    expect(analyseStatuteCurrency('Section 482 BNSS applies.').newCodeMentions).toBe(1);
    expect(analyseStatuteCurrency('Section 438 CrPC applies.').newCodeMentions).toBe(0);
  });
});

describe('NV-COUNSEL-GRADE-EVAL-001: fabrication detection is structural, no corpus needed', () => {
  it('rejects a future decision year', () => {
    expect(detectImpossibleCitations(['(2031) 4 SCC 88'], new Date('2026-08-19Z'))).toEqual(['(2031) 4 SCC 88']);
  });

  it('rejects volume or page zero, and an impossible SCC volume', () => {
    expect(detectImpossibleCitations(['(2019) 0 SCC 0']).length).toBe(1);
    expect(detectImpossibleCitations(['(2019) 45 SCC 12']).length).toBe(1);
  });

  it('accepts every real citation in the set — a stuck detector would fail here', () => {
    // POSITIVE CONTROL.
    expect(
      detectImpossibleCitations(
        ['(2020) 5 SCC 1', 'AIR 1980 SC 1632', '(1973) 4 SCC 225', '(1978) 1 SCC 248'],
        new Date('2026-08-19Z'),
      ),
    ).toEqual([]);
  });
});

describe('NV-COUNSEL-GRADE-EVAL-001: structure scoring is per-instrument', () => {
  const notice = `LEGAL NOTICE

1. My client issued a cheque bearing No. [CHEQUE NUMBER].
2. The said cheque was returned unpaid.
3. You are called upon to pay within fifteen days.

Place: Hyderabad
Date: [DATE]

[ADVOCATE NAME]
Counsel for the Complainant`;

  it('scores a legal notice on the keys a notice actually has', () => {
    const s = scoreStructure(notice, ['numberedParagraphs', 'advocateBlock', 'placeDate']);
    expect(Object.values(s).every(Boolean)).toBe(true);
  });

  it('does not credit a notice with pleading elements it has none of', () => {
    // Demanding these of a notice would be a false failure; crediting them would
    // make the check meaningless. Both directions matter.
    const s = scoreStructure(notice, ['causeTitle', 'showeth', 'prayer', 'verification']);
    expect(Object.values(s).some(Boolean)).toBe(false);
  });

  it('accepts a bracketed PLACEHOLDER advocate block, but not an absent one', () => {
    // Live false failure: a Section 138 notice signed
    // `**[[PLACEHOLDER: ADVOCATE NAME / LAW FIRM LETTERHEAD]]**` was marked
    // missing. A correctly-slotted placeholder is the DESIRED output under the
    // anti-fabrication rule, so failing it punished the platform for behaving well.
    expect(
      scoreStructure('**[[PLACEHOLDER: ADVOCATE NAME / LAW FIRM LETTERHEAD]]**', ['advocateBlock'])
        .advocateBlock,
    ).toBe(true);
    // NEGATIVE CONTROL — the widened pattern must not match any bracketed text,
    // or the check becomes vacuous on every draft that contains a placeholder.
    expect(scoreStructure('[[PLACEHOLDER: Cheque Number]]', ['advocateBlock']).advocateBlock).toBe(false);
    expect(scoreStructure('Yours faithfully,\n\nA. Person', ['advocateBlock']).advocateBlock).toBe(false);
  });

  it('requires three numbered paragraphs, not one stray list item', () => {
    expect(scoreStructure('1. Only one point here.', ['numberedParagraphs']).numberedParagraphs).toBe(false);
    expect(scoreStructure('1. A\n2. B\n3. C', ['numberedParagraphs']).numberedParagraphs).toBe(true);
  });
});

describe('NV-COUNSEL-GRADE-EVAL-001: envelope reading survives the wrapper shapes', () => {
  it('reads the contract at the top level and under data/result', () => {
    expect(readBody({ content: 'top' })).toBe('top');
    expect(readBody({ data: { content: 'nested' } })).toBe('nested');
    expect(readBody({ result: { response: 'alt' } })).toBe('alt');
    expect(readBody({ curated: { summary: 'curated only' } })).toBe('curated only');
    expect(readBody(null)).toBe('');
  });

  it('reads trust and citations from either level', () => {
    const nested = readEnvelope({ data: { trust: { citationsPresent: true }, citations: { verified: 1, unverified: 0 } } });
    expect(nested.trust?.citationsPresent).toBe(true);
    expect(nested.citations).toEqual({ verified: 1, unverified: 0 });
  });

  it('reports an honest `unknown` treatment as PRESENT', () => {
    // The distinction the good_law_signal assertion rests on.
    expect(readEnvelope({ goodLaw: { status: 'unknown' } }).treatmentSignal).toEqual({ present: true, value: 'unknown' });
    expect(readEnvelope({ authority: { matched: true } }).treatmentSignal.present).toBe(false);
  });
});

describe('NV-COUNSEL-GRADE-EVAL-001: run-to-run regression detection', () => {
  const mk = (status: 'pass' | 'fail' | 'blocked'): { cases: CounselGradeAssessment[] } => ({
    cases: [
      {
        caseId: 'c1', family: 'legal_research', bodyChars: 100, blocked: false,
        metrics: {} as never,
        assertions: [{ id: 'authority_density', label: 'l', status, measured: 0, expected: 1, detail: 'd' }],
        passed: status === 'pass' ? 1 : 0,
        failed: status === 'fail' ? 1 : 0,
        blockedCount: status === 'blocked' ? 1 : 0,
        ok: status === 'pass',
      },
    ],
  });

  it('reports pass → fail as a regression', () => {
    const d = diffRuns(mk('pass'), mk('fail'));
    expect(d.regressions).toHaveLength(1);
    expect(d.regressions[0].assertionId).toBe('authority_density');
  });

  it('reports fail → pass as an improvement, not a regression', () => {
    const d = diffRuns(mk('fail'), mk('pass'));
    expect(d.regressions).toHaveLength(0);
    expect(d.improvements).toHaveLength(1);
  });

  it('does NOT report pass → blocked as a regression', () => {
    // The outage lesson applied to the trend: the platform being unreachable says
    // nothing about quality, and gating CI on it would make the gate a coin flip
    // on network weather.
    expect(diffRuns(mk('pass'), mk('blocked')).regressions).toHaveLength(0);
  });

  it('DOES report blocked → fail as a regression', () => {
    // The answer arrived this time, and it was bad. That is a real signal.
    expect(diffRuns(mk('blocked'), mk('fail')).regressions).toHaveLength(1);
  });

  it('is not comparable with no history, and never invents a regression', () => {
    const d = diffRuns(null, mk('fail'));
    expect(d.comparable).toBe(false);
    expect(d.regressions).toHaveLength(0);
  });

  it('surfaces a case that silently dropped out of the set', () => {
    // A shrinking eval set is the quietest way to make a board go green.
    const d = diffRuns(mk('pass'), { cases: [] });
    expect(d.droppedCases).toEqual(['c1']);
  });
});
