import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  isNyayasearchGatewayRequest,
  shouldSkipPartnerProductRateLimits,
} from '../../src/utils/jrx-partner-platform.js';

function mockReq(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe('NV-JRX-CNR-RATELIMIT-001', () => {
  it('treats caselaw-worker gateway calls as rate-limit exempt', () => {
    const req = mockReq({
      'x-jrx-platform': 'nys',
      'x-api-key': 'nyv_test_key_1234567890',
    });
    expect(isNyayasearchGatewayRequest(req)).toBe(true);
    expect(shouldSkipPartnerProductRateLimits(req)).toBe(true);
  });

  it('does not exempt anonymous traffic', () => {
    const req = mockReq({ 'x-jrx-platform': 'nys' });
    expect(isNyayasearchGatewayRequest(req)).toBe(false);
  });
});
