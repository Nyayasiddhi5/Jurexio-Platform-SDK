/**
 * NV-QUEEN-EARNED-001 — routing table + admission gate unit tests.
 *
 * Pins the path decision for a table of representative requests, asserts the
 * deterministic/cache tier is consulted BEFORE any agent spawn, and proves the
 * ambiguity band escalates rather than downgrades.
 *
 * The threshold discipline test is the important one: NV-RAG-CONF-001 and
 * NV-MEM-DECAY-001 both shipped a predicate that could never fire, and both
 * passed every test that only exercised one side of it. Every threshold assertion
 * here is therefore two-sided — the same shape of request must be shown both
 * crossing and failing to cross.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessQueenAdmission,
  collectQueenAdmissionEvidence,
  QUEEN_ADMIT_SCORE,
  QUEEN_AMBIGUITY_BAND,
  isQueenEarnedGateEnabled,
} from '../../src/orchestration/jrx-queen-admission.js';
import { decideAdaptivePath } from '../../src/orchestration/jrx-adaptive-router.js';
import { couldBeDeterministic } from '../../src/services/jrx-nys-deterministic-answer.js';

const SRC = join(process.cwd(), 'src');

/**
 * The ecosystem default: every JRX-dependent platform and every authenticated
 * SDK partner except JRX resolves `forceLegalBestOutcome: true` +
 * `nyvDependent: true` (`wantsNspNymBestOutcome`, default ON). This is the shape
 * that made Queen the default, so the routing table is asserted under it.
 */
const ecosystem = (over: Record<string, unknown>) =>
  decideAdaptivePath({
    nyvDependent: true,
    forceLegalBestOutcome: true,
    risk: 'medium',
    ...over,
  } as Parameters<typeof decideAdaptivePath>[0]);

describe('NV-QUEEN-EARNED-001 — routing table under the ecosystem default', () => {
  it('statute lookup → specialist (was Queen)', () => {
    const d = ecosystem({
      prompt: 'What does BNS 103 say?',
      taskType: 'legal-chat',
      complexity: 'simple',
    });
    expect(d.path).toBe('specialist');
    expect(d.queenAdmission?.admit).toBe(false);
    expect(d.queenAdmission?.reason).toBe('deny:store_can_answer');
  });

  it('IPC→BNS mapping → specialist, and is flagged as a store hit', () => {
    const d = ecosystem({
      prompt: 'What BNS section replaced IPC 302?',
      taskType: 'legal-chat',
      complexity: 'simple',
    });
    expect(d.path).toBe('specialist');
    expect(d.queenAdmission?.evidence.mappingQuestion).toBe(true);
    expect(d.queenAdmission?.reason).toBe('deny:store_can_answer');
  });

  it('definitional question → specialist', () => {
    const d = ecosystem({
      prompt: 'What is culpable homicide not amounting to murder?',
      taskType: 'legal-chat',
      complexity: 'moderate',
    });
    expect(d.path).toBe('specialist');
    expect(d.queenAdmission?.evidence.definitional).toBe(true);
  });

  it('single-issue advice → specialist, not the swarm', () => {
    const d = ecosystem({
      prompt: 'Is anticipatory bail available under BNSS 482?',
      taskType: 'legal-chat',
      complexity: 'moderate',
    });
    expect(d.path).toBe('specialist');
    expect(d.queenAdmission?.admit).toBe(false);
  });

  it('multi-issue strategy → queen', () => {
    const d = ecosystem({
      prompt:
        'Advise on the optimal approach for anticipatory bail under BNSS 482 given PMLA '
        + 'attachment exposure and parallel SEBI proceedings, and the limitation position.',
      taskType: 'legal-chat',
      complexity: 'complex',
    });
    expect(d.path).toBe('queen');
    expect(d.queenAdmission?.admit).toBe(true);
    expect(d.queenAdmission?.escalatedForAmbiguity).toBe(false);
    expect(d.queenAdmission?.signals.join(' ')).toMatch(/multi_instrument\+4/);
  });

  it('multi-jurisdiction conflicting authority → queen', () => {
    const d = ecosystem({
      prompt:
        'The Delhi High Court and the Bombay High Court have taken conflicting views on '
        + 'whether Section 34 applies here. Which line of authority governs, and does '
        + 'the Supreme Court position resolve the split?',
      taskType: 'legal-chat',
      complexity: 'moderate',
    });
    expect(d.path).toBe('queen');
    expect(d.queenAdmission?.evidence.conflictingAuthority).toBe(true);
    expect(d.queenAdmission?.evidence.multiJurisdiction).toBe(true);
  });

  it('drafting → queen (filing-grade output earns the premium synthesis leg)', () => {
    const d = ecosystem({
      prompt: 'Draft an anticipatory bail application under BNSS 482 for my client.',
      taskType: 'document-drafting',
      complexity: 'moderate',
    });
    expect(d.path).toBe('queen');
    expect(d.queenAdmission?.evidence.filingGrade).toBe(true);
  });

  it('a downgrade denies fan-out without denying depth', () => {
    const d = ecosystem({
      prompt: 'Is anticipatory bail available under BNSS 482 in these circumstances?',
      taskType: 'legal-chat',
      complexity: 'simple',
    });
    expect(d.path).toBe('specialist');
    expect(d.requireQueenDepth).toBe(false);
    /* Cost decision only. Note `complexity: 'simple'` — the quality gates are
     * retained even then, because that label is `analyzePrompt`'s word count and
     * is exactly the signal the gate stopped trusting. */
    expect(d.requireCoT).toBe(true);
    expect(d.requireMakerChecker).toBe(true);
  });

  it('OCR stays doc-pipeline and never reaches the gate', () => {
    const d = ecosystem({
      prompt: 'Run OCR on this scanned petition PDF',
      taskType: 'ocr',
      complexity: 'simple',
    });
    expect(d.path).toBe('doc-pipeline');
    expect(d.queenAdmission).toBeUndefined();
  });
});

