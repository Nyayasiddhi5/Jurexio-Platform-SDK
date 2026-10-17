#!/usr/bin/env tsx
/**
 * NV-VERIFY-ENV-PARITY (T6, 2026-05-07)
 *
 * SCOPE (what this script ACTUALLY checks — narrowed 2026-05-07T16:30Z per
 * architect review):
 *
 *   1. **Replit dev (this process)** — checks that every key in
 *      REQUIRED_KEYS (with alias resolution) is set in `process.env` and
 *      reports a sha256-prefix fingerprint per key (no secret leak). This is
 *      a TRUE in-process attestation.
 *
 *   2. **Replit publish** — only a domain ANNOTATION. We do NOT cross-check
 *      that the published instance has the same key set, because we cannot
 *      introspect a published process's `process.env` from here. If
 *      `REPLIT_PUBLISH_DOMAIN` is set we probe `/api/jrx/health` to confirm
 *      it responds; otherwise we skip with a note. **This is not a parity
 *      check, it is a liveness check.** Exit code is NOT influenced by the
 *      publish env when REPLIT_PUBLISH_DOMAIN is absent.
 *
 *   3. **EC2 prod (api.nyayasiddhi.online)** — probes `/api/jrx/health` for
 *      liveness + version, then validates each of the 7 SDK keys by sending
 *      them as `X-API-Key` against `/api/jrx/gateway/health` (the gateway
 *      health route is the cheapest authed endpoint that exercises the
 *      tenant-isolation + key-validation middleware end-to-end). HTTP 200
 *      = the EC2 RDS recognises the same SDK key the Replit Secrets vault
 *      holds. This is a real parity check on the SDK-key plane. It does
 *      NOT enumerate EC2's full `process.env` (we have no SSH/SSM hook
 *      here).
 *
 * Exit codes:
 *   0 = (a) all required keys set in this process AND (b) EC2 health green
 *       AND (c) all 7 SDK keys validate 200 against EC2.
 *   1 = any of the above fails.
 *
 * For full 3-env env-var enumeration (including EC2's `/opt/nyayavigya/secrets/.env.production`),
 * use the SSM-driven `scripts/jrx-deep-env-diff.sh` (separate, requires AWS creds).
 *
 * Usage:
 *   tsx scripts/jrx-verify-env-parity.ts
 *   tsx scripts/jrx-verify-env-parity.ts --json  # machine-readable
 */

/**
 * Some keys have legacy aliases that are still accepted by the resolvers.
 * The verifier treats a key as "set" if ANY of [canonical, ...aliases] is set.
 */
const REQUIRED_KEY_ALIASES: Record<string, string[]> = {
  NYV_DATABASE_URL: ['DATABASE_URL'],                           // Drizzle/Neon also reads DATABASE_URL
  NYV_REDIS_TCP_URL: ['NYV_REDIS_WRITE_URL', 'REDIS_URL', 'NYV_REDIS_URL'], // NV-SECRETS-001 legacy
};

const REQUIRED_KEYS = [
  // Datastores
  'NYV_DATABASE_URL',
  'NYV_REDIS_TCP_URL',
  // Auth
  'NYV_JWT_SECRET',
  'NYV_JWT_REFRESH_SECRET',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  // SDK keys (vault canonical, must be byte-identical across all 3 envs)
  'NYV_SDK_KEY_NSP',
  'NYV_SDK_KEY_NSPM',
  'NYV_SDK_KEY_NSI',
  'NYV_SDK_KEY_NSA',
  'NYV_SDK_KEY_NSM',
  'NYV_SDK_KEY_NYM',
  'NYV_SDK_KEY_JRX',
  // LLM providers (≥1 of these must be set)
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  // Storage
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

const OPTIONAL_KEYS = [
  'NYV_REDIS_READ_URL',
  'NYV_REDIS_WRITE_URL', // legacy alias — soft-deprecated
  'REDIS_URL',           // legacy alias — soft-deprecated
  'NYV_REDIS_URL',       // legacy alias — soft-deprecated
  'SARVAM_API_KEY',
  'NYV_EC2_INSTANCE_ID',
  'DEFAULT_OBJECT_STORAGE_BUCKET_ID',
  'PUBLIC_OBJECT_SEARCH_PATHS',
  'PRIVATE_OBJECT_DIR',
  'NYV_STORAGE_BACKEND',
  'BITBUCKET_USERNAME',
  'BITBUCKET_APP_PASSWORD',
] as const;

interface ProbeResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  body?: any;
}

async function probe(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  try {
    const r = await fetch(url, { headers });
    const txt = await r.text();
    let body: any = txt;
    try { body = JSON.parse(txt); } catch { /* keep raw */ }
    return { url, ok: r.ok, status: r.status, body };
  } catch (e: any) {
    return { url, ok: false, error: e?.message };
  }
}

import { createHash } from 'crypto';
function maskHash(value: string | undefined): string {
  if (!value) return '(unset)';
  // Print only sha256 first-12 to allow byte-equality compare without leaking secret
  return createHash('sha256').update(value).digest('hex').slice(0, 12) + '…';
}

