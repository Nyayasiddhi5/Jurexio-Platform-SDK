/**
 * NV-STREAM-TERMINAL-POLISH-001 — post-stream sync-parity polish for partner SSE.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  applyStreamTerminalPolish,
  buildPartnerStreamRunCompletedResult,
  isStreamTerminalPolishEnabled,
  shouldApplyStreamTerminalPolish,
} from '../../src/orchestration/jrx-stream-terminal-polish.js';
import type { AdaptiveRouterDecision } from '../../src/orchestration/jrx-adaptive-router.js';

describe('NV-STREAM-TERMINAL-POLISH-001', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  });

  function setEnv(name: string, value: string | undefined) {
    if (!(name in prev)) prev[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it('defaults ON via NYV_STREAM_TERMINAL_POLISH when unset in test env', () => {
    setEnv('NYV_STREAM_TERMINAL_POLISH', '1');
    expect(isStreamTerminalPolishEnabled()).toBe(true);
    expect(shouldApplyStreamTerminalPolish({ partnerLean: true, taskType: 'legal-draft-fast' })).toBe(true);
  });

  it('respects explicit opt-out', () => {
    setEnv('NYV_STREAM_TERMINAL_POLISH', '0');
    expect(isStreamTerminalPolishEnabled()).toBe(false);
    expect(shouldApplyStreamTerminalPolish({ partnerLean: true, taskType: 'legal-draft-fast' })).toBe(false);
  });

  it('scopes to partner lean / -fast taskTypes only', () => {
    setEnv('NYV_STREAM_TERMINAL_POLISH', '1');
    expect(shouldApplyStreamTerminalPolish({ taskType: 'legal-draft' })).toBe(false);
    expect(shouldApplyStreamTerminalPolish({ taskType: 'legal-chat' })).toBe(false);
    expect(shouldApplyStreamTerminalPolish({ taskType: 'legal-draft-fast' })).toBe(true);
    expect(shouldApplyStreamTerminalPolish({ partnerLean: true })).toBe(true);
  });

  it('transforms streamed body with legal formatting (MOST RESPECTFULLY SHOWETH)', async () => {
    setEnv('NYV_STREAM_TERMINAL_POLISH', '1');
    const raw = [
      'IN THE COURT OF SESSIONS JUDGE AT CHENNAI',
      '',
      'MOST RESPECTFULLY SHOWETH:',
      '1. The applicant seeks anticipatory bail under BNSS 482.',
    ].join('\n');

    const { content, changed } = await applyStreamTerminalPolish(raw, {
      prompt: 'Draft anticipatory bail under BNSS 482',
      taskType: 'legal-draft-fast',
      jurisdiction: 'IN',
      agentKey: 'generic',
    });

    expect(changed).toBe(true);
    expect(content).toMatch(/\*\*MOST RESPECTFULLY SHOWETH:\*\*/);
    expect(content).not.toMatch(/^MOST RESPECTFULLY SHOWETH:$/m);
  });

  it('buildPartnerStreamRunCompletedResult mirrors sync draftQuality inference metadata', () => {
    const decision = {
      path: 'specialist',
      reason: 'test',
      complexity: 'low',
      risk: 'low',
      detectedLanguage: 'en',
      docTask: 'legal-draft-fast',
      primaryCapabilityIds: [],
    } as AdaptiveRouterDecision;
    const result = buildPartnerStreamRunCompletedResult({
      content: 'Draft body with PRAYER and VERIFICATION sections.',
      runId: 'run-test',
      taskType: 'legal-draft-fast',
      streamAdaptive: decision,
      qualityEnvelope: {
        gates: {},
        qualityOk: true,
        auditReady: true,
      } as never,
      documentTypeResolution: {
        documentType: 'bail_application',
        source: 'prompt_inferred',
        wasInferred: true,
        confidence: 0.85,
        rationale: ['Prompt matched: Bail application.'],
      },
      parameters: { documentType: 'bail_application' },
      options: { draftLength: 'medium' },
    });
    const dq = (result.draftQuality || {}) as Record<string, unknown>;
    expect(dq.inferredDocumentType).toBe('bail_application');
    expect(dq.documentTypeSource).toBe('prompt_inferred');
    expect(dq.structureMarkers).toBeTruthy();
  });

  it('buildPartnerStreamRunCompletedResult emits sync-shaped completion on run_completed payload', () => {
    const decision = {
      path: 'specialist',
      reason: 'test',
      complexity: 'low',
      risk: 'low',
      detectedLanguage: 'en',
      docTask: 'legal-draft-fast',
      primaryCapabilityIds: [],
    } as AdaptiveRouterDecision;
    const incompleteBody = 'IN THE SESSIONS COURT\n1. The applicant seeks bail under BNSS 482.\n';
    const result = buildPartnerStreamRunCompletedResult({
      content: incompleteBody,
      runId: 'run-continue',
      taskType: 'legal-draft-fast',
      streamAdaptive: decision,
      qualityEnvelope: { gates: {}, qualityOk: true, auditReady: true } as never,
      parameters: { documentType: 'bail_application' },
      options: { draftLength: 'medium' },
    });
    expect(result.completionStatus).toBe('incomplete');
    expect(result.continuationAvailable).toBe(true);
    expect((result.completion as Record<string, unknown>)?.continueRequest).toBeTruthy();
    const dq = (result.draftQuality || {}) as Record<string, unknown>;
    expect(dq.completionStatus).toBe('incomplete');
    expect(dq.continuationAvailable).toBe(true);
  });
});
