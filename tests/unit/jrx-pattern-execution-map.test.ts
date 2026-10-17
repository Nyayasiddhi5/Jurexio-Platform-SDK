import { describe, it, expect } from 'vitest';
import {
  patternCapabilityHint,
  patternPreferredTopologyId,
  patternShouldApplyCot,
  patternShouldForceMakerChecker,
  patternSystemDirective,
  patternToOrchestrationPattern,
} from '../../src/orchestration/jrx-pattern-execution-map.js';
import { TOP_10_TOPOLOGY_IDS } from '../../src/services/jrx-topology-algorithms.js';

describe('./jrx-pattern-execution-map (Wave B Queen OS)', () => {
  it('P02 CoT and P07 maker-checker policy hooks', () => {
    expect(patternShouldApplyCot('P02')).toBe(true);
    expect(patternShouldApplyCot('P07')).toBe(false);
    expect(patternShouldForceMakerChecker('P07')).toBe(true);
    expect(patternShouldForceMakerChecker('P02')).toBe(false);
  });

  it('P08–P10 tool patterns hint tools.execute', () => {
    for (const id of ['P08', 'P09', 'P10'] as const) {
      expect(patternCapabilityHint(id)).toBe('tools.execute');
    }
  });

  it('P11 Auto-RAG hints rag.search with grounding directive', () => {
    expect(patternCapabilityHint('P11')).toBe('rag.search');
    expect(patternSystemDirective('P11')).toMatch(/NyayaRAG/i);
    expect(patternToOrchestrationPattern('P11')).toBe('hierarchical');
  });

  it('P21 GRPO binds simulation.grpo leaf + behavioural directive', () => {
    expect(patternCapabilityHint('P21')).toBe('simulation.grpo');
    expect(patternSystemDirective('P21')).toMatch(/GRPO/i);
  });

  it('preferred topology ids stay within TOP_10 catalog', () => {
    for (const patternId of ['P03', 'P05', 'P15', 'P16', 'P18', 'P22'] as const) {
      const topo = patternPreferredTopologyId(patternId);
      expect(topo, `${patternId} should map to a TOP_10 topology`).toBeTruthy();
      expect(TOP_10_TOPOLOGY_IDS).toContain(topo);
    }
  });
});
