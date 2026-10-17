/**
 * NV-COURT-MASTER-P0-001 — seed the district-court complex master.
 *
 * Idempotent upsert of the all-India court-complex hierarchy into
 * public.nv_court_complexes from the open `vanga/indian-district-court-judgments`
 * courts.csv (~3,566 complexes / ~714 districts / 36 states/UTs).
 *
 *   Columns (CSV): state_code, state_name, district_code, district_name,
 *                  complex_code, complex_name, court_numbers, flag
 *
 * The CSV is checked in at scripts/data-seeds/courts.csv (CC-attribution open
 * data, ~253 KB). Pass --download to (re)fetch it from the canonical URL; the
 * script prints the sha256 either way so provenance is auditable.
 *
 * The existing jurisdiction master (nv_cnr_prefix_rules / nv_court_jurisdictions
 * / nv_case_type_codes / nv_district_master, seeded by
 * migrations/2026-09-24-nv-jurisdiction-master.sql) is NOT touched — this
 * seeder only writes nv_court_complexes and reports the prefix-rule count as a
 * cross-check.
 *
 * Usage:
 *   npx tsx scripts/jrx-seed-court-master-p0.ts            # seed from checked-in CSV
 *   npx tsx scripts/jrx-seed-court-master-p0.ts --download # refetch CSV first
 *
 * NV-DB-SCRIPT-001: uses makePgSql() (real pg.Pool), never the Neon HTTP driver.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import * as dotenv from 'dotenv';
import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, 'data-seeds', 'courts.csv');
const CSV_URL =
  'https://raw.githubusercontent.com/vanga/indian-district-court-judgments/main/courts.csv';

const REQUIRED_COLUMNS = {
  'public.nv_court_complexes': [
    'state_code', 'state_name', 'district_code', 'district_name',
    'complex_code', 'complex_name', 'court_type', 'court_numbers', 'flag',
  ],
} as const;

interface CsvRow {
  state_code: string;
  state_name: string;
  district_code: string;
  district_name: string;
  complex_code: string;
  complex_name: string;
  court_numbers: string;
  flag: string;
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function ensureCsv(download: boolean): Promise<string> {
  if (download || !existsSync(CSV_PATH)) {
    console.log(`  ⬇ fetching courts.csv from ${CSV_URL} …`);
    const resp = await fetch(CSV_URL);
    if (!resp.ok) {
      throw new Error(`courts.csv download failed: HTTP ${resp.status}`);
    }
    const text = await resp.text();
    writeFileSync(CSV_PATH, text, 'utf8');
    console.log(`  ✓ saved ${CSV_PATH} (${text.length} bytes)`);
  }
  const raw = readFileSync(CSV_PATH, 'utf8');
  console.log(`  ℹ courts.csv sha256=${sha256(raw)}`);
  return raw;
}

function parseRows(raw: string): CsvRow[] {
  const parsed = Papa.parse<CsvRow>(raw, {
    header: true,
    skipEmptyLines: true,
    transform: (v) => (typeof v === 'string' ? v.trim() : v),
  });
  if (parsed.errors.length > 0) {
    // Report the first few parse errors but do not abort on recoverable ones.
    console.warn(`  ⚠ ${parsed.errors.length} CSV parse warnings; first:`, parsed.errors[0]);
  }
  return parsed.data.filter(
    (r) => r.state_code && r.district_code && r.complex_code && r.complex_name,
  );
}

async function main(): Promise<void> {
  const download = process.argv.includes('--download');
  const sql = makePgSql();
  try {
    console.log('NV-COURT-MASTER-P0-001 — seeding nv_court_complexes');
    await assertColumns(sql, './jrx-seed-court-master-p0', REQUIRED_COLUMNS);

    const raw = await ensureCsv(download);
    const rows = parseRows(raw);
    console.log(`  parsed ${rows.length} complex rows from courts.csv`);

    const beforeRows = await sql`SELECT COUNT(*)::int AS n FROM public.nv_court_complexes`;
    const before = Number(beforeRows[0]?.n ?? 0);

    const BATCH = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const params: unknown[] = [];
      const tuples: string[] = [];
      batch.forEach((r, j) => {
        const base = j * 9;
        tuples.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
          `$${base + 6}, 'DC', $${base + 7}, $${base + 8}, $${base + 9})`,
        );
        params.push(
          r.state_code,
          r.district_code,
          r.complex_code,
          r.state_name,
          r.district_name,
          r.complex_name.slice(0, 300),
          (r.court_numbers ?? '').slice(0, 200) || null,
          (r.flag ?? '').slice(0, 8) || null,
          'ecourts_open_data',
        );
      });
      const text =
        `INSERT INTO public.nv_court_complexes
           (state_code, district_code, complex_code, state_name, district_name,
            complex_name, court_type, court_numbers, flag, ssot_source)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (state_code, district_code, complex_code) DO UPDATE
           SET state_name    = EXCLUDED.state_name,
               district_name = EXCLUDED.district_name,
               complex_name  = EXCLUDED.complex_name,
               court_type    = EXCLUDED.court_type,
               court_numbers = EXCLUDED.court_numbers,
               flag          = EXCLUDED.flag,
               ssot_source   = EXCLUDED.ssot_source,
               updated_at    = NOW()`;
      await sql.pool.query(text, params);
      written += batch.length;
      if (written % 2000 === 0 || written === rows.length) {
        console.log(`    … upserted ${written}/${rows.length}`);
      }
    }

    const afterRows = await sql`SELECT COUNT(*)::int AS n FROM public.nv_court_complexes`;
    const after = Number(afterRows[0]?.n ?? 0);
    const states = await sql`SELECT COUNT(DISTINCT state_code)::int AS n FROM public.nv_court_complexes`;
    const districts = await sql`SELECT COUNT(DISTINCT (state_code, district_code))::int AS n FROM public.nv_court_complexes`;

    // Cross-check the existing prefix-rule master is intact (not touched here).
    let prefixCount = -1;
    try {
      const pr = await sql`SELECT COUNT(*)::int AS n FROM public.nv_cnr_prefix_rules`;
      prefixCount = Number(pr[0]?.n ?? 0);
    } catch { /* table optional in some envs */ }

    console.log('');
    console.log('  ── seed summary ─────────────────────────────');
    console.log(`  nv_court_complexes: before=${before} after=${after} (upserted ${written})`);
    console.log(`  distinct states=${Number(states[0]?.n ?? 0)} districts=${Number(districts[0]?.n ?? 0)}`);
    console.log(`  nv_cnr_prefix_rules (unchanged): ${prefixCount}`);
    console.log('  ✓ done');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('./jrx-seed-court-master-p0 failed:', err);
  process.exit(1);
});
