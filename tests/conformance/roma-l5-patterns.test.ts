/**
 * ROMA-L5 conformance — 22 orchestration patterns
 * NYV-T013 (Stream D conformance, 2026-05-06).
 *
 * Loads the canonical pattern allocation for the most expansive variant
 * (`nys-institutional`, which carries all 22 ROMA-L5 patterns the platform
 * currently surfaces) and asserts each entry can be hydrated into the
 * minimum descriptor shape required by the L5 optimizer + audit emitter:
 *
 *   { pattern_id, roma_level, delegation_depth,
 *     convergence_criterion, audit_emit, min_jurisdictions }
 *
 * The 22 patterns live in `src/config/jrx-sdk-variants.ts` →
 * `nys-institutional.allocatedPatterns`. NSM (`nys-ministry`) carries 22
 * (21 institutional patterns minus `ContractNegotiation` plus the sovereign
 * `SovereignDeployment` extension) — both must satisfy the descriptor
 * contract.
 */

import { describe, it, expect } from 'vitest';
import { SDK_VARIANTS } from '../../src/config/jrx-sdk-variants.js';

interface PatternDescriptor {
  pattern_id: string;
  roma_level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  delegation_depth: number;
  convergence_criterion: string;
  audit_emit: boolean;
  min_jurisdictions: number;
}

/**
 * Static mapping kept in this conformance suite (not in product code) so the
 * test fails loudly if a pattern is added to the variant config without a
 * descriptor being added here too. This is intentional — the suite is the
 * canonical list of "what the L5 optimizer is allowed to schedule".
 */
const PATTERN_DESCRIPTORS: Record<string, PatternDescriptor> = {
  NyayaRAG:                  { pattern_id: 'NyayaRAG',                  roma_level: 'L2', delegation_depth: 1, convergence_criterion: 'top-k cosine ≥ 0.78',     audit_emit: true,  min_jurisdictions: 1 },
  HumanInTheLoop:            { pattern_id: 'HumanInTheLoop',            roma_level: 'L1', delegation_depth: 0, convergence_criterion: 'reviewer.decision != null', audit_emit: true,  min_jurisdictions: 1 },
  MultiModalLegal:           { pattern_id: 'MultiModalLegal',           roma_level: 'L3', delegation_depth: 2, convergence_criterion: 'modality_consensus ≥ 0.7',  audit_emit: true,  min_jurisdictions: 1 },
  ConversationalAgent:       { pattern_id: 'ConversationalAgent',       roma_level: 'L1', delegation_depth: 0, convergence_criterion: 'turn.terminator',          audit_emit: false, min_jurisdictions: 1 },
  DocumentAnalysis:          { pattern_id: 'DocumentAnalysis',          roma_level: 'L2', delegation_depth: 1, convergence_criterion: 'classifier.confidence ≥ 0.8', audit_emit: true,  min_jurisdictions: 1 },
  JudgeSimulator:            { pattern_id: 'JudgeSimulator',            roma_level: 'L4', delegation_depth: 3, convergence_criterion: 'verdict.signed_by_panel',  audit_emit: true,  min_jurisdictions: 1 },
  ParallelResearch:          { pattern_id: 'ParallelResearch',          roma_level: 'L3', delegation_depth: 2, convergence_criterion: 'all_branches.complete',    audit_emit: true,  min_jurisdictions: 2 },
  IterativeRefinement:       { pattern_id: 'IterativeRefinement',       roma_level: 'L3', delegation_depth: 2, convergence_criterion: 'delta_quality < 0.02',     audit_emit: true,  min_jurisdictions: 1 },
  ChainOfLegalThought:       { pattern_id: 'ChainOfLegalThought',       roma_level: 'L3', delegation_depth: 2, convergence_criterion: 'reasoning.terminator',     audit_emit: true,  min_jurisdictions: 1 },
  AdversarialReview:         { pattern_id: 'AdversarialReview',         roma_level: 'L4', delegation_depth: 3, convergence_criterion: 'rebuttal.exhausted',       audit_emit: true,  min_jurisdictions: 1 },
  PrecedentMining:           { pattern_id: 'PrecedentMining',           roma_level: 'L3', delegation_depth: 2, convergence_criterion: 'citation_graph.closed',    audit_emit: true,  min_jurisdictions: 1 },
  ContractNegotiation:       { pattern_id: 'ContractNegotiation',       roma_level: 'L4', delegation_depth: 3, convergence_criterion: 'redline.accepted',         audit_emit: true,  min_jurisdictions: 1 },
  HierarchicalOrchestration: { pattern_id: 'HierarchicalOrchestration', roma_level: 'L5', delegation_depth: 4, convergence_criterion: 'queen.signoff',            audit_emit: true,  min_jurisdictions: 1 },
  FederatedPrivacy:          { pattern_id: 'FederatedPrivacy',          roma_level: 'L5', delegation_depth: 4, convergence_criterion: 'all_shards.aggregated',    audit_emit: true,  min_jurisdictions: 2 },
  BatchProcessing:           { pattern_id: 'BatchProcessing',           roma_level: 'L2', delegation_depth: 1, convergence_criterion: 'queue.drained',            audit_emit: true,  min_jurisdictions: 1 },
  RealTimeMonitoring:        { pattern_id: 'RealTimeMonitoring',        roma_level: 'L2', delegation_depth: 1, convergence_criterion: 'window.elapsed',           audit_emit: true,  min_jurisdictions: 1 },
  SelfHealingPipeline:       { pattern_id: 'SelfHealingPipeline',       roma_level: 'L4', delegation_depth: 3, convergence_criterion: 'health.green',             audit_emit: true,  min_jurisdictions: 1 },
  AutonomousExecution:       { pattern_id: 'AutonomousExecution',       roma_level: 'L5', delegation_depth: 4, convergence_criterion: 'goal.satisfied',           audit_emit: true,  min_jurisdictions: 1 },
  MultiAgentDebate:          { pattern_id: 'MultiAgentDebate',          roma_level: 'L4', delegation_depth: 3, convergence_criterion: 'panel.majority',           audit_emit: true,  min_jurisdictions: 1 },
  ConsensusBuilding:         { pattern_id: 'ConsensusBuilding',         roma_level: 'L4', delegation_depth: 3, convergence_criterion: 'agreement ≥ 0.66',         audit_emit: true,  min_jurisdictions: 1 },
  EscalationChain:           { pattern_id: 'EscalationChain',           roma_level: 'L3', delegation_depth: 2, convergence_criterion: 'escalation.resolved',      audit_emit: true,  min_jurisdictions: 1 },
  GRPOOptimization:          { pattern_id: 'GRPOOptimization',          roma_level: 'L5', delegation_depth: 4, convergence_criterion: 'reward_delta < 0.01',      audit_emit: true,  min_jurisdictions: 1 },
  SovereignDeployment:       { pattern_id: 'SovereignDeployment',       roma_level: 'L5', delegation_depth: 4, convergence_criterion: 'sovereign_signoff',        audit_emit: true,  min_jurisdictions: 1 },
};

