/**
 * NV-COUNSEL-GRADE-EVAL-001 — the RED fixture corpus.
 *
 * This file is the answer to "how do you know the harness can fail?". Every
 * assertion in `_nv-counsel-grade-assertions.ts` has at least one fixture here
 * that it MUST mark red, and at least one it MUST mark green. `expectFailing` is
 * the contract: the checker has to fail exactly those assertion ids and no
 * others. That makes over-firing (a false failure) as loud as under-firing.
 *
 * `tests/unit/jrx-counsel-grade-assertions.test.ts` asserts every id in
 * `ASSERTION_IDS` appears in some fixture's `expectFailing`, so a newly added
 * assertion cannot ship without a proof that it can go red.
 *
 * The `research-confident-but-uncited` fixture is a reconstruction of the answer
 * actually measured on jrx-prod on 2026-08-19: well-structured prose, zero
 * citations, `trust.citationsPresent: true`. If the harness ever passes that
 * fixture, the harness is broken.
 */

import type { CounselGradeCaseConfig } from './_nv-counsel-grade-assertions.js';

export interface CounselGradeFixture {
  config: CounselGradeCaseConfig;
  body: string;
  envelope: Record<string, unknown> | null;
  httpStatus?: number;
  transportError?: string;
  /** Assertion ids that MUST be `fail`. Empty ⇒ the fixture must be fully green. */
  expectFailing: string[];
  /** Assertion ids that MUST be `blocked`. */
  expectBlocked?: string[];
  /** Why this fixture exists — printed in the self-test output. */
  why: string;
}

/* ── shared config blocks ───────────────────────────────────────── */

const RESEARCH_CONFIG: CounselGradeCaseConfig = {
  id: 'fixture-research',
  family: 'legal_research',
  prompt: 'leading Supreme Court authorities on anticipatory bail for economic offences',
  minChars: 1_500,
  minCaseAuthorities: 1,
};

const DRAFT_CONFIG: CounselGradeCaseConfig = {
  id: 'fixture-draft',
  family: 'legal-draft-fast',
  prompt: 'draft an anticipatory bail application under BNSS for a cheating allegation',
  minChars: 4_000,
  requiredStructure: [
    'causeTitle', 'showeth', 'prayer', 'verification', 'numberedParagraphs',
    'advocateBlock', 'placeDate',
  ],
  minStructureScore: 6,
  offenceEra: 'post-2024-07-01',
  factsWithheld: true,
};

const TRUST_GREEN = {
  trust: { grounded: true, citationsPresent: true, authoritiesDelivered: 2, qualityOk: true, compliancePassed: true },
  citations: { verified: 1, unverified: 1, details: [{ text: '(2020) 5 SCC 1' }, { text: 'AIR 1980 SC 1632' }] },
};

const TRUST_NO_AUTHORITIES = {
  // The exact shape measured live: one statutory reference, zero case law, and a
  // boolean that said everything was fine.
  trust: { grounded: true, citationsPresent: true, authoritiesDelivered: 1, qualityOk: true, compliancePassed: true },
  citations: { verified: 0, unverified: 1, details: [{ text: 'Article 21 of the Constitution' }] },
};

/* ── bodies ─────────────────────────────────────────────────────── */

const pad = (label: string, chars: number): string => {
  const sentence = `The position on ${label} is settled and the discretion is to be exercised judicially having regard to the nature of the accusation, the antecedents of the applicant and the possibility of the applicant fleeing from justice. `;
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);
};

const RESEARCH_WITH_AUTHORITIES = `## ISSUE & SHORT ANSWER

Anticipatory bail is available in economic-offence matters, but the discretion is exercised with greater circumspection.

## AUTHORITIES

1. **Sushila Aggarwal versus State (NCT of Delhi)**, (2020) 5 SCC 1 — a Constitution Bench held that an order of anticipatory bail need not invariably be limited in time.
2. **Gurbaksh Singh Sibbia versus State of Punjab**, AIR 1980 SC 1632 — the Court of Session and the High Court must apply their own mind and cannot mechanically impose conditions.
3. **P. Chidambaram versus Directorate of Enforcement**, 2019 SCC OnLine SC 1549 — economic offences constitute a class apart for the purposes of pre-arrest bail.

## ANALYSIS

${pad('anticipatory bail in economic offences', 900)}

## RISKS & CAVEATS

Section 482 BNSS governs the application. Article 21 of the Constitution informs the standard of personal liberty.
`;

