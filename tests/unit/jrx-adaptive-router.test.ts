/**
 * AdaptiveRouter + QualityEnvelope + response contract unit tests.
 */
import { describe, it, expect } from 'vitest';
import {
  decideAdaptivePath,
  detectLanguageHint,
} from '../../src/orchestration/jrx-adaptive-router.js';
import {
  createQualityEnvelope,
  markIngressGates,
  markSafetyRingGates,
  markResponseAndAudit,
  assertQualityEnvelope,
  QualityEnvelopeError,
  MANDATORY_QUALITY_STEPS,
} from '../../src/orchestration/jrx-quality-envelope.js';
import { buildUnifiedOrchestrationContract, buildCuratedOutcome } from '../../src/orchestration/jrx-orchestration-response-contract.js';
import { getDeclaredCapabilitiesForIntent } from '../../src/orchestration/capability-manifest.js';

describe('./jrx-adaptive-router', () => {
  it('partnerLean always routes specialist', () => {
    const d = decideAdaptivePath({
      prompt: 'Research complex multi-jurisdictional litigation strategy for SC appeal',
      taskType: 'research',
      complexity: 'very_complex',
      risk: 'high',
      partnerLean: true,
      nyvDependent: true,
      explicitAgentKey: 'legal-researcher',
    });
    expect(d.path).toBe('specialist');
    expect(d.requireQueenDepth).toBe(false);
  });

  it('OCR / parse / embed → doc-pipeline', () => {
    expect(decideAdaptivePath({
      prompt: 'Run OCR on this scanned petition PDF',
      taskType: 'ocr',
      complexity: 'simple',
      risk: 'low',
    }).path).toBe('doc-pipeline');

    expect(decideAdaptivePath({
      prompt: 'Parse this contract into clauses',
      taskType: 'parse',
      complexity: 'moderate',
    }).docTask).toBe('parse');

    expect(decideAdaptivePath({
      prompt: 'Embed these chunks for RAG',
      taskType: 'embed',
      complexity: 'simple',
    }).primaryCapabilityIds).toContain('docs.embed');
  });

  it('complex research → queen', () => {
    const d = decideAdaptivePath({
      prompt: 'Provide a detailed research opinion on Section 138 NI Act litigation strategy with precedents',
      taskType: 'research',
      complexity: 'complex',
      risk: 'medium',
      nyvDependent: true,
    });
    expect(d.path).toBe('queen');
    expect(d.requireCoT).toBe(true);
  });

  it('simple greeting → specialist (not forced Queen)', () => {
    const d = decideAdaptivePath({
      prompt: 'Hello',
      taskType: 'chat',
      complexity: 'simple',
      risk: 'low',
      nyvDependent: true,
    });
    expect(d.path).toBe('specialist');
  });

  /**
   * NV-QUEEN-EARNED-001 (2026-08-16): this case previously asserted `queen`.
   * `forceLegalBestOutcome` is true for every NYV-dependent platform and every
   * authenticated SDK partner except JRX, so admitting on it alone made Queen the
   * *default* for all ecosystem legal traffic — the behaviour the optimization
   * plan §10.2 rule 2 forbids. A single-issue "what are my rights" question is
   * now a specialist request; the preference survives as a +2 score term and as
   * CoT + maker-checker on the specialist path, so depth is kept without fan-out.
   */
  it('NSP/NYM best-outcome no longer defaults a single-issue legal prompt to Queen', () => {
    const d = decideAdaptivePath({
      prompt: 'What are my rights under a rental dispute in Delhi?',
      taskType: 'chat',
      complexity: 'simple',
      risk: 'low',
      nyvDependent: true,
      forceLegalBestOutcome: true,
    });
    expect(d.path).toBe('specialist');
    expect(d.queenAdmission?.admit).toBe(false);
    // Depth preserved on the cheaper path rather than discarded with the swarm.
    expect(d.requireCoT).toBe(true);
    // …and the downgrade is auditable, not mysterious.
    expect(d.reason).toContain('queen_not_earned');
  });

  it('NSP/NYM best-outcome still reaches Queen when the request earns it', () => {
    const d = decideAdaptivePath({
      prompt:
        'What are my rights under a rental dispute in Delhi where the landlord has also '
        + 'invoked arbitration and the society has issued a separate notice? '
        + 'The Delhi High Court and Bombay High Court differ on maintainability.',
      taskType: 'chat',
      complexity: 'moderate',
      risk: 'low',
      nyvDependent: true,
      forceLegalBestOutcome: true,
    });
    expect(d.path).toBe('queen');
    expect(d.requireQueenDepth).toBe(true);
    expect(d.requireCoT).toBe(true);
    expect(d.requireMakerChecker).toBe(true);
  });

  it('NSP/NYM best-outcome keeps trivial Hello on specialist', () => {
    const d = decideAdaptivePath({
      prompt: 'Hello',
      taskType: 'chat',
      complexity: 'simple',
      risk: 'low',
      nyvDependent: true,
      forceLegalBestOutcome: true,
    });
    expect(d.path).toBe('specialist');
  });

  it('detects Devanagari as hi', () => {
    expect(detectLanguageHint('यह एक कानूनी दस्तावेज है')).toBe('hi');
    expect(detectLanguageHint('Section 138 NI Act')).toBe('en');
  });
});

