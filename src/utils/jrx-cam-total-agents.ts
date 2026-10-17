/** Prefer live registry count (164) over empty nv_agents rows. */
export function resolveCamTotalAgents(dbCount: number, registryCount: number): number {
  if (Number.isFinite(registryCount) && registryCount > 0) return registryCount;
  return Number.isFinite(dbCount) && dbCount > 0 ? dbCount : 0;
}
