import { describe, expect, it } from 'vitest';
import { resolveCamTotalAgents } from '../../src/utils/jrx-cam-total-agents.js';

describe('resolveCamTotalAgents', () => {
  it('prefers live registry count over empty nv_agents', () => {
    expect(resolveCamTotalAgents(0, 164)).toBe(164);
  });

  it('falls back to persisted rows when registry is not loaded', () => {
    expect(resolveCamTotalAgents(12, 0)).toBe(12);
  });

  it('returns 0 when both sources are empty', () => {
    expect(resolveCamTotalAgents(0, 0)).toBe(0);
  });
});