/**
 * Reconstruction of the 6,925-character answer measured on jrx-prod: confident,
 * well-structured, and citing no authority whatsoever.
 */
const RESEARCH_CONFIDENT_UNCITED = `## ISSUE & SHORT ANSWER

Anticipatory bail may be granted in economic-offence matters, though courts approach such applications with caution.

## APPLICABLE PRINCIPLES

The Supreme Court has repeatedly emphasised that the power to grant pre-arrest bail is extraordinary in character and must be exercised sparingly. The gravity of the accusation, the role attributed to the applicant, and the likelihood of tampering with evidence are all relevant.

${pad('the balance between liberty and investigative need', 1_800)}

## RISKS & CAVEATS

Article 21 of the Constitution protects personal liberty, and any deprivation must follow a procedure established by law.
`;

const DRAFT_GOOD = `IN THE COURT OF THE PRINCIPAL SESSIONS JUDGE AT HYDERABAD

Crl.M.P. No. ______ of 2026

[APPLICANT NAME], S/o [FATHER'S NAME], aged [AGE] years,
R/o [ADDRESS]                                          … Applicant/Accused

versus

The State of Telangana, through the Station House Officer,
[POLICE STATION]                                       … Respondent

APPLICATION UNDER SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023
FOR GRANT OF ANTICIPATORY BAIL

MOST RESPECTFULLY SHOWETH:

1. That the Applicant is a permanent resident of [ADDRESS] and has been carrying on business at [PLACE OF BUSINESS] for the last [NUMBER] years.

2. That the Applicant apprehends arrest at the hands of the Respondent in connection with Crime No. [FIR NUMBER] of 2026 registered at [POLICE STATION] for offences punishable under Sections 318(4) and 316(2) of the Bharatiya Nyaya Sanhita, 2023.

3. That the allegation is one of cheating simpliciter arising out of a commercial transaction between the Applicant and the complainant, [COMPLAINANT NAME]. The dispute is essentially civil in character and is the subject matter of O.S. No. [SUIT NUMBER] of 2025 pending before [CIVIL COURT].

4. That the Applicant has not been named as an absconder, has cooperated with the investigation, and is ready and willing to abide by every condition this Hon'ble Court may impose.

5. That custodial interrogation is not necessary since the entire case rests on documentary material already in the possession of the investigating agency.

6. That the Applicant undertakes not to tamper with the evidence, not to influence any witness, and to make himself available as and when required.

${pad('the ingredients of the offence alleged', 2_600)}

PRAYER

It is therefore most respectfully prayed that this Hon'ble Court may be pleased to:

(a) grant anticipatory bail to the Applicant in the event of his arrest in connection with Crime No. [FIR NUMBER] of 2026 on the file of [POLICE STATION];
(b) pass such interim directions as may be necessary pending disposal of this application;
(c) pass any other order(s) as this Hon'ble Court may deem fit and proper.

Place: Hyderabad
Date: [DATE]

[ADVOCATE NAME]
Enrolment No. [NUMBER]
Counsel for the Applicant

VERIFICATION

I, [APPLICANT NAME], the Applicant above-named, do hereby verify that the contents of paragraphs 1 to 6 above are true to my personal knowledge and that nothing material has been concealed.

Verified at Hyderabad on this ____ day of ________, 2026.

[APPLICANT NAME]
Deponent
`;

/** The 400-char "draft": correct register, no instrument. */
const DRAFT_TRUNCATED = `IN THE COURT OF THE PRINCIPAL SESSIONS JUDGE AT HYDERABAD

MOST RESPECTFULLY SHOWETH:

1. That the Applicant apprehends arrest under Section 318(4) of the Bharatiya Nyaya Sanhita, 2023.

I will prepare the full application once you confirm the FIR number.
`;