describe('./jrx-quality-envelope', () => {
  it('passes when all mandatory steps marked', () => {
    const env = createQualityEnvelope({
      requestId: 'r1',
      path: 'specialist',
      partnerLean: true,
      risk: 'low',
      requireCoT: false,
      requireMakerChecker: false,
      requireHitlScaled: false,
    });
    markIngressGates(env);
    markSafetyRingGates(env, {
      ragAttempted: true,
      hallucinationRan: true,
      citationRan: true,
      llmRouted: true,
      cotRan: false,
      makerCheckerRan: false,
    });
    markResponseAndAudit(env);
    const snap = assertQualityEnvelope(env);
    expect(snap.ok).toBe(true);
    expect(snap.missingMandatory).toEqual([]);
    for (const id of MANDATORY_QUALITY_STEPS) {
      expect(snap.completed).toContain(id);
    }
  });

  it('fail-closed when NYV_QUALITY_ENVELOPE_FAIL_CLOSED=1 and a mandatory gate fails', () => {
    // NV-QE-RAG-SKIP-001 made an un-attempted RAG a *valid* cost path (lean /
    // enableRAG:false), so `ragAttempted:false` now marks rag_grounding
    // completed-with-note and can no longer trip fail-closed. This test asserted
    // the pre-NV-QE-RAG-SKIP-001 contract and had been passing vacuously in the
    // sense that it tested a gate that is intentionally no longer fatal. Repoint
    // it at a gate that genuinely must never be skipped: PII redaction.
    const prev = process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED;
    process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED = '1';
    try {
      const env = createQualityEnvelope({
        requestId: 'r2',
        path: 'specialist',
        partnerLean: false,
        risk: 'medium',
        requireCoT: false,
        requireMakerChecker: false,
        requireHitlScaled: false,
      });
      markIngressGates(env);
      markSafetyRingGates(env, {
        ragAttempted: false,
        piiRan: false,
        hallucinationRan: true,
        citationRan: true,
        llmRouted: true,
      });
      markResponseAndAudit(env);
      expect(() => assertQualityEnvelope(env)).toThrow(QualityEnvelopeError);
    } finally {
      if (prev === undefined) delete process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED;
      else process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED = prev;
    }
  });

  it('an intentionally RAG-off lean path is NOT fail-closed (NV-QE-RAG-SKIP-001)', () => {
    // The other half of the contract: skipping RAG for cost must stay a legal
    // path, or every lean partner request would 500.
    const prev = process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED;
    process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED = '1';
    try {
      const env = createQualityEnvelope({
        requestId: 'r3',
        path: 'specialist',
        partnerLean: true,
        risk: 'low',
        requireCoT: false,
        requireMakerChecker: false,
        requireHitlScaled: false,
      });
      markIngressGates(env);
      markSafetyRingGates(env, {
        ragAttempted: false,
        hallucinationRan: true,
        citationRan: true,
        llmRouted: true,
      });
      markResponseAndAudit(env);
      expect(() => assertQualityEnvelope(env)).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED;
      else process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED = prev;
    }
  });
});

describe('response contract + doc INTENT', () => {
  it('builds curated sections and cost', () => {
    const decision = decideAdaptivePath({
      prompt: 'Summarise this order',
      taskType: 'summarize',
      complexity: 'simple',
    });
    const env = createQualityEnvelope({
      requestId: 'r3',
      path: decision.path,
      partnerLean: false,
      risk: 'low',
      requireCoT: false,
      requireMakerChecker: false,
      requireHitlScaled: false,
    });
    markIngressGates(env);
    markSafetyRingGates(env, {
      ragAttempted: true,
      hallucinationRan: true,
      citationRan: true,
      llmRouted: true,
    });
    markResponseAndAudit(env);
    const snap = assertQualityEnvelope(env);
    const contract = buildUnifiedOrchestrationContract({
      content: '## Summary\nFoo held that bar.\n\n## Actions\n1. File reply\n2. Serve notice',
      requestId: 'r3',
      decision,
      qualityEnvelope: snap,
      tokens: { prompt: 10, completion: 20, total: 30 },
      latencyMs: 100,
      model: 'test',
      provider: 'test',
    });
    expect(contract.curated.sections.length).toBeGreaterThan(0);
    expect(contract.cost.tokens.total).toBe(30);
    expect(contract.routing.path).toBe('doc-pipeline');
    expect(buildCuratedOutcome(contract.content).summary.length).toBeGreaterThan(0);
  });

  it('INTENT aliases resolve OCR/parse/compare/classify + mesh bots', () => {
    expect(getDeclaredCapabilitiesForIntent('ocr')?.[0]).toBe('docs.ocr');
    expect(getDeclaredCapabilitiesForIntent('parse')?.[0]).toBe('docs.parse');
    expect(getDeclaredCapabilitiesForIntent('compare')?.[0]).toBe('sdk.document-pipeline');
    expect(getDeclaredCapabilitiesForIntent('compare')).toContain('nyaya-tools.compare');
    expect(getDeclaredCapabilitiesForIntent('classify')?.[0]).toBe('intelligence.doc-analyze');
    expect(getDeclaredCapabilitiesForIntent('automateai')?.[0]).toBe('automateai.workflow');
    expect(getDeclaredCapabilitiesForIntent('bmad')?.[0]).toBe('agent.bmad.orchestrate');
    expect(getDeclaredCapabilitiesForIntent('web_search')?.[0]).toBe('enterprise.web-search');
    expect(getDeclaredCapabilitiesForIntent('grpo')?.[0]).toBe('simulation.grpo');
    expect(getDeclaredCapabilitiesForIntent('multilingual')?.[0]).toBe('intelligence.summarize');
  });

  it('doc compare routes to sdk.document-pipeline first', () => {
    const d = decideAdaptivePath({
      prompt: 'Compare these two lease agreements and highlight risk deltas',
      taskType: 'compare',
      complexity: 'simple',
      risk: 'low',
    });
    expect(d.path).toBe('doc-pipeline');
    expect(d.primaryCapabilityIds[0]).toBe('sdk.document-pipeline');
  });
});
