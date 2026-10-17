/**
 * NV-ENTERPRISE-GOV-DEFAULTS-001 — Enterprise / government pack governance flag policy.
 *
 * Flags listed here default ON when the host is configured as an enterprise pack
 * (`JRX_ENTERPRISE_TIER=1` or `JRX_PACK=enterprise|government`). They remain
 * overrideable via DB overlay or explicit JRX_F_*=0.
 *
 * Deliberate split from FLAG_DEFAULT_ON_IN_NON_DEV:
 *   hitlRegistry     — also default-ON in non-dev (fail-soft registry thresholds)
 *   govMakerChecker  — enterprise-pack ONLY (extra synthesis cost per request)
 */

import type { JrxFeatureFlag } from './jrx-feature-flags.js';

/** Logical flags that flip ON for enterprise / government pack hosts. */
export const ENTERPRISE_PACK_FLAG_DEFAULT_ON: ReadonlySet<JrxFeatureFlag> = new Set([
  'govMakerChecker',
]);

export function isEnterprisePackHost(): boolean {
  const tier = (process.env.JRX_ENTERPRISE_TIER ?? '').trim().toLowerCase();
  const pack = (process.env.JRX_PACK ?? '').trim().toLowerCase();
  return (
    tier === '1' ||
    tier === 'true' ||
    tier === 'yes' ||
    pack === 'enterprise' ||
    pack === 'government'
  );
}

export function shouldDefaultOnEnterprisePack(logical: JrxFeatureFlag): boolean {
  if (!ENTERPRISE_PACK_FLAG_DEFAULT_ON.has(logical)) return false;
  return isEnterprisePackHost();
}

/** Snapshot for admin surfaces — which enterprise defaults are active on this host. */
export function getEnterpriseGovernanceDefaultSnapshot(): {
  enterprisePackHost: boolean;
  flags: Record<string, { defaultOn: boolean; env: string }>;
} {
  const flags: Record<string, { defaultOn: boolean; env: string }> = {};
  for (const k of ENTERPRISE_PACK_FLAG_DEFAULT_ON) {
    flags[k] = {
      defaultOn: shouldDefaultOnEnterprisePack(k),
      env:
        k === 'govMakerChecker'
          ? 'JRX_F_GOV_MAKER_CHECKER (enterprise pack default)'
          : `JRX_F_${String(k).replace(/([A-Z])/g, '_$1').toUpperCase()}`,
    };
  }
  return { enterprisePackHost: isEnterprisePackHost(), flags };
}