describe('contracts the gate must not touch', () => {
  it('partnerSyncLean still wins outright', () => {
    const d = decideAdaptivePath({
      prompt: 'Multi-jurisdictional litigation strategy with conflicting Supreme Court authority',
      taskType: 'research',
      complexity: 'very_complex',
      risk: 'high',
      partnerLean: true,
      explicitAgentKey: 'legal-researcher',
    });
    expect(d.path).toBe('specialist');
    expect(d.queenAdmission).toBeUndefined();
  });

  it('an explicit caller orchestrationMode force is a contract, not a heuristic', () => {
    const d = decideAdaptivePath({
      prompt: 'What does BNS 103 say?',
      complexity: 'simple',
      risk: 'low',
      engageQueenForced: true,
    });
    expect(d.path).toBe('queen');
    expect(d.queenAdmission).toBeUndefined();
  });

  it('critical risk admits on its own term — nothing else needs to fire', () => {
    const v = assessQueenAdmission({
      prompt: 'Advise on the bail position for my client.',
      taskType: 'legal-chat',
      complexity: 'simple',
      risk: 'critical',
    });
    expect(v.admit).toBe(true);
    expect(v.escalatedForAmbiguity).toBe(false);
    expect(v.signals.join(' ')).toMatch(/risk_critical/);
    const d = ecosystem({
      prompt: 'Advise on the bail position for my client.',
      taskType: 'legal-chat',
      complexity: 'simple',
      risk: 'critical',
    });
    expect(d.path).toBe('queen');
  });

  it('…but a bare statute lookup tagged critical is still closed by the store', () => {
    /* `classifyRiskLevel` reads the *agent key*, not the request — every `bail`
     * agent yields 'critical'. Serving BNS 103's verbatim text with citations is
     * not a shallow answer, so the store still wins. Anything that asks for
     * reasoning under the same risk keeps the swarm (asserted above). */
    const v = assessQueenAdmission({
      prompt: 'What does BNS 103 say?',
      taskType: 'legal-chat',
      complexity: 'simple',
      risk: 'critical',
    });
    expect(v.evidence.deterministicCandidate).toBe(true);
    expect(v.admit).toBe(false);
    expect(v.reason).toBe('deny:store_can_answer');
  });
});

describe('ambiguity resolves toward MORE capability', () => {
  /**
   * The asymmetry that governs the design: a misrouted complex legal question
   * that gets a shallow answer is far worse than an over-provisioned cheap one.
   * Cost is recoverable; a wrong legal answer is not.
   */
  it('an inconclusive legal request escalates rather than downgrades', () => {
    const input = {
      prompt:
        'My client received a notice about the sale deed and there is a dispute with the '
        + 'builder about possession; the society is also involved and I need to work out '
        + 'where we stand before the next hearing.',
      taskType: 'legal-chat',
      complexity: 'moderate' as const,
      risk: 'medium' as const,
      bestOutcome: true,
    };
    const v = assessQueenAdmission(input);
    expect(v.admit).toBe(true);
    expect(v.escalatedForAmbiguity).toBe(true);
    expect(v.reason).toBe('admit:ambiguity_escalation');
    // Escalation only happens inside the band — never from an arbitrarily low score.
    expect(v.score).toBeLessThan(QUEEN_ADMIT_SCORE);
    expect(v.score).toBeGreaterThanOrEqual(QUEEN_ADMIT_SCORE - QUEEN_AMBIGUITY_BAND);
  });

  it('but a store hit inside the band is NOT escalated — that is a known cheap win', () => {
    const v = assessQueenAdmission({
      prompt: 'What does BNS 103 say?',
      taskType: 'legal-chat',
      complexity: 'complex',
      risk: 'medium',
      bestOutcome: true,
      requiresMultipleAgents: true,
    });
    expect(v.evidence.deterministicCandidate).toBe(true);
    expect(v.admit).toBe(false);
    expect(v.reason).toBe('deny:store_can_answer');
  });

  it('escalation still applies when the caller declared no preference at all', () => {
    const v = assessQueenAdmission({
      prompt:
        'My client received a notice and there is a parallel proceeding running; I need to '
        + 'understand the exposure before advising on the next step in this matter.',
      complexity: 'moderate',
      risk: 'medium',
    });
    expect(v.evidence.liveMatterContext).toBe(true);
    expect(v.admit).toBe(true);
    expect(v.escalatedForAmbiguity).toBe(true);
  });
});

