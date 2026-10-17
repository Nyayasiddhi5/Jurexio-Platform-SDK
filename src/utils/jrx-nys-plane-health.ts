/**
 * Classify NYS knowledge-plane health for /health/full.
 * Embed coverage is a multi-week backfill SLO — it must not flip the plane
 * to degraded when NYS /healthz is reachable (search/FTS already live).
 */
export type NysPlaneHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'not_configured';

export interface NysPlaneHealthInput {
  flagOn: boolean;
  configured: boolean;
  probeOk: boolean;
  probeError?: string;
  embeddingSloStatus?: string;
}

export interface NysPlaneHealthResult {
  status: NysPlaneHealthStatus;
  details: string;
}

export function resolveNysPlaneHealth(input: NysPlaneHealthInput): NysPlaneHealthResult {
  if (!input.flagOn) {
    return { status: 'not_configured', details: 'JRX_F_JRX_ECOSYSTEM_KNOWLEDGE_PLANE off' };
  }
  if (!input.configured) {
    return { status: 'not_configured', details: 'JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL not set' };
  }
  if (!input.probeOk) {
    return {
      status: 'degraded',
      details: input.probeError || 'NYS knowledge plane unreachable',
    };
  }
  const slo = input.embeddingSloStatus;
  const sloNote =
    slo && slo !== 'ok'
      ? ` (caselaw embed SLO ${slo} — backfill, not a plane outage)`
      : '';
  return {
    status: 'healthy',
    details: `NYS knowledge plane reachable${sloNote}`,
  };
}
