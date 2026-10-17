import { describe, expect, it } from 'vitest';
import {
  deserializeRomaStore,
  mergeRomaStoreIfMissing,
  serializeRomaStore,
} from '../../src/packages/protocols/roma/jrx-roma-performance-codec.js';
import type { PerformanceMetrics } from '../../src/packages/protocols/roma/types.js';

describe('ROMA performance store persist', () => {
  it('round-trips lastUsed dates and metrics', () => {
    const store: PerformanceMetrics = {
      'specialist-orchestrate': {
        usageCount: 4,
        successRate: 0.9,
        fallbackRate: 0.1,
        averageLatencyMs: 1200,
        hallucinationFlags: 0,
        lastUsed: new Date('2026-08-11T17:00:00.000Z'),
      },
    };
    const again = deserializeRomaStore(serializeRomaStore(store));
    expect(again['specialist-orchestrate']?.usageCount).toBe(4);
    expect(again['specialist-orchestrate']?.successRate).toBeCloseTo(0.9);
    expect(again['specialist-orchestrate']?.lastUsed?.toISOString()).toBe('2026-08-11T17:00:00.000Z');
  });

  it('mergeRomaStoreIfMissing does not overwrite live keys', () => {
    const target: PerformanceMetrics = {
      a: { usageCount: 2, successRate: 1, fallbackRate: 0, averageLatencyMs: 10, hallucinationFlags: 0 },
    };
    const incoming: PerformanceMetrics = {
      a: { usageCount: 99, successRate: 0, fallbackRate: 1, averageLatencyMs: 9, hallucinationFlags: 3 },
      b: { usageCount: 1, successRate: 1, fallbackRate: 0, averageLatencyMs: 5, hallucinationFlags: 0 },
    };
    expect(mergeRomaStoreIfMissing(target, incoming)).toBe(1);
    expect(target.a?.usageCount).toBe(2);
    expect(target.b?.usageCount).toBe(1);
  });
});