describe('threshold is two-sided (NV-GUARDRAIL-UNREACHABLE-THRESHOLD-001)', () => {
  /**
   * A clamp-then-compare tautology (`Math.max(FLOOR, x) >= FLOOR`) has shipped
   * three times in this codebase. These assertions exist so a threshold that can
   * only ever pass — or only ever fail — is a red test rather than a silent
   * always-one-branch defect.
   */
  it('the same prompt family both crosses and fails to cross', () => {
    const cheap = assessQueenAdmission({
      prompt: 'What does BNS 103 say?',
      complexity: 'simple',
      risk: 'low',
    });
    const rich = assessQueenAdmission({
      prompt:
        'Draft a writ petition covering the BNSS 482 relief, the PMLA attachment, and the '
        + 'conflicting Delhi High Court and Bombay High Court authority on maintainability.',
      complexity: 'very_complex',
      risk: 'high',
    });
    expect(cheap.score).toBeLessThan(QUEEN_ADMIT_SCORE);
    expect(cheap.admit).toBe(false);
    expect(rich.score).toBeGreaterThanOrEqual(QUEEN_ADMIT_SCORE);
    expect(rich.admit).toBe(true);
  });

  it('the score is unbounded on both sides — never clamped to the threshold', () => {
    const veryLow = assessQueenAdmission({
      prompt: 'What replaced IPC 302?',
      complexity: 'simple',
      risk: 'low',
    });
    const veryHigh = assessQueenAdmission({
      prompt:
        'Draft the plaint and the interim application covering BNS 318, BNSS 482, the PMLA '
        + 'attachment and the SEBI proceedings; the Delhi High Court and the Bombay High '
        + 'Court have conflicting views, and I also need the limitation strategy. '
        + 'Additionally advise on forum. '.repeat(4),
      complexity: 'very_complex',
      risk: 'high',
      bestOutcome: true,
      requiresMultipleAgents: true,
    });
    expect(veryLow.score).toBeLessThan(0);
    expect(veryHigh.score).toBeGreaterThan(QUEEN_ADMIT_SCORE);
    expect(veryLow.score).not.toBe(veryHigh.score);
  });

  it('every routing-table row is decided strictly by the threshold', () => {
    const rows: Array<{ prompt: string; complexity: 'simple' | 'moderate' | 'complex' }> = [
      { prompt: 'What does BNS 103 say?', complexity: 'simple' },
      { prompt: 'What BNS section replaced IPC 302?', complexity: 'simple' },
      { prompt: 'Is anticipatory bail available under BNSS 482?', complexity: 'moderate' },
      { prompt: 'Draft an anticipatory bail application under BNSS 482.', complexity: 'moderate' },
      {
        prompt: 'BNSS 482 bail with PMLA attachment and SEBI proceedings — strategy?',
        complexity: 'complex',
      },
    ];
    let admitted = 0;
    let denied = 0;
    for (const row of rows) {
      const v = assessQueenAdmission({ ...row, risk: 'medium', bestOutcome: true });
      const storeCanAnswer = v.evidence.deterministicCandidate || v.evidence.mappingQuestion;
      const band = storeCanAnswer ? 0 : QUEEN_AMBIGUITY_BAND;
      // The verdict is exactly the threshold comparison — no hidden short circuit.
      expect(v.admit, `${row.prompt} → ${v.reason} score=${v.score}`)
        .toBe(v.score >= QUEEN_ADMIT_SCORE - band);
      expect(v.escalatedForAmbiguity).toBe(v.admit && v.score < QUEEN_ADMIT_SCORE);
      if (v.admit) admitted++;
      else denied++;
    }
    // Both outcomes are reachable across the real traffic mix — the gate is a
    // decision, not a constant.
    expect(admitted).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(0);
  });
});

