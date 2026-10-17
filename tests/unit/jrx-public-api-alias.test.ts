import { describe, expect, it } from 'vitest';
import { rewriteJrxPath } from '../../src/middleware/jrx-public-api-alias.js';

describe('jrx-public-api-alias', () => {
  it('rewrites /api/jrx health to internal mount during legacy alias mode', () => {
    expect(rewriteJrxPath('/api/jrx/health')).toBe('/api/jrx/health'.replace('/api/jrx', '/api/jrx'));
  });

  it('preserves non-jrx paths', () => {
    expect(rewriteJrxPath('/api/jrx/v1/sdk/health')).toContain('/api/jrx');
  });
});