describe('ROMA-L5 conformance — 22 orchestration patterns', () => {
  const institutional = SDK_VARIANTS['nys-institutional'].allocatedPatterns;
  const ministry      = SDK_VARIANTS['nys-ministry'].allocatedPatterns;

  it('nys-institutional carries exactly 22 patterns', () => {
    expect(institutional.length).toBe(22);
  });

  it('nys-ministry carries exactly 22 patterns (incl. SovereignDeployment)', () => {
    expect(ministry.length).toBe(22);
    expect(ministry).toContain('SovereignDeployment');
  });

  const universe = Array.from(new Set([...institutional, ...ministry]));

  it.each(universe)('pattern %s has a complete L5 descriptor', (patternName) => {
    const d = PATTERN_DESCRIPTORS[patternName];
    expect(d, `Missing descriptor for ${patternName} — add to PATTERN_DESCRIPTORS`).toBeDefined();
    expect(d.pattern_id).toBe(patternName);
    expect(['L1', 'L2', 'L3', 'L4', 'L5']).toContain(d.roma_level);
    expect(d.delegation_depth).toBeGreaterThanOrEqual(0);
    expect(d.delegation_depth).toBeLessThanOrEqual(4);
    expect(typeof d.convergence_criterion).toBe('string');
    expect(d.convergence_criterion.length).toBeGreaterThan(0);
    expect(typeof d.audit_emit).toBe('boolean');
    expect(d.min_jurisdictions).toBeGreaterThanOrEqual(1);
  });

  it('every L5 pattern emits an audit row', () => {
    const l5 = Object.values(PATTERN_DESCRIPTORS).filter((p) => p.roma_level === 'L5');
    expect(l5.length).toBeGreaterThanOrEqual(4);
    for (const p of l5) {
      expect(p.audit_emit, `L5 pattern ${p.pattern_id} must emit audit`).toBe(true);
    }
  });

  it('FederatedPrivacy + ParallelResearch require ≥ 2 jurisdictions', () => {
    expect(PATTERN_DESCRIPTORS.FederatedPrivacy.min_jurisdictions).toBeGreaterThanOrEqual(2);
    expect(PATTERN_DESCRIPTORS.ParallelResearch.min_jurisdictions).toBeGreaterThanOrEqual(2);
  });
});
