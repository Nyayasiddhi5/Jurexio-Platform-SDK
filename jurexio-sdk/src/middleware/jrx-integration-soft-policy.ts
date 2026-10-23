/**
 * NV Integration Soft Policy (NSP / NYM testing)
 *
 * When enabled for internal Jurexio platform keys (default: NSP, NSPM, NYM),
 * content / agent-allowlist / Gate-8 BLOCK policies are downgraded so integration
 * tests receive full AI outcomes instead of policy-violation / filtered stubs.
 *
 * Auth, audit logging, and secret/PII redaction remain enforced.
 *
 * Enable:
 *   NV_PLATFORM_UAT_BYPASS=1  (already required for platform key fingerprinting)
 *   NV_INTEGRATION_SOFT_POLICY=1  (default ON when UAT bypass is on)
 *   NV_SOFT_POLICY_PLATFORMS=NSP,NSPM,NYM  (optional override)
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { Request } from 'express';
import { createLogger } from '../utils/logger.js';
import {
  NV_PLATFORM_UAT_BYPASS,
  isPlatformUatKey,
  isPlatformUatRequest,
  platformUatLabel,
} from './jrx-platform-uat-bypass.js';

const logger = createLogger('integration-soft-policy');

/** Soft policy is on whenever UAT bypass is on, unless explicitly disabled. */
export const NV_INTEGRATION_SOFT_POLICY =
  process.env.NV_INTEGRATION_SOFT_POLICY === '1' ||
  (process.env.NV_INTEGRATION_SOFT_POLICY !== '0' && NV_PLATFORM_UAT_BYPASS);

const DEFAULT_SOFT_PLATFORMS = ['NSP', 'NSPM', 'NYM'] as const;

function parseSoftPlatforms(): Set<string> {
  const raw = (process.env.NV_SOFT_POLICY_PLATFORMS || DEFAULT_SOFT_PLATFORMS.join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return new Set(raw);
}

const SOFT_PLATFORMS = parseSoftPlatforms();

export interface SoftPolicyStore {
  enabled: boolean;
  platform: string | null;
}

const softPolicyAls = new AsyncLocalStorage<SoftPolicyStore>();

if (NV_INTEGRATION_SOFT_POLICY && NV_PLATFORM_UAT_BYPASS) {
  logger.warn(
    `[SoftPolicy] ENABLED for platforms [${[...SOFT_PLATFORMS].join(', ')}] — ` +
      'agent allowlist, content-policy blocks, and Gate-8 BLOCK replaced with warn/pass-through. ' +
      'Auth/audit/PII/secret redaction remain enforced.',
  );
}

export function isSoftPolicyPlatform(label: string | null | undefined): boolean {
  if (!label) return false;
  return SOFT_PLATFORMS.has(String(label).trim().toUpperCase());
}

/** True when soft policy applies to this raw API key (NSP/NYM UAT fingerprints). */
export function isSoftPolicyKey(rawKey: string | null | undefined): boolean {
  if (!NV_INTEGRATION_SOFT_POLICY || !NV_PLATFORM_UAT_BYPASS || !rawKey) return false;
  if (!isPlatformUatKey(rawKey)) return false;
  return isSoftPolicyPlatform(platformUatLabel(rawKey));
}

/** True when soft policy applies to this Express request. */
export function isSoftPolicyRequest(req: Request | undefined): boolean {
  if (!NV_INTEGRATION_SOFT_POLICY || !req) return false;
  // Prefer ALS (set in sdkGatewayAuth) then fall back to key fingerprint.
  const store = softPolicyAls.getStore();
  if (store) return store.enabled;
  if (!isPlatformUatRequest(req)) return false;
  // Label from header key
  const xApiKey = req.headers?.['x-api-key'];
  let key: string | undefined;
  if (typeof xApiKey === 'string') key = xApiKey.trim();
  else {
    const auth = req.headers?.['authorization'];
    if (typeof auth === 'string') {
      const m = auth.match(/^Bearer\s+(\S+)$/i);
      if (m) key = m[1];
    }
  }
  return isSoftPolicyKey(key);
}

/** Current request soft-policy flag (ALS). Safe outside HTTP (returns false). */
export function isSoftPolicyActive(): boolean {
  if (!NV_INTEGRATION_SOFT_POLICY) return false;
  const store = softPolicyAls.getStore();
  if (store) return store.enabled;
  return false;
}

export function getSoftPolicyPlatform(): string | null {
  return softPolicyAls.getStore()?.platform ?? null;
}

/** Bind soft-policy ALS for the remainder of the request (call before next()). */
export function runWithSoftPolicy<T>(
  enabled: boolean,
  platform: string | null,
  fn: () => T,
): T {
  return softPolicyAls.run({ enabled, platform }, fn);
}

export function softPolicyStatus(): {
  enabled: boolean;
  platforms: string[];
  uatBypass: boolean;
} {
  return {
    enabled: NV_INTEGRATION_SOFT_POLICY && NV_PLATFORM_UAT_BYPASS,
    platforms: [...SOFT_PLATFORMS],
    uatBypass: NV_PLATFORM_UAT_BYPASS,
  };
}