describe('tools before agents — ordering, not just availability', () => {
  it('every request the deterministic tier can close is denied Queen', () => {
    // `couldBeDeterministic` is the tier's own zero-cost pre-filter. If the gate
    // ever admits something the tier would have answered, we spawn agents for a
    // request a store had already closed.
    const storeAnswerable = [
      'What does BNS 103 say?',
      'What is BNS 103?',
      'What BNS section replaced IPC 302?',
      'Which BNSS replaced CrPC 438?',
      'Is (2024) 1 SCC 1 a real citation?',
      'Verify AIR 2020 SC 15',
    ];
    for (const prompt of storeAnswerable) {
      expect(couldBeDeterministic(prompt), prompt).toBe(true);
      const v = assessQueenAdmission({
        prompt,
        complexity: 'complex',
        risk: 'medium',
        bestOutcome: true,
        requiresMultipleAgents: true,
      });
      expect(v.admit, `${prompt} must not reach the swarm`).toBe(false);
      expect(v.reason).toBe('deny:store_can_answer');
    }
  });

  it('the gate agrees with the tier on what a store CANNOT answer', () => {
    // The converse direction matters just as much: if the gate thought a store
    // could answer a strategy prompt, it would deny Queen and the tier would then
    // decline, leaving the hardest requests on the thinnest path.
    const notStoreAnswerable = [
      'Draft an application under BNSS 482',
      'Litigation strategy for BNSS 482 bail',
      'Is anticipatory bail available for BNS 318(4) cheating?',
      'BNS 318 with PMLA attachment exposure',
    ];
    for (const prompt of notStoreAnswerable) {
      expect(couldBeDeterministic(prompt), prompt).toBe(false);
      const ev = collectQueenAdmissionEvidence({
        prompt,
        complexity: 'moderate',
        risk: 'medium',
      });
      expect(ev.deterministicCandidate, prompt).toBe(false);
    }
  });

  it('the orchestrate route probes the deterministic tier before dispatching Queen', () => {
    /* Source-level ordering assertion. The pre-Queen probe lives in the route
     * because the Queen orchestrator consumes only `autoRag.contextBlock` and
     * discards the deterministic verdict — so the resolver was live on the
     * specialist path only (NV-WIRING-001: exported != live). A behavioural test
     * would need a live NYS; the ordering itself is what must not regress. */
    const src = readFileSync(join(SRC, 'routes/jrx-orchestration-routes.ts'), 'utf8');
    const probeAt = src.indexOf('tryNysDeterministicAnswer');
    const dispatchAt = src.indexOf('queenOrchestrator.orchestrate(queenRequest)');
    expect(probeAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(probeAt).toBeLessThan(dispatchAt);
    // …and it must be gated on the pure pre-filter so a miss costs no round trip.
    expect(src).toContain('couldBeDeterministic');
    // …and it must clear engageQueen, not merely log.
    expect(src).toMatch(/deterministic tier answered pre-Queen/);
  });

  it('the specialist path returns the deterministic answer before any completion', () => {
    const src = readFileSync(join(SRC, 'services/jrx-client.ts'), 'utf8');
    const detAt = src.indexOf('const deterministicAnswer = autoRag?.deterministic?.answer');
    const abstainAt = src.indexOf('// NV-RAG-ABSTAIN-001');
    expect(detAt).toBeGreaterThan(-1);
    expect(abstainAt).toBeGreaterThan(-1);
    // Ahead of the abstain gate: a resolved answer beats asking the user to rephrase.
    expect(detAt).toBeLessThan(abstainAt);
  });

  it('the learned EMA layer cannot flip a store-answerable request into Queen', () => {
    const src = readFileSync(join(SRC, 'services/jrx-adaptive-path-ema.ts'), 'utf8');
    expect(src).toContain('adaptive_path_ema_flip_suppressed');
    expect(src).toContain('deterministicCandidate');
  });
});

describe('escape hatch', () => {
  it('JRX_QUEEN_EARNED=0 restores every heuristic admission', () => {
    const prev = process.env.JRX_QUEEN_EARNED;
    process.env.JRX_QUEEN_EARNED = '0';
    try {
      expect(isQueenEarnedGateEnabled()).toBe(false);
      const d = ecosystem({
        prompt: 'What does BNS 103 say?',
        taskType: 'legal-chat',
        complexity: 'simple',
      });
      expect(d.path).toBe('queen');
      // The evidence is still computed and attached, so the log shows what the
      // gate WOULD have decided while disabled.
      expect(d.queenAdmission?.admit).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.JRX_QUEEN_EARNED;
      else process.env.JRX_QUEEN_EARNED = prev;
    }
  });

  it('is ON by default', () => {
    expect(isQueenEarnedGateEnabled()).toBe(true);
  });
});
