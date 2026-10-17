/**
 * NV-GRPO-ONLINE-001 — online policy nudge from preference EMA (not weight training).
 *
 * Consumes Redis EMA hashes written by SME feedback / preference pairs and
 * exposes decoding nudges (temperature / prefer-fast) for the LLM orchestrator.
 * Nightly JSONL export remains the offline trainer hand-off; this module is the
 * in-process "intelligence update" that improves cost/speed/quality today.
 *
 * Honest scope: bounded nudges only — NOT GPU weight training.
 */
import { createLogger } from '../utils/logger.js';
import { getEmaBoostSync } from './jrx-sme/jrx-sme-grpo-redis-queue.js';

const logger = createLogger('grpo-online-policy');

export interface GrpoOnlineNudge {
  temperatureDelta: number;
  preferFastModel: boolean;
  preferHighQuality: boolean;
  /** Aggregate |boost| across candidate models — proxy for EMA strength. */
  boostMagnitude: number;
  source: 'ema' | 'cold';
}

const DEFAULT: GrpoOnlineNudge = {
  temperatureDelta: 0,
  preferFastModel: false,
  preferHighQuality: false,
  boostMagnitude: 0,
  source: 'cold',
};

const CANDIDATE_MODELS = [
  'amazon.nova-lite-v1:0',
  'amazon.nova-pro-v1:0',
  'gemini-2.0-flash',
  'qwen/qwen3-235b-a22b',
];

/**
 * Resolve nudge for jurisdiction + taskKind from Redis EMA (nyv:grpo:prefs:*).
 */
export function resolveGrpoOnlineNudge(opts: {
  jurisdiction?: string;
  taskKind?: string;
}): GrpoOnlineNudge {
  if (process.env.NYV_GRPO_ONLINE_POLICY === '0') return DEFAULT;
  const jur = String(opts.jurisdiction || 'IN').toUpperCase();
  const task = String(opts.taskKind || 'legal_research').toLowerCase();
  try {
    let sumAbs = 0;
    let maxBoost = 0;
    for (const model of CANDIDATE_MODELS) {
      const b = getEmaBoostSync(jur, task, model);
      sumAbs += Math.abs(b);
      if (b > maxBoost) maxBoost = b;
    }
    if (sumAbs < 0.005) return DEFAULT;

    // Positive boost → prefer quality / slightly cooler decoding (legal precision)
    // Weak/negative aggregate → prefer fast/cheaper models (cost pillar)
    if (maxBoost >= 0.02) {
      return {
        temperatureDelta: -0.05,
        preferFastModel: false,
        preferHighQuality: true,
        boostMagnitude: sumAbs,
        source: 'ema',
      };
    }
    if (maxBoost <= -0.01) {
      return {
        temperatureDelta: 0.03,
        preferFastModel: true,
        preferHighQuality: false,
        boostMagnitude: sumAbs,
        source: 'ema',
      };
    }
    return {
      temperatureDelta: 0,
      preferFastModel: false,
      preferHighQuality: false,
      boostMagnitude: sumAbs,
      source: 'ema',
    };
  } catch (e: any) {
    logger.warn('grpo_online_nudge_failed', { err: e?.message });
    return DEFAULT;
  }
}
