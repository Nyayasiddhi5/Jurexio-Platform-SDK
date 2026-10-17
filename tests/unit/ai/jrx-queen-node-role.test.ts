import { describe, expect, it } from 'vitest';
import {
  classifyQueenNodeRole,
  resolveExplorationMaxTokens,
} from '../../../src/orchestration/jrx-queen-node-role.js';

/**
 * NV-QUEEN-LEAF-TIER-001 regression suite.
 *
 * Measured on jrx-prod (`scripts/_ec2-swarm-fail-rca.sh`, SSM `d9d3ffc5`): a
 * forced `orchestrationMode:swarm` request summed **249 s across 6 completions**,
 * every one of them `gemini-3-1-pro-preview` at 20–58 s, and all three
 * `swarm_exploration` nodes died on `policy: per-node timeout after 120000ms`.
 * The cause was uniform premium sizing at the single dispatch site: every leaf
 * asked for `complexity:'complex'` / `qualityLevel:'professional'` / 16,384
 * output tokens, including leaves whose notes a synthesis node then rewrites.
 */
describe('./jrx-queen-node-role — leaf vs synthesis (NV-QUEEN-LEAF-TIER-001)', () => {
  it('classifies the measured swarm exploration node as exploration', () => {
    // Exact shape emitted by swarmDecompose() for the nodes that timed out.
    expect(
      classifyQueenNodeRole({
        type: 'swarm_exploration',
        requiredCapabilities: ['research'],
      }),
    ).toBe('exploration');
  });

  it('classifies the swarm aggregation node as synthesis', () => {
    expect(
      classifyQueenNodeRole({
        type: 'swarm_aggregation',
        requiredCapabilities: ['synthesis', 'analysis'],
      }),
    ).toBe('synthesis');
  });

  it('keeps premium behaviour for unknown or missing node types', () => {
    // Fail-safe: this change must only ever downgrade nodes we positively
    // recognise as intermediate, never an unclassified one.
    expect(classifyQueenNodeRole(undefined)).toBe('synthesis');
    expect(classifyQueenNodeRole({})).toBe('synthesis');
    expect(classifyQueenNodeRole({ type: '' })).toBe('synthesis');
    expect(classifyQueenNodeRole({ type: '   ' })).toBe('synthesis');
  });

  it('treats every user-visible authoring role as synthesis', () => {
    for (const type of [
      'synthesis',
      'aggregation',
      'final_synthesis',
      'consensus',
      'review',
      'FINAL_SYNTHESIS',
      'document_drafting',
      'verdict_analysis',
    ]) {
      expect(classifyQueenNodeRole({ type }), type).toBe('synthesis');
    }
  });

  it('treats intermediate research roles as exploration', () => {
    for (const type of ['swarm_exploration', 'research', 'analysis', 'retrieval', 'exploration']) {
      expect(classifyQueenNodeRole({ type }), type).toBe('exploration');
    }
  });

  it('promotes a node to synthesis when its capabilities say it synthesises', () => {
    // Type alone is intermediate, but the capability list gives it away.
    expect(
      classifyQueenNodeRole({ type: 'research', requiredCapabilities: ['synthesis'] }),
    ).toBe('synthesis');
    expect(
      classifyQueenNodeRole({ type: 'research', requiredCapabilities: ['Aggregation'] }),
    ).toBe('synthesis');
  });

  it('does not promote a node on an unrelated capability', () => {
    expect(
      classifyQueenNodeRole({ type: 'research', requiredCapabilities: ['criminal', 'research'] }),
    ).toBe('exploration');
  });
});

describe('./jrx-queen-node-role — exploration token ceiling', () => {
  it('defaults to 2,048 output tokens', () => {
    expect(resolveExplorationMaxTokens(undefined)).toBe(2_048);
  });

  it('honours a sane override', () => {
    expect(resolveExplorationMaxTokens(1_024)).toBe(1_024);
    expect(resolveExplorationMaxTokens('1536')).toBe(1_536);
  });

  it('clamps so misconfiguration cannot restore the 16k generation', () => {
    // 16,384 was the measured value that consumed the whole per-node budget.
    expect(resolveExplorationMaxTokens(16_384)).toBe(4_096);
    expect(resolveExplorationMaxTokens(64)).toBe(512);
  });

  it('falls back to the default on garbage input', () => {
    expect(resolveExplorationMaxTokens('not-a-number')).toBe(2_048);
    expect(resolveExplorationMaxTokens(0)).toBe(2_048);
    expect(resolveExplorationMaxTokens(-1)).toBe(2_048);
  });
});
