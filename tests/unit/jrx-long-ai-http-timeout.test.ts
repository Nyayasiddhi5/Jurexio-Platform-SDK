import { describe, it, expect } from 'vitest';
import { isLongAiHttpPath } from '../../src/middleware/jrx-long-ai-http-timeout.js';

describe('NV-LONG-AI-HTTP-TIMEOUT-001', () => {
  it('matches orchestrate and long AI partner paths', () => {
    expect(isLongAiHttpPath('/api/jrx/orchestrate')).toBe(true);
    expect(isLongAiHttpPath('/api/jrx/orchestrate/stream')).toBe(true);
    expect(isLongAiHttpPath('/api/jrx/legal-work/evaluate')).toBe(true);
    expect(isLongAiHttpPath('/api/jrx/v1/sdk/docs-pipeline/documents/analyze')).toBe(true);
    expect(isLongAiHttpPath('/api/jrx/health')).toBe(false);
  });
});
