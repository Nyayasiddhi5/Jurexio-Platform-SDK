/**
 * NV-QE-COT-CAPTURE-FAIL-001 — completed Queen answers survive a CoT JSON parse miss.
 *
 * Job 297 (2026-08-17T05:37Z, api.nyayasiddhi.online): Queen produced the draft,
 * CoT capture threw, envelope fail-closed missing:["cot"], NSP got HTTP 500
 * QUALITY_ENVELOPE_FAILED (193 bytes). This locks the scale-off so that class
 * of failure cannot 500 a billed answer again — without reopening
 * NV-QUEEN-COT-COLLECTIVE-001 (CoT never invoked still fail-closes).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createQualityEnvelope,
  markIngressGates,
  markSafetyRingGates,
  markResponseAndAudit,
  snapshotQualityEnvelope,
  scaleCoTAfterCaptureFailure,
  assertQualityEnvelope,
} from '../../src/orchestration/jrx-quality-envelope.js';

const SRC = join(process.cwd(), 'src');

function envelope(requireCoT: boolean) {
  return createQualityEnvelope({
    requestId: 'job-297',
    path: 'queen',
    partnerLean: false,
    risk: 'medium',
    requireCoT,
    requireMakerChecker: false,
    requireHitlScaled: false,
  });
}

function completeSafety(env: ReturnType<typeof envelope>, cotRan: boolean) {
  markIngressGates(env);
  markSafetyRingGates(env, {
    ragAttempted: true,
    ragGrounded: true,
    hallucinationRan: true,
    citationRan: true,
    biasRan: true,
    piiRan: true,
    complianceRan: true,
    llmRouted: true,
    cotRan,
  });
  markResponseAndAudit(env);
}

describe('NV-QE-COT-CAPTURE-FAIL-001: scale-off after a completed answer', () => {
  it('Job 297 shape: requireCoT + capture failed + answer present → envelope ok', () => {
    const env = envelope(true);
    const scaled = scaleCoTAfterCaptureFailure(env, {
      hasCompletedAnswer: true,
      cotCaptured: false,
      cotCaptureFailed: true,
    });
    expect(scaled).toBe(true);
    expect(env.requireCoT).toBe(false);

    completeSafety(env, false);
    const snap = snapshotQualityEnvelope(env);
    expect(snap.ok).toBe(true);
    expect(snap.missingMandatory).toEqual([]);
    expect(snap.scaledOptional).toContain('cot');
  });

  it('does not 500 when asserted fail-closed after scale-off', () => {
    const prev = process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED;
    process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED = '1';
    try {
      const env = envelope(true);
      scaleCoTAfterCaptureFailure(env, {
        hasCompletedAnswer: true,
        cotCaptured: false,
        cotCaptureFailed: true,
      });
      completeSafety(env, false);
      expect(() => assertQualityEnvelope(env)).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED;
      else process.env.NYV_QUALITY_ENVELOPE_FAIL_CLOSED = prev;
    }
  });

  it('never-attempted CoT on a completed answer still fail-closes (collective wiring bug stays visible)', () => {
    const env = envelope(true);
    const scaled = scaleCoTAfterCaptureFailure(env, {
      hasCompletedAnswer: true,
      cotCaptured: false,
      cotCaptureFailed: false,
    });
    expect(scaled).toBe(false);
    expect(env.requireCoT).toBe(true);
    completeSafety(env, false);
    const snap = snapshotQualityEnvelope(env);
    expect(snap.ok).toBe(false);
    expect(snap.missingMandatory).toContain('cot');
  });

  it('does not scale off when CoT actually captured', () => {
    const env = envelope(true);
    expect(scaleCoTAfterCaptureFailure(env, {
      hasCompletedAnswer: true,
      cotCaptured: true,
      cotCaptureFailed: true,
    })).toBe(false);
    expect(env.requireCoT).toBe(true);
  });

  it('does not scale off when there is no answer to save', () => {
    const env = envelope(true);
    expect(scaleCoTAfterCaptureFailure(env, {
      hasCompletedAnswer: false,
      cotCaptured: false,
      cotCaptureFailed: true,
    })).toBe(false);
    expect(env.requireCoT).toBe(true);
  });

  it('scales off when CoT was skipped so HTTP could proceed after an answer existed', () => {
    const env = envelope(true);
    const scaled = scaleCoTAfterCaptureFailure(env, {
      hasCompletedAnswer: true,
      cotCaptured: false,
      cotCaptureFailed: false,
      cotSkippedForProgression: true,
    });
    expect(scaled).toBe(true);
    expect(env.requireCoT).toBe(false);
    completeSafety(env, false);
    expect(snapshotQualityEnvelope(env).ok).toBe(true);
  });
});

describe('NV-QE-COT-CAPTURE-FAIL-001: Queen stamps capture failure, never claims CoT ran', () => {
  it('the CoT catch sets __queenCotCaptureFailed and does not set __queenCotApplied', () => {
    const queen = readFileSync(join(SRC, 'orchestration/jrx-queen-orchestrator.ts'), 'utf8');
    const start = queen.indexOf('async function maybeRunQueenCoT');
    const end = queen.indexOf('\nconst MW_STATUS_TO_VERDICT', start);
    expect(start).toBeGreaterThan(-1);
    const body = queen.slice(start, end);
    expect(body).toContain('__queenCotCaptureFailed = true');
    // Inside the catch, applied must not be set — that would launder a parse miss
    // into a completed reasoning step.
    const catchIdx = body.indexOf('} catch (error: unknown)');
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBody = body.slice(catchIdx);
    expect(catchBody).not.toMatch(/__queenCotApplied\s*=\s*true/);
  });

  it('the Queen route calls the scale-off before asserting the envelope', () => {
    const routes = readFileSync(join(SRC, 'routes/jrx-orchestration-routes.ts'), 'utf8');
    const idx = routes.indexOf('scaleCoTAfterCaptureFailure(qualityEnv');
    expect(idx, 'Queen success path must call the scale-off').toBeGreaterThan(-1);
    const assertIdx = routes.indexOf('assertQualityEnvelope(qualityEnv)');
    expect(assertIdx).toBeGreaterThan(idx);
  });
});