async function main() {
  const json = process.argv.includes('--json');
  const report: any = {
    generatedAt: new Date().toISOString(),
    environments: {} as Record<string, any>,
  };

  // 1. Local / Cursor dev — this process
  const resolveKey = (k: string): { value: string | undefined; from: string | null } => {
    if (process.env[k]) return { value: process.env[k], from: k };
    for (const alias of REQUIRED_KEY_ALIASES[k] || []) {
      if (process.env[alias]) return { value: process.env[alias], from: alias };
    }
    return { value: undefined, from: null };
  };
  report.environments['local-dev'] = {
    label: 'Local / Cursor dev (this process)',
    domain: process.env.NYV_DEV_DOMAIN || 'localhost:5000',
    requiredKeysSet: REQUIRED_KEYS.map((k) => {
      const r = resolveKey(k);
      return {
        key: k,
        set: !!r.value,
        resolvedFrom: r.from,
        sha256Prefix: r.value ? maskHash(r.value) : null,
      };
    }),
    optionalKeysSet: OPTIONAL_KEYS.map((k) => ({
      key: k,
      set: !!process.env[k],
    })),
  };

  // 2. Public deploy — probe known EC2/public domain (if configured)
  const publicDeployHost = process.env.NYV_PUBLIC_API_URL?.replace(/^https?:\/\//, '') || process.env.NYV_GATEWAY_URL?.replace(/^https?:\/\//, '');
  if (publicDeployHost) {
    const p = await probe(`https://${publicDeployHost}/api/jrx/health`);
    report.environments['public-deploy'] = {
      label: 'Public EC2 deploy',
      domain: publicDeployHost,
      health: p.ok ? 'healthy' : 'unhealthy',
      status: p.status,
      version: p.body?.version,
    };
  } else {
    report.environments['public-deploy'] = {
      label: 'Public EC2 deploy',
      note: 'NYV_PUBLIC_API_URL / NYV_GATEWAY_URL not set; cannot probe public deploy URL',
    };
  }

  // 3. EC2 prod — probe api.nyayasiddhi.online
  const ec2Host = process.env.NYV_EC2_API_HOST || 'api.nyayasiddhi.online';
  const ec2Health = await probe(`https://${ec2Host}/api/jrx/health`);
  const ec2KeyChecks: Record<string, any> = {};
  for (const platform of ['NSP', 'NSI', 'NSA', 'NSM', 'NYM', 'NSPM', 'JRX']) {
    const key = process.env[`NYV_SDK_KEY_${platform}`];
    if (!key) { ec2KeyChecks[platform] = { skipped: 'key not set in this env' }; continue; }
    const p = await probe(`https://${ec2Host}/api/jrx/gateway/health`, { 'X-API-Key': key });
    ec2KeyChecks[platform] = { status: p.status, ok: p.ok };
  }
  report.environments['ec2-prod'] = {
    label: 'EC2 prod (api.nyayasiddhi.online)',
    domain: ec2Host,
    health: ec2Health.ok ? 'healthy' : 'unhealthy',
    status: ec2Health.status,
    version: ec2Health.body?.version,
    sdkKeyValidation: ec2KeyChecks,
  };

  // 4. Drift detection
  const drift: string[] = [];
  for (const k of REQUIRED_KEYS) {
    const r = resolveKey(k);
    if (!r.value) drift.push(`MISSING in replit-dev: ${k} (also checked aliases: ${(REQUIRED_KEY_ALIASES[k] || []).join(', ') || 'none'})`);
  }
  const ec2KeyFails = Object.entries(ec2KeyChecks)
    .filter(([_, v]: any) => v.status !== undefined && v.status !== 200)
    .map(([p]) => `EC2 SDK key ${p} not validating (HTTP ${(ec2KeyChecks as any)[p].status})`);
  drift.push(...ec2KeyFails);
  if (!ec2Health.ok) drift.push(`EC2 health unreachable (status=${ec2Health.status})`);

  report.drift = drift;
  report.parity = drift.length === 0 ? 'PASS' : 'FAIL';

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  NV ENV PARITY MATRIX');
    console.log('  generated:', report.generatedAt);
    console.log('═══════════════════════════════════════════════════════════');
    for (const [envId, env] of Object.entries(report.environments) as any) {
      console.log(`\n[${envId}] ${env.label}`);
      if (env.domain) console.log(`  domain  : ${env.domain}`);
      if (env.health) console.log(`  health  : ${env.health}${env.status ? ` (HTTP ${env.status})` : ''}${env.version ? ` v${env.version}` : ''}`);
      if (env.requiredKeysSet) {
        const missing = env.requiredKeysSet.filter((k: any) => !k.set);
        console.log(`  required: ${env.requiredKeysSet.length - missing.length}/${env.requiredKeysSet.length} set${missing.length ? '  MISSING: ' + missing.map((m: any) => m.key).join(', ') : ''}`);
      }
      if (env.sdkKeyValidation) {
        for (const [plat, v] of Object.entries(env.sdkKeyValidation) as any) {
          console.log(`  SDK ${plat.padEnd(5)}: ${v.skipped || `HTTP ${v.status}`}`);
        }
      }
      if (env.note) console.log(`  note    : ${env.note}`);
    }
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  PARITY: ${report.parity}`);
    if (drift.length) {
      console.log('  Drift detected:');
      for (const d of drift) console.log(`    • ${d}`);
    }
    console.log('═══════════════════════════════════════════════════════════');
  }

  process.exit(report.parity === 'PASS' ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
