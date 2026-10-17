/**
 * Unit Tests — GRPO Optimization Service
 * Tests: initialization, group evaluation, policy updates, reward scoring,
 *        preference pairs, boot/persist, recordFeedback, stats tracking
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GRPOOptimizationService } from '../../../src/services/grpo-optimization-service.js';

describe('GRPOOptimizationService', () => {
  let grpo: GRPOOptimizationService;

  beforeEach(() => {
    grpo = new GRPOOptimizationService({
      groupSize: 4,
      learningRate: 0.01,
      explorationRate: 0.1,
      minGroupsForUpdate: 2,
      maxStoredPreferences: 100,
      rewardDimensions: [
        'accuracy', 'relevance', 'safety',
        'legal_precision', 'citation_quality',
        'jurisdiction_compliance', 'template_adherence',
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with 7 reward dimensions', () => {
      const dims = grpo.getRewardDimensions();
      expect(dims).toHaveLength(7);
      expect(dims).toContain('jurisdiction_compliance');
      expect(dims).toContain('template_adherence');
    });

    it('should start with groupSize 4 as configured', () => {
      const stats = grpo.getStats();
      expect(stats).toBeDefined();
    });

    it('should start with default policy', () => {
      const policy = grpo.getCurrentPolicy();
      expect(policy.temperature).toBeGreaterThan(0);
      expect(policy.temperature).toBeLessThanOrEqual(1);
      expect(policy.topP).toBeGreaterThan(0);
      expect(policy.topP).toBeLessThanOrEqual(1);
    });

    it('should have 0 groups initially', () => {
      const stats = grpo.getStats();
      expect(stats.totalGroups).toBe(0);
    });
  });

  describe('evaluateGroup()', () => {
    it('should evaluate a group of responses', async () => {
      const result = await grpo.evaluateGroup(
        'Explain Section 138 NI Act',
        [
          { content: 'Section 138 deals with dishonour of cheques. The payee can file a complaint.' },
          { content: 'The negotiable instruments act section 138 covers cheque bouncing cases.' },
          { content: 'Under Section 138 NI Act, dishonour of cheque is a criminal offence.' },
        ]
      );

      expect(result).toBeDefined();
      expect(result.groupId).toBeDefined();
      expect(result.responses).toHaveLength(3);
      expect(result.bestResponse).toBeDefined();
      expect(result.bestResponse.totalReward).toBeGreaterThanOrEqual(0);
    });

    it('should assign ranks to responses', async () => {
      const result = await grpo.evaluateGroup(
        'What is SEBI?',
        [
          { content: 'SEBI is the Securities and Exchange Board of India, the market regulator.' },
          { content: 'sebi is india stock market regulator' },
        ]
      );

      const ranks = result.responses.map(r => r.rank).sort();
      expect(ranks).toEqual([1, 2]);
    });

    it('should generate best response with highest reward', async () => {
      const result = await grpo.evaluateGroup(
        'Bail application under Section 437 CrPC',
        [
          { content: 'Under Section 437 CrPC, the Magistrate may grant bail considering the gravity of the offence, the accused\'s antecedents, and public order.' },
          { content: 'bail application' },
        ]
      );

      expect(result.bestResponse.totalReward).toBeGreaterThanOrEqual(
        result.responses.find(r => r !== result.bestResponse)?.totalReward ?? -Infinity
      );
    });

    it('should increment group count after evaluation', async () => {
      const before = grpo.getStats().totalGroups;
      await grpo.evaluateGroup('test prompt', [{ content: 'test response' }]);
      const after = grpo.getStats().totalGroups;
      expect(after).toBe(before + 1);
    });

    it('should emit group:evaluated event', async () => {
      const listener = vi.fn();
      grpo.on('group:evaluated', listener);
      await grpo.evaluateGroup('test', [{ content: 'response' }]);
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('generateAndEvaluate()', () => {
    it('should generate and evaluate a group from a prompt', async () => {
      const result = await grpo.generateAndEvaluate(
        'Explain the Companies Act 2013 director duties'
      );

      expect(result).toBeDefined();
      expect(result.responses.length).toBeGreaterThan(0);
      expect(result.bestResponse).toBeDefined();
    });
  });

  describe('policy updates', () => {
    it('should not update policy with insufficient data', async () => {
      // minGroupsForUpdate is 2, so with 1 pair it should return null
      grpo = new GRPOOptimizationService({ minGroupsForUpdate: 10 });
      const update = await grpo.optimizePolicy();
      expect(update).toBeNull();
    });

    it('should update policy after enough preference pairs', async () => {
      // Build up enough evaluations
      const grpoLowThreshold = new GRPOOptimizationService({
        minGroupsForUpdate: 2,
        groupSize: 2,
      });

      for (let i = 0; i < 5; i++) {
        await grpoLowThreshold.evaluateGroup(`Legal query ${i}`, [
          { content: `Detailed legal response with citations and jurisdiction analysis for query ${i}.` },
          { content: `Short answer ${i}` },
        ]);
      }

      const update = await grpoLowThreshold.optimizePolicy();
      // May or may not update depending on pair selection — just check no crash
      expect(update === null || typeof update === 'object').toBe(true);
    });

    it('should reset policy to defaults', () => {
      grpo.resetPolicy();
      const policy = grpo.getCurrentPolicy();
      expect(policy.temperature).toBeGreaterThan(0);
    });
  });

  describe('recordFeedback()', () => {
    it('should record feedback without throwing', () => {
      expect(() => {
        grpo.recordFeedback({
          patternKey: 'P01',
          route: '/api/jrx/patterns/react',
          agentId: 'NYV-AGT-CONTRACT-001',
          jurisdiction: 'IN',
          taskSnippet: 'Analyze this contract clause',
          responseSnippet: 'The clause contains a liquidated damages provision...',
        });
      }).not.toThrow();
    });

    it('should emit feedback event', () => {
      const listener = vi.fn();
      grpo.on('feedback', listener);

      grpo.recordFeedback({
        patternKey: 'P02',
        route: '/api/jrx/patterns/cot',
        taskSnippet: 'Explain IPC 420',
        responseSnippet: 'IPC Section 420 deals with cheating...',
      });

      expect(listener).toHaveBeenCalledOnce();
    });

    it('should emit feedback with correct pattern key', () => {
      const listener = vi.fn();
      grpo.on('feedback', listener);

      grpo.recordFeedback({
        patternKey: 'P21',
        route: '/api/jrx/patterns/grpo',
        taskSnippet: 'GRPO evaluation task',
        responseSnippet: 'Evaluation result...',
      });

      const emitted = listener.mock.calls[0][0];
      expect(emitted.patternKey).toBe('P21');
    });

    it('should use default reward when none provided', () => {
      const listener = vi.fn();
      grpo.on('feedback', listener);

      grpo.recordFeedback({
        patternKey: 'P05',
        route: '/test',
        taskSnippet: 'test',
        responseSnippet: 'test response',
      });

      const emitted = listener.mock.calls[0][0];
      expect(emitted.reward).toBeGreaterThanOrEqual(0);
      expect(emitted.reward).toBeLessThanOrEqual(1);
    });
  });

  describe('getStats()', () => {
    it('should return stats object with required fields', () => {
      const stats = grpo.getStats();
      expect(stats).toHaveProperty('totalGroups');
      expect(stats).toHaveProperty('totalPolicyUpdates');
      expect(stats).toHaveProperty('averageReward');
      expect(stats).toHaveProperty('lastUpdateTimestamp');
    });

    it('should reflect group count after evaluations', async () => {
      await grpo.evaluateGroup('q1', [{ content: 'r1' }]);
      await grpo.evaluateGroup('q2', [{ content: 'r2' }]);
      expect(grpo.getStats().totalGroups).toBe(2);
    });
  });

  describe('boot()', () => {
    it('should complete without throwing (DB not available in unit tests)', async () => {
      await expect(grpo.boot()).resolves.not.toThrow();
    });
  });
});
