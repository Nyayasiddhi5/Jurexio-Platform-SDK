/**
 * NV-BETA-QUALITY-FIRST-001 — Beta cred over cost: generous completion budgets
 * and no sub-8k floors on partner AI until RAG/memory carry repeatable truth.
 *
 * Env: JRX_BETA_QUALITY_FIRST=1|0 (unset → feature flag `betaQualityFirst`).
 */

import { isJrxFeatureOn } from './jrx-feature-flags.js';

function envOn(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envOff(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

/** Beta quality-first mode (default ON in non-dev via JRX_F_BETA_QUALITY_FIRST). */
export function isBetaQualityFirst(): boolean {
  if (envOff('JRX_BETA_QUALITY_FIRST')) return false;
  if (envOn('JRX_BETA_QUALITY_FIRST')) return true;
  return isJrxFeatureOn('betaQualityFirst');
}

function envToken(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(128_000, Math.max(512, Math.floor(n))) : fallback;
}

/** Partner-wide maxTokens floor when beta quality is on (non-NSP included). */
export function betaPartnerMaxTokensFloor(): number {
  return envToken('JRX_BETA_PARTNER_MAX_TOKENS_FLOOR', 16_384);
}

export function betaPartnerChatFastFloor(): number {
  return envToken('JRX_BETA_PARTNER_MAX_TOKENS_CHAT_FAST', 4_096);
}

export function betaPartnerChatFloor(): number {
  return envToken('JRX_BETA_PARTNER_MAX_TOKENS_CHAT', 16_384);
}

export function betaPartnerFastFloor(): number {
  return envToken('JRX_BETA_PARTNER_MAX_TOKENS_FAST', 8_192);
}

export function betaPartnerDraftFastFloor(): number {
  return envToken('JRX_BETA_PARTNER_MAX_TOKENS_DRAFT_FAST', 16_384);
}

/** Medium-tier draft SLA cap under beta — use registry default up to this rail. */
export function betaDraftFastSlaMediumCeiling(): number {
  return envToken('JRX_BETA_DRAFT_FAST_SLA_MAX_TOKENS', 16_384);
}

export function betaQueenLeafMaxTokensFast(): number {
  return envToken('JRX_BETA_QUEEN_LEAF_MAX_TOKENS_FAST', 16_384);
}

export function betaStructureCheckerMaxTokensFast(): number {
  return envToken('JRX_BETA_DRAFT_STRUCTURE_CHECKER_MAX_TOKENS', 4_096);
}

export function betaStructureCheckerMaxTokensCounsel(): number {
  return envToken('JRX_BETA_DRAFT_STRUCTURE_CHECKER_COUNSEL_MAX_TOKENS', 8_192);
}

export function betaCompletionLoopMaxSegments(): number {
  return envToken('JRX_BETA_COMPLETION_MAX_SEGMENTS', 4);
}

export function betaCompletionSegmentMaxTokens(): number {
  return envToken('JRX_BETA_COMPLETION_SEGMENT_MAX_TOKENS', 16_384);
}
