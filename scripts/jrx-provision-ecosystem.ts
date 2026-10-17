/**
 * Provision the 5 Nyayasiddhi-ecosystem SDK apps + keys from the platform
 * access matrix.
 *
 * Idempotent — re-running is safe. Operates against the production
 * `nv_sdk_applications` + `nv_api_keys` tables (raw SQL, no drizzle dep)
 * because the legacy `shared/schema.ts` `sdkApplications` definition does
 * NOT correspond to the runtime tables (those are nv_-prefixed and only
 * defined in src/db/migrations/*).
 *
 * Usage:
 *   npx tsx scripts/jrx-provision-ecosystem.ts \
 *     --matrix config/platforms/platform-access-matrix.json
 *
 * Optional flags:
 *   --rotate            Issue and persist a fresh live+test key pair for each
 *                       platform (old keys are marked revoked, atomic per-app).
 *   --expires-days=365  Override default key TTL (default 365d from now).
 *   --dry-run           Print what would happen, do nothing.
 *   --print-raw-keys    Print rotated raw keys to stdout. OFF by default to
 *                       prevent secret leakage into CI/centralized logs. Only
 *                       use this in a controlled manual session, then copy keys
 *                       directly into your secrets manager.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Client } from 'pg';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

type PlatformDef = {
  code: string;
  displayName: string;
  tier: string;
  jurisdictions: string[];
  modules: Record<string, boolean>;
  apiKeyEnvVar: string;
  webhookEnvVar?: string;
};

type Matrix = {
  version: string;
  keyFormat: string;
  platforms: Record<string, PlatformDef>;
};

// Map matrix platform code -> short suffix used in nyv_<env>_sk_<suffix>_...
// keys and matches the seeded ecosystem rows.
const CODE_TO_SUFFIX: Record<string, string> = {
  NYM: 'nym',
  'NYS-PRO': 'nsp',
  'NYS-INS': 'nsi',
  'NYS-ACE': 'nsa',
  'NYS-MIN': 'nsm',
};

function generateApiKey(env: 'live' | 'test', suffix: string): { raw: string; hash: string; prefix: string } {
  const tail = randomBytes(30).toString('base64url').replace(/[-_]/g, '').slice(0, 32);
  const raw = `nyv_${env}_sk_${suffix}_${tail}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  // store first 17 chars + '...' = exactly 20 chars; the column is varchar(20).
  const prefix = `${raw.slice(0, 17)}...`;
  return { raw, hash, prefix };
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < process.argv.length - 2; i++) {
    const v = process.argv[i + 2];
    if (!v.startsWith('--')) continue;
    const eq = v.indexOf('=');
    if (eq > -1) {
      out[v.slice(2, eq)] = v.slice(eq + 1);
    } else {
      const next = process.argv[i + 3];
      if (next && !next.startsWith('--')) {
        out[v.slice(2)] = next;
      } else {
        out[v.slice(2)] = 'true';
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const matrixPath = args.matrix ?? 'config/platforms/platform-access-matrix.json';
  const dryRun = args['dry-run'] === 'true';
  const rotate = args.rotate === 'true';
  const printRawKeys = args['print-raw-keys'] === 'true';
  const expiresDays = parseInt(args['expires-days'] ?? '365', 10);

  const matrix: Matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf-8'));
  const platforms = Object.entries(matrix.platforms);
  console.log(`[provision-ecosystem] loaded ${platforms.length} platforms from ${matrixPath}`);
  console.log(`[provision-ecosystem] dryRun=${dryRun} rotate=${rotate} expiresDays=${expiresDays} printRawKeys=${printRawKeys}`);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[provision-ecosystem] DATABASE_URL not set; aborting.');
    process.exit(2);
  }

  const client = new Client({ connectionString: normalizePgConnectionString(dbUrl) });
  await client.connect();

  const expiresAt = new Date(Date.now() + expiresDays * 24 * 3600 * 1000);
  const out: Array<{ platform: string; appId: string; provisioned: boolean; rotated?: boolean; live?: string; test?: string }> = [];

  try {
    for (const [platformId, def] of platforms) {
      const suffix = CODE_TO_SUFFIX[def.code];
      if (!suffix) {
        console.warn(`[provision-ecosystem] SKIP ${platformId}: no key-prefix mapping for code=${def.code}`);
        continue;
      }

      // Locate the seeded SDK app via its associated key prefix.
      // Strict resolver: require EXACTLY one match. Multiple matches indicate
      // ambiguous seed state (would otherwise rotate the wrong app's keys).
      const found = await client.query<{ id: string; name: string; is_provisioned: boolean }>(
        `SELECT a.id, a.name, a.is_provisioned
           FROM nv_sdk_applications a
           JOIN nv_api_keys k ON k.app_id = a.id
          WHERE k.key_prefix LIKE $1
          GROUP BY a.id, a.name, a.is_provisioned`,
        [`nyv_live_sk_${suffix}_%`],
      );

      if (found.rows.length === 0) {
        console.warn(`[provision-ecosystem] SKIP ${platformId}: no nv_sdk_applications row found for key prefix nyv_live_sk_${suffix}_*`);
        continue;
      }
      if (found.rows.length > 1) {
        const ids = found.rows.map((r) => r.id).join(', ');
        throw new Error(
          `[provision-ecosystem] ABORT ${platformId}: ${found.rows.length} apps match key prefix nyv_live_sk_${suffix}_* (apps: ${ids}). ` +
          `Refusing to provision/rotate to avoid mutating the wrong app. Resolve seed ambiguity first.`,
        );
      }

      const row = found.rows[0];
      const wasAlreadyProvisioned = row.is_provisioned;

      let rotated = false;
      let liveRaw: string | undefined;
      let testRaw: string | undefined;

      // ── ATOMIC per-app: provisioning + (optional) rotation in a single TX.
      // If anything fails partway, rollback so a partner is never left with
      // zero active keys.
      if (!dryRun) {
        try {
          await client.query('BEGIN');

          // 1) flip is_provisioned + sync modules + key TTL.
          await client.query(
            `UPDATE nv_sdk_applications
                SET is_provisioned = TRUE,
                    modules_enabled = $1::jsonb,
                    key_expires_at = $2,
                    display_name = COALESCE(display_name, $3),
                    updated_at = NOW()
              WHERE id = $4`,
            [JSON.stringify(def.modules), expiresAt, def.displayName, row.id],
          );

          // 2) optional rotation: revoke + insert new live + test, all atomic.
          if (rotate) {
            const live = generateApiKey('live', suffix);
            const test = generateApiKey('test', suffix);
            await client.query(
              `UPDATE nv_api_keys SET is_active=FALSE
                WHERE app_id=$1 AND is_active=TRUE`,
              [row.id],
            );
            for (const k of [live, test] as const) {
              await client.query(
                `INSERT INTO nv_api_keys (app_id, key_prefix, key_hash, name, permissions, key_type, is_active)
                 VALUES ($1, $2, $3, $4, $5::text[], $6, TRUE)`,
                [
                  row.id,
                  k.prefix,
                  k.hash,
                  `${def.displayName} — ${k === live ? 'Live' : 'Sandbox'} (rotated ${new Date().toISOString().slice(0, 10)})`,
                  ['*'],
                  k === live ? 'sdk_live' : 'sdk_test',
                ],
              );
            }
            rotated = true;
            liveRaw = live.raw;
            testRaw = test.raw;
          }

          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw new Error(
            `[provision-ecosystem] ROLLED BACK ${platformId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (rotate) {
        // dry-run: still generate raw keys for visibility, but persist nothing.
        const live = generateApiKey('live', suffix);
        const test = generateApiKey('test', suffix);
        rotated = true;
        liveRaw = live.raw;
        testRaw = test.raw;
      }

      out.push({ platform: platformId, appId: row.id, provisioned: !wasAlreadyProvisioned, rotated, live: liveRaw, test: testRaw });
      console.log(
        `[provision-ecosystem] ${dryRun ? 'DRY' : 'OK '} ${platformId.padEnd(20)} appId=${row.id} provisioned=${!wasAlreadyProvisioned ? 'NOW' : 'already'} ${rotated ? '(keys rotated)' : ''}`,
      );
    }
  } finally {
    await client.end();
  }

  // 3) write provisioning receipt.
  const receiptDir = path.join('config', 'platforms');
  if (!dryRun) {
    fs.mkdirSync(receiptDir, { recursive: true });
    fs.writeFileSync(
      path.join(receiptDir, '.last-provision.json'),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          matrixVersion: matrix.version,
          expiresAt: expiresAt.toISOString(),
          rotate,
          results: out.map(({ live, test, ...r }) => r), // never persist raw keys
        },
        null,
        2,
      ),
    );
  }

  console.log(`\n[provision-ecosystem] DONE — ${out.length} platforms processed.`);
  if (rotate && out.some((r) => r.live)) {
    if (printRawKeys) {
      console.log(
        `\n[provision-ecosystem] !!! ROTATED RAW KEYS (copy NOW into your secrets manager — they will not be shown again) !!!`,
      );
      for (const r of out) {
        if (r.live) console.log(`  ${r.platform.padEnd(20)} LIVE: ${r.live}`);
        if (r.test) console.log(`  ${r.platform.padEnd(20)} TEST: ${r.test}`);
      }
    } else {
      console.log(
        `\n[provision-ecosystem] Keys rotated. Raw keys NOT printed (use --print-raw-keys to display, ONLY in controlled manual sessions).`,
      );
      for (const r of out) {
        if (r.live) console.log(`  ${r.platform.padEnd(20)} LIVE: ${r.live.slice(0, 16)}…[redacted]`);
        if (r.test) console.log(`  ${r.platform.padEnd(20)} TEST: ${r.test.slice(0, 16)}…[redacted]`);
      }
      console.log(
        `\n[provision-ecosystem] To retrieve raw keys: re-run with --rotate --print-raw-keys (rotation will issue NEW keys; old ones already revoked).`,
      );
    }
  }
}

main().catch((e) => {
  console.error('[provision-ecosystem] FAILED', e);
  process.exit(1);
});
