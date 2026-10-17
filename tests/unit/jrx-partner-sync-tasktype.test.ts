/**
 * NV-PARTNER-SYNC-TASKTYPE-001 — bare counsel aliases + sync budget → -fast routing.
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  applyPartnerSyncTaskTypeAlias,
  hasPartnerSyncTimeoutBudget,
  resolvePartnerTaskTypeForSyncBudget,
  wantsPartnerQualityQueenPath,
  isPartnerSlaFastTask,
} from '../../src/utils/jrx-partner-platform.js';

function nspRequest(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return {
    body,
    headers: { 'x-jrx-platform': 'NSP', ...headers },
    sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
  } as unknown as Request;
}

describe('NV-PARTNER-SYNC-TASKTYPE-001', () => {
  it('detects sync timeout budget from header and body', () => {
    expect(hasPartnerSyncTimeoutBudget(nspRequest({}, { 'x-jrx-partner-sync-timeout-ms': '60000' }))).toBe(true);
    expect(hasPartnerSyncTimeoutBudget(nspRequest({ syncTimeoutMs: 45000 }))).toBe(true);
    expect(hasPartnerSyncTimeoutBudget(nspRequest({ routingMode: 'fast' }))).toBe(true);
    expect(hasPartnerSyncTimeoutBudget(nspRequest({ taskType: 'legal-chat' }))).toBe(false);
  });

  it('routes bare legal-chat with sync budget to legal-chat-fast', () => {
    const req = nspRequest({ taskType: 'legal-chat', syncTimeoutMs: 90000 });
    expect(resolvePartnerTaskTypeForSyncBudget(req, 'legal-chat')).toBe('legal-chat-fast');
    expect(applyPartnerSyncTaskTypeAlias(req)).toBe('legal-chat-fast');
    expect((req.body as Record<string, unknown>)._nyvTaskTypeRoutedFrom).toBe('legal-chat');
    expect(isPartnerSlaFastTask(req, { taskType: 'legal-chat-fast' })).toBe(true);
  });

  it('routes bare legal-draft with sync budget to legal-draft-fast', () => {
    const req = nspRequest({ taskType: 'legal-draft' }, { 'x-jrx-routing-mode': 'sla' });
    expect(resolvePartnerTaskTypeForSyncBudget(req, 'legal-draft')).toBe('legal-draft-fast');
  });

  it('does not override when quality/Queen explicitly requested', () => {
    const req = nspRequest({ taskType: 'legal-draft', syncTimeoutMs: 60000, qualityMode: 'counsel' });
    expect(wantsPartnerQualityQueenPath(req, 'legal-draft')).toBe(true);
    expect(resolvePartnerTaskTypeForSyncBudget(req, 'legal-draft')).toBe('legal-draft');
    expect(isPartnerSlaFastTask(req, { taskType: 'legal-draft' })).toBe(false);
  });

  it('does not override -deep aliases', () => {
    const req = nspRequest({ taskType: 'legal-draft-deep', syncTimeoutMs: 60000 });
    expect(resolvePartnerTaskTypeForSyncBudget(req, 'legal-draft-deep')).toBe('legal-draft-deep');
  });
});
