import { createLogger } from '../utils/logger.js';
import {
  jurisdictionPromptResolver,
  SUPPORTED_JURISDICTIONS,
  type JurisdictionCode,
} from '../services/jrx-jurisdiction-prompt-resolver.js';

const logger = createLogger('./jrx-jurisdiction-prompt-validator');

export interface JurisdictionPromptInvariants {
  // v5.1.0 format-b: 164 agents per registry × 7 files = 1148 prompts
  expectedPerJurisdiction: Record<JurisdictionCode, number>;
  expectedTotal: number;
  requireAllSections: number;
}

export const PRODUCTION_INVARIANTS: JurisdictionPromptInvariants = {
  expectedPerJurisdiction: {
    IN: 164,
    UK: 164,
    US: 164,
    EU: 164,
    SG: 164,
    GC: 164,
    DEFAULT: 164,
  },
  expectedTotal: 7 * 164,
  // v5.0.0 — registries now ship with §23 (Data Privacy & PII Redaction Charter).
  // Per-agent section count is enforced by the resolver against the registry's
  // declared registryFormat; this number is the platform-wide target.
  requireAllSections: 23,
};

export interface ValidationOutcome {
  ok: boolean;
  failures: string[];
  loadedTotal: number;
  expectedTotal: number;
  perJurisdiction: Record<JurisdictionCode, { loaded: number; expected: number; ok: boolean }>;
}

/**
 * Validates that the JurisdictionPromptResolver loaded exactly what production needs.
 * In production, a failure exits the process so the gateway refuses to serve traffic
 * with degraded (empty) prompts.
 */
export async function validateJurisdictionPrompts(
  invariants: JurisdictionPromptInvariants = PRODUCTION_INVARIANTS,
): Promise<ValidationOutcome> {
  await jurisdictionPromptResolver.init();
  const stats = jurisdictionPromptResolver.getStats();

  const failures: string[] = [];
  const perJurisdiction = {} as ValidationOutcome['perJurisdiction'];

  for (const j of SUPPORTED_JURISDICTIONS) {
    const loaded = stats.perJurisdiction[j] ?? 0;
    const expected = invariants.expectedPerJurisdiction[j];
    const ok = loaded === expected;
    perJurisdiction[j] = { loaded, expected, ok };
    if (!ok) {
      failures.push(`jurisdiction=${j}: loaded ${loaded} prompts, expected ${expected}`);
    }
  }

  if (stats.totalPrompts !== invariants.expectedTotal) {
    failures.push(`totalPrompts: loaded ${stats.totalPrompts}, expected ${invariants.expectedTotal}`);
  }

  const outcome: ValidationOutcome = {
    ok: failures.length === 0,
    failures,
    loadedTotal: stats.totalPrompts,
    expectedTotal: invariants.expectedTotal,
    perJurisdiction,
  };

  if (outcome.ok) {
    logger.info({
      msg: 'jurisdiction prompt invariants OK',
      total: stats.totalPrompts,
      cacheMB: (stats.cacheBytes / 1_000_000).toFixed(1),
      perJurisdiction,
    });
  } else {
    logger.error({
      msg: 'jurisdiction prompt invariants FAILED',
      failures,
      perJurisdiction,
    });
  }

  return outcome;
}

/**
 * Boot-time validator — call from gateway entrypoint.
 * In NODE_ENV=production, refuses to start if invariants fail (exit 1).
 * In dev/test, logs the failure but lets the gateway boot for debugging.
 */
export async function enforceJurisdictionPromptInvariants(): Promise<void> {
  const result = await validateJurisdictionPrompts();
  if (result.ok === false) {
    if (process.env.NODE_ENV === 'production') {
      logger.error({
        msg: 'REFUSING TO START: jurisdiction prompt invariants failed in production',
        failures: result.failures,
      });
      process.exit(1);
    } else {
      logger.warn({
        msg: 'jurisdiction prompt invariants failed (dev/test mode — gateway will boot anyway)',
        failures: result.failures,
      });
    }
  }
}