/** Structurally complete but citing the repealed codes as operative. */
const DRAFT_IPC_CITING = DRAFT_GOOD
  .replace(
    'Sections 318(4) and 316(2) of the Bharatiya Nyaya Sanhita, 2023',
    'Sections 420 and 406 of the Indian Penal Code',
  )
  .replace(
    'SECTION 482 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023',
    'SECTION 438 OF THE CODE OF CRIMINAL PROCEDURE, 1973',
  )
  .replace('Section 482 BNSS governs', 'Section 438 CrPC governs');

/** Every placeholder resolved into an invented particular. */
const DRAFT_FABRICATED = DRAFT_GOOD
  .replace(/\[APPLICANT NAME\]/g, 'Rakesh Kumar Sharma')
  .replace(/\[FATHER'S NAME\]/g, 'Mahesh Kumar Sharma')
  .replace(/\[AGE\]/g, '41')
  .replace(/\[ADDRESS\]/g, 'Flat 402, Sai Enclave, Kukatpally, Hyderabad 500072')
  .replace(/\[PLACE OF BUSINESS\]/g, 'Shop 14, Balanagar Industrial Estate')
  .replace(/\[NUMBER\]/g, '11')
  .replace(/\[FIR NUMBER\]/g, '187')
  .replace(/\[POLICE STATION\]/g, 'Kukatpally Police Station')
  .replace(/\[COMPLAINANT NAME\]/g, 'Suresh Reddy')
  .replace(/\[SUIT NUMBER\]/g, '442')
  .replace(/\[CIVIL COURT\]/g, 'the II Additional District Judge, Medchal')
  .replace(/\[ADVOCATE NAME\]/g, 'M. Srinivas Rao')
  .replace(/\[DATE\]/g, '14 August 2026')
  .replace(/____ day of ________/g, '14th day of August');

/**
 * The false-positive guard for `statute_currency`. This answer mentions IPC and
 * CrPC repeatedly — correctly, as the repealed provisions a pre-2024 judgment was
 * decided under. A keyword ban would fail it. It must be GREEN.
 */
const RESEARCH_TRANSITIONAL = `## ISSUE & SHORT ANSWER

The offence was committed in March 2025, so the Bharatiya Nyaya Sanhita, 2023 applies; the corresponding provision of the repealed Indian Penal Code is noted for continuity with the earlier case law.

## APPLICABLE LAW

Cheating is now punishable under Section 318(4) BNS, corresponding to the erstwhile Section 420 of the Indian Penal Code. Criminal breach of trust falls under Section 316(2) BNS, formerly Section 406 IPC. The application for pre-arrest bail lies under Section 482 BNSS, which replaced Section 438 CrPC.

## AUTHORITIES

1. **Sushila Aggarwal versus State (NCT of Delhi)**, (2020) 5 SCC 1 — decided under the now-repealed Section 438 CrPC, and applicable to Section 482 BNSS since the provisions are pari materia.
2. **Gurbaksh Singh Sibbia versus State of Punjab**, AIR 1980 SC 1632.

## ANALYSIS

${pad('the transition from the 1860 code to the 2023 sanhita', 800)}
`;

const STATUTE_COMPARE_GOOD = `### IPC → BNS transition for Section 420

| Repealed provision | Operative provision | Change |
|---|---|---|
| Section 420, Indian Penal Code, 1860 | Section 318(4), Bharatiya Nyaya Sanhita, 2023 | Cheating and dishonestly inducing delivery of property. Punishment retained at up to seven years and fine. |

Change notes: the offence has been renumbered and consolidated. Section 318 BNS now carries a graded structure with sub-section (4) covering what was Section 420 IPC.
`;

const STATUTE_COMPARE_MISSING_MAPPING = `### Transition notes

Section 420 of the Indian Penal Code deals with cheating. The provision continues to be relevant for offences committed before 1 July 2024. Please consult a practitioner for the current numbering.
`;

const TREATMENT_GOOD = JSON.stringify({
  citation: 'Maneka Gandhi versus Union of India',
  authority: { matched: true, title: 'MANEKA GANDHI versus UNION OF INDIA', year: 1978, court: 'Supreme Court of India' },
  goodLaw: { status: 'unknown', coverage: 'partial', confidence: 0.42 },
  content: 'Treatment could not be determined from the available corpus. Coverage is partial; the authority resolved to the 1978 Supreme Court judgment. Reported as unknown rather than assumed to be good law.',
});

const TREATMENT_SILENT = JSON.stringify({
  citation: 'Maneka Gandhi versus Union of India',
  authority: { matched: true, title: 'MANEKA GANDHI versus UNION OF INDIA', year: 1978 },
  content: 'The authority was located in the corpus.',
});

const ANALYSIS_GOOD = `## RISK ANALYSIS — MASTER SERVICES AGREEMENT

**Parties**: Acme Technologies Private Limited (Supplier) and Beta Retail Limited (Customer).

**Governing law**: laws of India; courts at Bengaluru have exclusive jurisdiction.

## OBLIGATIONS

1. The Supplier shall deliver the services in accordance with Schedule 2 within the timelines stated therein.
2. The Customer shall pay each undisputed invoice within thirty days of receipt.
3. Each party shall maintain the confidentiality of the other's proprietary information for five years after termination.

## RISKS

1. **Unlimited indemnity (Clause 11.2)** — the Supplier indemnifies the Customer without any liability cap, which sits inconsistently with the Clause 12 cap on aggregate liability.
2. **Termination for convenience (Clause 14.1)** — the Customer may terminate on thirty days' notice; the Supplier has no reciprocal right.

## DEADLINES

1. Renewal notice: ninety days before the end of the initial term.

${pad('the allocation of risk between the parties', 900)}
`;

const ANALYSIS_MISSING_FIELDS = `This appears to be a commercial agreement between two companies. It contains standard terms including payment provisions and a termination clause. ${pad('the general shape of a services contract', 900)}`;

/* ── the corpus ─────────────────────────────────────────────────── */

export const COUNSEL_GRADE_FIXTURES: readonly CounselGradeFixture[] = [
  /* ---- GREEN controls. A harness that only ever goes red is a broken one. ---- */
  {
    config: RESEARCH_CONFIG,
    body: RESEARCH_WITH_AUTHORITIES,
    envelope: TRUST_GREEN,
    httpStatus: 200,
    expectFailing: [],
    why: 'POSITIVE CONTROL — three locatable authorities and an honest envelope must be fully green.',
  },
  {
    config: DRAFT_CONFIG,
    body: DRAFT_GOOD,
    envelope: { trust: { grounded: true, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true }, citations: { verified: 0, unverified: 0, details: [] } },
    httpStatus: 200,
    expectFailing: [],
    why: 'POSITIVE CONTROL — the 8/8 reference draft. Note `citationsPresent: false` with an '
      + 'uncited draft is HONEST and must not fail envelope_honesty.',
  },
  {
    config: { ...RESEARCH_CONFIG, id: 'fixture-research-transitional', offenceEra: 'post-2024-07-01' },
    body: RESEARCH_TRANSITIONAL,
    envelope: TRUST_GREEN,
    httpStatus: 200,
    expectFailing: [],
    why: 'FALSE-POSITIVE GUARD — cites IPC/CrPC repeatedly but always as the repealed '
      + 'provision alongside the BNS/BNSS successor. statute_currency must stay GREEN, '
      + 'otherwise the check is a naive keyword ban that fails correct answers.',
  },

  /* ---- RED: authority_density + envelope_honesty (the shipped defect) ---- */
  {
    config: { ...RESEARCH_CONFIG, id: 'fixture-research-bracketed-placeholders' },
    body: `## AUTHORITIES

* Platform Evidentiary Notice: The specific Supreme Court reporter citations for the leading economic offence judgments are absent from the currently retrieved knowledge corpus.

* **[[P. Chidambaram v. Directorate of Enforcement]]** — economic offences are a class apart.
* **[[Y.S. Jagan Mohan Reddy v. Central Bureau of Investigation]]**
* **[[Sushila Aggarwal v. State (NCT of Delhi)]]**

**Unverified Citations**: Counsel must independently pull the exact SCC volumes before drafting.

## ANALYSIS

${pad('the discretion in economic-offence bail', 1_600)}
`,
    envelope: TRUST_NO_AUTHORITIES,
    httpStatus: 200,
    expectFailing: ['authority_density', 'envelope_honesty'],
    why: 'REGRESSION GUARD FOR THE HARNESS ITSELF. Captured live on jrx-prod: the platform '
      + 'honestly reported the reporter citations were missing and wrapped the case names in '
      + '`[[ ]]`, its anti-fabrication placeholder marker. An earlier build of the checker '
      + 'counted those as DELIVERED authorities, so this exact answer PASSED authority_density '
      + '— the harness reproducing the very lie it exists to catch. A placeholder is the '
      + 'platform admitting a gap; it must never satisfy the check that measures the gap. '
      + '`envelope_honesty` fires too, correctly: this body carries no statutory reference '
      + 'either, so `citationsPresent: true` is unsupportable on any reading.',
  },
  {
    config: { ...RESEARCH_CONFIG, id: 'fixture-research-confident-uncited' },
    body: RESEARCH_CONFIDENT_UNCITED,
    envelope: TRUST_NO_AUTHORITIES,
    httpStatus: 200,
    expectFailing: ['authority_density'],
    why: 'THE SHIPPED DEFECT, reconstructed: confident prose, zero case authorities, '
      + '`citationsPresent: true`. envelope_honesty passes here only because the body '
      + 'does carry the one statutory reference the envelope counted — which is why the '
      + 'next fixture strips even that.',
  },
  {
    config: { ...RESEARCH_CONFIG, id: 'fixture-envelope-lies-empty-body' },
    body: `${pad('the standard applicable to pre-arrest bail', 2_000)}`,
    envelope: TRUST_NO_AUTHORITIES,
    httpStatus: 200,
    expectFailing: ['authority_density', 'envelope_honesty'],
    why: 'THE HIGHEST-VALUE ASSERTION: 2,000 chars with nothing citable of ANY kind, '
      + 'while the envelope reports citationsPresent=true / authoritiesDelivered=1.',
  },
  {
    config: { ...RESEARCH_CONFIG, id: 'fixture-envelope-self-contradiction' },
    body: RESEARCH_WITH_AUTHORITIES,
    envelope: {
      // The boolean and the object it is supposed to be derived from have drifted.
      trust: { grounded: true, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true },
      citations: { verified: 2, unverified: 1, details: [{ text: '(2020) 5 SCC 1' }, { text: 'AIR 1980 SC 1632' }, { text: '2019 SCC OnLine SC 1549' }] },
    },
    httpStatus: 200,
    expectFailing: ['envelope_honesty'],
    why: 'The inverse lie: a good answer under-reported. `citationsPresent=false` while '
      + "the platform's own countDeliveredAuthorities(citations)=3. Catches the badge "
      + 'and the envelope drifting apart in EITHER direction.',
  },

  /* ---- RED: length_floor ---- */
  {
    config: { ...DRAFT_CONFIG, id: 'fixture-draft-truncated' },
    body: DRAFT_TRUNCATED,
    envelope: { trust: { grounded: false, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true } },
    httpStatus: 200,
    expectFailing: ['length_floor', 'draft_structure'],
    why: 'A 400-char "draft". Fails the length floor AND the structure score — both must '
      + 'fire, because a truncated instrument is short and structurally incomplete.',
  },

  /* ---- RED: statute_currency ---- */
  {
    config: { ...DRAFT_CONFIG, id: 'fixture-draft-ipc-citing' },
    body: DRAFT_IPC_CITING,
    envelope: { trust: { grounded: true, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true } },
    httpStatus: 200,
    expectFailing: ['statute_currency'],
    why: 'Structurally perfect bail application citing Sections 420/406 IPC and 438 CrPC '
      + 'as operative for a 2026 offence, with no transitional framing.',
  },
  {
    config: {
      id: 'fixture-research-no-new-code',
      family: 'legal_research',
      prompt: 'what is the punishment for cheating committed in 2025',
      minChars: 500,
      offenceEra: 'post-2024-07-01',
    },
    body: `Cheating is punishable under Section 420 of the Indian Penal Code with imprisonment of up to seven years. ${pad('the punishment for cheating', 700)}`,
    envelope: { trust: { grounded: true, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true } },
    httpStatus: 200,
    expectFailing: ['statute_currency'],
    why: 'The other statute_currency failure mode: not a single BNS/BNSS/BSA reference in '
      + 'an answer about a post-1-Jul-2024 offence.',
  },

  /* ---- RED: anti_fabrication ---- */
  {
    config: { ...DRAFT_CONFIG, id: 'fixture-draft-fabricated-facts' },
    body: DRAFT_FABRICATED,
    envelope: { trust: { grounded: true, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true } },
    httpStatus: 200,
    expectFailing: ['anti_fabrication'],
    why: 'Every placeholder replaced with an invented name, address, FIR number and suit '
      + 'number. Structurally 7/7 and therefore invisible to a structure-only check.',
  },
  {
    config: {
      id: 'fixture-research-impossible-citation',
      family: 'legal_research',
      prompt: 'authorities on anticipatory bail',
      minChars: 500,
      minCaseAuthorities: 1,
      suppliedAuthorities: ['SUSHILA AGGARWAL & ORS. versus STATE (NCT OF DELHI) — (2020) 5 SCC 1'],
    },
    body: `The leading authority is Sushila Aggarwal versus State (NCT of Delhi), (2020) 5 SCC 1. `
      + `It was recently applied in Narendra Prasad versus State of Bihar, (2031) 4 SCC 88, and in `
      + `Mohan Lal versus State of Rajasthan, (2019) 0 SCC 0. ${pad('the discretion to grant pre-arrest bail', 600)}`,
    envelope: TRUST_GREEN,
    httpStatus: 200,
    expectFailing: ['anti_fabrication'],
    why: 'A future year (2031) and a volume/page of zero — structurally impossible '
      + 'citations, plus two citations absent from the supplied context. Detectable with '
      + 'no corpus and no network.',
  },

  /* ---- RED: deterministic_fidelity ---- */
  {
    config: {
      id: 'fixture-statute-compare-broken',
      family: 'compare/ipc-bns',
      prompt: 'IPC 420 → BNS mapping',
      minChars: 120,
      mustContain: ['318', 'Bharatiya Nyaya Sanhita', '420'],
    },
    body: STATUTE_COMPARE_MISSING_MAPPING,
    envelope: null,
    httpStatus: 200,
    expectFailing: ['deterministic_fidelity'],
    why: 'The deterministic control. IPC 420 → BNS 318(4) is a table lookup, so a missing '
      + 'mapping is unambiguously a platform fault and not model variance. If this ever '
      + 'goes red on the live path, the knowledge plane is broken.',
  },
  {
    config: {
      id: 'fixture-statute-compare-good',
      family: 'compare/ipc-bns',
      prompt: 'IPC 420 → BNS mapping',
      minChars: 120,
      mustContain: ['318', 'Bharatiya Nyaya Sanhita', '420'],
    },
    body: STATUTE_COMPARE_GOOD,
    envelope: null,
    httpStatus: 200,
    expectFailing: [],
    why: 'POSITIVE CONTROL for the deterministic family — and for `envelope_honesty` '
      + 'returning `na` on a route that carries no trust envelope, rather than failing it.',
  },

  /* ---- RED: good_law_signal ---- */
  {
    config: {
      id: 'fixture-treatment-silent',
      family: 'caselaw/treatment',
      prompt: 'is Maneka Gandhi still good law',
      minChars: 60,
      expectTreatmentSignal: true,
    },
    body: TREATMENT_SILENT,
    envelope: JSON.parse(TREATMENT_SILENT),
    httpStatus: 200,
    expectFailing: ['good_law_signal'],
    why: 'The authority resolved but the response says nothing about treatment. Silence is '
      + 'the failure — an explicit `unknown` is a pass.',
  },
  {
    config: {
      id: 'fixture-treatment-honest-unknown',
      family: 'caselaw/treatment',
      prompt: 'is Maneka Gandhi still good law',
      minChars: 60,
      expectTreatmentSignal: true,
    },
    body: TREATMENT_GOOD,
    envelope: JSON.parse(TREATMENT_GOOD),
    httpStatus: 200,
    expectFailing: [],
    why: 'POSITIVE CONTROL — `goodLaw: { status: "unknown" }` is honest and must PASS. '
      + 'A check that demanded a definite answer would push the platform toward '
      + 'confident guessing, which is the opposite of counsel-grade.',
  },

  /* ---- RED: structured_fields ---- */
  {
    config: {
      id: 'fixture-analyze-missing-fields',
      family: 'analyzeDocument',
      prompt: 'analyse this MSA',
      minChars: 800,
      requiredFields: ['parties', 'governingLaw', 'obligations', 'risks', 'deadlines'],
    },
    body: ANALYSIS_MISSING_FIELDS,
    envelope: { trust: { grounded: true, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true }, fields: {} },
    httpStatus: 200,
    expectFailing: ['structured_fields'],
    why: 'Plausible prose with none of the extraction fields a counsel needs. Fails on '
      + 'fields, not on length — a summariser masquerading as an analyser.',
  },
  {
    config: {
      id: 'fixture-analyze-good',
      family: 'analyzeDocument',
      prompt: 'analyse this MSA',
      minChars: 800,
      requiredFields: ['parties', 'governingLaw', 'obligations', 'risks', 'deadlines'],
    },
    body: ANALYSIS_GOOD,
    envelope: {
      trust: { grounded: true, citationsPresent: false, authoritiesDelivered: 0, qualityOk: true, compliancePassed: true },
      fields: {
        parties: ['Acme Technologies Private Limited', 'Beta Retail Limited'],
        governingLaw: 'India (Bengaluru courts)',
        obligations: ['delivery per Schedule 2', 'payment within 30 days', 'confidentiality for 5 years'],
        risks: ['uncapped indemnity in Clause 11.2', 'one-sided termination for convenience'],
        deadlines: ['renewal notice 90 days before end of initial term'],
      },
    },
    httpStatus: 200,
    expectFailing: [],
    why: 'POSITIVE CONTROL for structured extraction.',
  },

  /* ---- BLOCKED, not FAILED: the outage lesson ---- */
  {
    config: { ...RESEARCH_CONFIG, id: 'fixture-transport-timeout' },
    body: '',
    envelope: null,
    transportError: 'The operation was aborted due to timeout',
    expectFailing: [],
    expectBlocked: [
      'transport', 'length_floor', 'authority_density', 'envelope_honesty', 'draft_structure',
      'statute_currency', 'anti_fabrication', 'deterministic_fidelity', 'good_law_signal',
      'structured_fields',
    ],
    why: 'A 51-minute outage must NOT read as a quality regression. Every assertion is '
      + '`blocked`, zero are `fail`. This is the single most important negative control '
      + 'in the file: a board that goes red when the network drops gets muted.',
  },
  {
    config: { ...RESEARCH_CONFIG, id: 'fixture-transport-502' },
    body: '<html><head><title>502 Bad Gateway</title></head></html>',
    envelope: null,
    httpStatus: 502,
    expectFailing: [],
    expectBlocked: [
      'transport', 'length_floor', 'authority_density', 'envelope_honesty', 'draft_structure',
      'statute_currency', 'anti_fabrication', 'deterministic_fidelity', 'good_law_signal',
      'structured_fields',
    ],
    why: 'The nginx-hop failure that a port-5000 health probe missed. A 2 ms HTML body is '
      + 'an instrument failure, never a quality measurement.',
  },
];
