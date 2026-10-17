/**
 * NV-LLM-COST-PROFILE-001 — production cost-first Bedrock routing profile.
 *
 * Opt-in via NYV_LLM_COST_PROFILE=cost-first | production-cost
 * Default OFF so local dev and jrx-staging demo routing stay unchanged unless set.
 */

export function isLlmCostProfileActive(): boolean {
  const v = String(process.env.NYV_LLM_COST_PROFILE ?? '').trim().toLowerCase();
  return v === 'cost-first' || v === 'production-cost' || v === 'production_cost';
}

/** Secret-free snapshot for health / admin describe endpoints. */
export function describeLlmCostProfile(): Record<string, unknown> {
  const active = isLlmCostProfileActive();
  return {
    active,
    profile: process.env.NYV_LLM_COST_PROFILE ?? null,
    bedrockRegionOrder: active ? ['ap-south-1', 'us-east-1'] : 'default (us-east-1, ap-south-1)',
    ladderCostFirst: active ? true : String(process.env.NYV_LADDER_COST_FIRST ?? '1') !== '0',
  };
}
