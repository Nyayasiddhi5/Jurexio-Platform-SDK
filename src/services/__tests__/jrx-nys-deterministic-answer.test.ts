/**
 * Unit tests — NV-NYS-LLMREQUIRED-001 deterministic answer tier.
 *
 * The scope tests are the important half. NV-STATUTE-FAQ-SCOPE-001 shipped a
 * 732-char statute excerpt in place of a multi-issue litigation answer because a
 * naive length+section-parse test passed. `llmRequired: false` is an even weaker
 * signal on its own — NYS flags generation only from its own verb list — so
 * every prompt below that a model must answer is asserted to be DECLINED even
 * though NYS says no LLM is needed.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  couldBeDeterministic,
  isDeterministicallySufficient,
  renderDeterministicAnswerFromPlan,
  type NysDeterministicPlan,
} from '../jrx-nys-deterministic-answer.js';

const statutePlan = (overrides: Partial<NysDeterministicPlan> = {}): NysDeterministicPlan => ({
  query: 'What does BNS 103 say?',
  intent: 'statute',
  llmRequired: false,
  reason: 'Resolved BNS 103 from the local statutes corpus without an LLM.',
  steps: [
    {
      tool: 'statute-lookup',
      statutes: [
        {
          code: 'BNS',
          section: '103',
          heading: 'Punishment for murder',
          text: 'Whoever commits murder shall be punished with death or imprisonment for life…',
          actName: 'Bharatiya Nyaya Sanhita, 2023',
          jurisdiction: 'IN',
        },
      ],
    },
  ],
  ...overrides,
});

beforeEach(() => {
  delete process.env.NYV_NYS_DETERMINISTIC_ANSWER;
  delete process.env.NYV_NYS_DETERMINISTIC_MAX_CHARS;
});

describe('isDeterministicallySufficient — scope gate', () => {
  it('accepts a bare single-section lookup', () => {
    const v = isDeterministicallySufficient('What does BNS 103 say?', 'statute');
    expect(v.sufficient).toBe(true);
    expect(v.reason).toBe('closed_form:statute');
  });

  it('accepts old→new mapping intents', () => {
    expect(isDeterministicallySufficient('What replaced IPC 302?', 'ipc-bns-compare').sufficient).toBe(true);
    expect(isDeterministicallySufficient('Which BNSS replaced CrPC 438?', 'old-new-compare').sufficient).toBe(true);
    expect(isDeterministicallySufficient('BNSS 482 was which CrPC section?', 'new-old-compare').sufficient).toBe(true);
  });

  it('accepts a citation resolution ask', () => {
    expect(isDeterministicallySufficient('Does (2024) 1 SCC 1 exist?', 'citation').sufficient).toBe(true);
  });

  // ── NV-STATUTE-FAQ-SCOPE-001 regressions ────────────────────────────────
  it('DECLINES the measured 208-char multi-jurisdiction strategy prompt', () => {
    const prompt =
      'Advise on the optimal approach for securing anticipatory bail under BNSS 482 for a client ' +
      'facing PMLA attachment exposure and parallel SEBI proceedings, including sequencing and ' +
      'limitation risk across both forums.';
    expect(prompt.length).toBeGreaterThan(200);
    const v = isDeterministicallySufficient(prompt, 'statute');
    expect(v.sufficient).toBe(false);
  });

  it('DECLINES a strategy prompt even with no excluded verb and one section', () => {
    const v = isDeterministicallySufficient(
      'Best strategy for bail under BNSS 482 given attachment exposure?',
      'statute',
    );
    expect(v.sufficient).toBe(false);
    expect(v.reason).toBe('reasoning_beyond_stored_text');
  });

  it('DECLINES when a non-core instrument is in scope', () => {
    const v = isDeterministicallySufficient('BNS 318 and the PMLA — which applies?', 'statute');
    expect(v.sufficient).toBe(false);
    expect(v.reason).toBe('reasoning_beyond_stored_text');
  });

  it('DECLINES when generation is requested', () => {
    for (const q of [
      'Draft a bail application under BNSS 482',
      'Summarise BNS 103 for my client',
      'Compare BNS 103 and IPC 302',
      'Recommend a course of action under BNS 103',
    ]) {
      expect(isDeterministicallySufficient(q, 'statute').sufficient).toBe(false);
    }
  });

  it('DECLINES case-search — a ranked authority list is grounding, not an answer', () => {
    const v = isDeterministicallySufficient(
      'Leading SC authorities on anticipatory bail in economic offences',
      'case-search',
    );
    expect(v.sufficient).toBe(false);
    expect(v.reason).toContain('intent_not_closed_form');
  });

  it('DECLINES a statute intent with no exact section (NYS hybrid top-k branch)', () => {
    const v = isDeterministicallySufficient('bail provisions in the BNSS', 'statute');
    expect(v.sufficient).toBe(false);
    expect(v.reason).toBe('statute_intent_without_exact_section');
  });

  it('DECLINES anything longer than a lookup', () => {
    const long = `What does BNS 103 say? ${'x'.repeat(400)}`;
    expect(isDeterministicallySufficient(long, 'statute').sufficient).toBe(false);
  });
});

describe('couldBeDeterministic — zero-cost pre-filter', () => {
  it('admits section and citation anchored lookups', () => {
    expect(couldBeDeterministic('What does BNS 103 say?')).toBe(true);
    expect(couldBeDeterministic('What replaced IPC 302?')).toBe(true);
    expect(couldBeDeterministic('Is (2024) 1 SCC 1 a real citation?')).toBe(true);
    expect(couldBeDeterministic('Verify AIR 2020 SC 15')).toBe(true);
  });

  it('rejects prompts with no section or citation anchor, so no probe is spent', () => {
    expect(couldBeDeterministic('What are the ingredients of criminal conspiracy?')).toBe(false);
    expect(couldBeDeterministic('How do I approach a cheque bounce matter?')).toBe(false);
    expect(couldBeDeterministic('')).toBe(false);
  });

  it('rejects generative and strategy prompts that do name a section', () => {
    expect(couldBeDeterministic('Draft an application under BNSS 482')).toBe(false);
    expect(couldBeDeterministic('Litigation strategy for BNSS 482 bail')).toBe(false);
  });
});

describe('renderDeterministicAnswerFromPlan', () => {
  it('renders a grounded, citation-carrying statute answer at zero tokens', () => {
    const a = renderDeterministicAnswerFromPlan(statutePlan(), { jurisdiction: 'IN' });
    expect(a).not.toBeNull();
    expect(a!.resolver).toBe('nys-statute-section');
    expect(a!.intent).toBe('statute');
    // A real answer, not a placeholder: title, text and provenance all present.
    expect(a!.content).toContain('Punishment for murder');
    expect(a!.content).toContain('Whoever commits murder');
    expect(a!.content.length).toBeGreaterThan(200);
    expect(a!.citations).toEqual([
      { kind: 'statute', ref: 'BNS §103', title: 'Punishment for murder' },
    ]);
    expect(a!.nysReason).toContain('without an LLM');
  });

  it('refuses when NYS itself says a model is needed', () => {
    expect(renderDeterministicAnswerFromPlan(statutePlan({ llmRequired: true }))).toBeNull();
    expect(renderDeterministicAnswerFromPlan(statutePlan({ llmRequired: undefined }))).toBeNull();
  });

  it('refuses when the local scope gate disagrees with llmRequired:false', () => {
    const plan = statutePlan({
      query: 'Strategy for BNSS 482 bail with PMLA attachment exposure and SEBI proceedings',
    });
    expect(renderDeterministicAnswerFromPlan(plan)).toBeNull();
  });

  it('refuses a plan whose statute row has no text — never a hollow excerpt', () => {
    const plan = statutePlan({
      steps: [{ tool: 'statute-lookup', statutes: [{ code: 'BNS', section: '103', heading: 'Punishment for murder' }] }],
    });
    expect(renderDeterministicAnswerFromPlan(plan)).toBeNull();
  });

  it('refuses an empty plan rather than emitting a stub', () => {
    expect(renderDeterministicAnswerFromPlan(statutePlan({ steps: [] }))).toBeNull();
    expect(renderDeterministicAnswerFromPlan(null)).toBeNull();
  });

  it('honours the NYV_NYS_DETERMINISTIC_ANSWER=0 escape hatch', () => {
    process.env.NYV_NYS_DETERMINISTIC_ANSWER = '0';
    expect(renderDeterministicAnswerFromPlan(statutePlan())).toBeNull();
  });

  it('renders an IPC→BNS mapping with both provisions and change notes', () => {
    const a = renderDeterministicAnswerFromPlan({
      query: 'What replaced IPC 302?',
      intent: 'ipc-bns-compare',
      llmRequired: false,
      steps: [
        {
          tool: 'ipc-bns-compare',
          comparison: {
            ipcSection: '302',
            found: true,
            ipc: { code: 'IPC', section: '302', heading: 'Punishment for murder', text: 'Whoever commits murder…' },
            bnsMatches: [
              { code: 'BNS', section: '103', heading: 'Punishment for murder', text: 'Whoever commits murder…' },
            ],
            changeNotes: 'Renumbered; sub-section (2) added for mob lynching.',
          },
        },
      ],
    });
    expect(a).not.toBeNull();
    expect(a!.resolver).toBe('nys-code-compare');
    expect(a!.content).toContain('IPC §302 → BNS §103');
    expect(a!.content).toContain('mob lynching');
    expect(a!.citations.map((c) => c.ref)).toContain('BNS §103');
  });

  it('states the reverse mapping direction correctly (new code re-enacts old)', () => {
    const a = renderDeterministicAnswerFromPlan({
      query: 'BNSS 482 was which CrPC section?',
      intent: 'new-old-compare',
      llmRequired: false,
      steps: [
        {
          tool: 'new-old-compare',
          newOld: {
            newCode: 'BNSS',
            oldCode: 'CrPC',
            newSection: '482',
            found: true,
            statute: { code: 'BNSS', section: '482', heading: 'Direction for grant of bail', text: 'Where any person…' },
            oldSections: ['438'],
            matches: [],
          },
        },
      ],
    });
    expect(a).not.toBeNull();
    expect(a!.content).toContain('re-enacts');
    expect(a!.content).toContain('CrPC 438');
    // Must NOT read as though the in-force code was the one replaced.
    expect(a!.content).not.toMatch(/BNSS 482.*is replaced by/);
  });

  it('reports an unverified citation honestly and does not cite it', () => {
    const a = renderDeterministicAnswerFromPlan({
      query: 'Is (2024) 1 SCC 999 a real citation?',
      intent: 'citation',
      llmRequired: false,
      steps: [
        { tool: 'citation-lookup', citations: [{ raw: '(2024) 1 SCC 999', matches: [] }], matches: [] },
      ],
    });
    expect(a).not.toBeNull();
    expect(a!.content).toContain('not found');
    expect(a!.citations).toEqual([]);
  });

  it('verifies a resolvable citation with court, year and CNR', () => {
    const a = renderDeterministicAnswerFromPlan({
      query: 'Verify (2024) 1 SCC 1',
      intent: 'citation',
      llmRequired: false,
      steps: [
        {
          tool: 'citation-lookup',
          citations: [
            {
              raw: '(2024) 1 SCC 1',
              matches: [
                {
                  title: 'State v Example',
                  citation: '(2024) 1 SCC 1',
                  court: 'Supreme Court of India',
                  year: 2024,
                  cnr: 'SCIN010012342024000001',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(a).not.toBeNull();
    expect(a!.resolver).toBe('nys-citation-resolve');
    expect(a!.content).toContain('verified');
    expect(a!.content).toContain('Supreme Court of India');
    expect(a!.citations[0]).toMatchObject({ kind: 'case', ref: '(2024) 1 SCC 1', year: 2024 });
  });
});
