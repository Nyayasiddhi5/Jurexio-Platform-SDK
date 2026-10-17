/**
 * scripts/jrx-seed-firm-snapshot-demo.ts — Task #337 (2026-05-13)
 *
 * Idempotent dev seeder for the Console Intelligence Dashboard's
 * firm-snapshot fetch (`GET /api/jrx/v1/sdk/intelligence/firm-snapshot`).
 *
 * The handler at src/routes/jrx-sdk-intelligence-routes.ts:1568 derives:
 *   • active_cases       ← nv_cases (organization_id, status NOT IN closed/dismissed/disposed)
 *   • pending_hearings   ← nv_hearing_metadata (case_number ∈ org cases, future, ≤ 7d)
 *   • overdue_tasks      ← nv_hearing_metadata (case_number ∈ org cases, past, !order_passed)
 *   • revenue_ytd_inr    ← nv_invoices (org_id::text, status='COMPLETED', paid_at ≥ Jan-1)
 * scoped to sdkContext.organizationId, which the JWT-bypass defaults to 1
 * for INTERNAL_JWT_ROLES.
 *
 * Without these rows, the dashboard renders "Demo Firm (org_id=1)" with
 * all zeros. This seeder writes a small, deterministic demo dataset for
 * org_id = 1 so the dashboard has real numbers to display in dev/UAT.
 *
 * Idempotent: every INSERT uses ON CONFLICT DO NOTHING keyed on a stable
 * synthetic identifier. Safe to run on every gateway boot.
 *
 * NV-DB-SCRIPT-001: uses makePgSql() (postgres-js TCP), not the neon
 * HTTP driver, so writes actually persist on RDS / standard Postgres.
 *
 * Production guard: callers must not invoke this in production. The
 * exported `seedFirmSnapshotDemo()` enforces NODE_ENV !== 'production'
 * itself; the standalone CLI does too.
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_cases': [
    'case_number', 'title', 'case_type', 'jurisdiction', 'court_name',
    'status', 'organization_id',
  ],
  'public.nv_hearing_metadata': [
    'case_number', 'court_name', 'hearing_date', 'hearing_type', 'order_passed',
  ],
  'public.nv_invoices': [
    'user_id', 'org_id', 'invoice_number', 'amount_in_paise', 'currency',
    'status', 'period_start', 'period_end', 'paid_at',
  ],
} as const;

const ORG_ID = 1;
const ORG_ID_STR = String(ORG_ID);

interface SeedResult {
  skipped: boolean;
  reason?: string;
  inserted: { cases: number; hearings: number; invoices: number };
}

const DEMO_CASES = [
  { case_number: 'NV-DEMO-2026-0001', title: 'Sharma v. Apex Constructions',         case_type: 'civil',     court_name: 'Bombay High Court',     status: 'open' },
  { case_number: 'NV-DEMO-2026-0002', title: 'In re: Patel Estate (Probate)',        case_type: 'probate',   court_name: 'Delhi High Court',      status: 'open' },
  { case_number: 'NV-DEMO-2026-0003', title: 'Verma Industries v. CCI',              case_type: 'regulatory',court_name: 'NCLAT',                 status: 'in_progress' },
  { case_number: 'NV-DEMO-2026-0004', title: 'State v. Khan (Bail Application)',     case_type: 'criminal',  court_name: 'Sessions Court, Mumbai',status: 'open' },
  { case_number: 'NV-DEMO-2026-0005', title: 'Iyer v. NextGen Software (IP)',        case_type: 'ip',        court_name: 'Madras High Court',     status: 'open' },
  { case_number: 'NV-DEMO-2026-0006', title: 'GreenLeaf Pharma DPDP Notice Response',case_type: 'compliance',court_name: 'DPB',                   status: 'in_progress' },
  { case_number: 'NV-DEMO-2026-0007', title: 'Old Closed Matter — Banerjee v. ACME', case_type: 'civil',     court_name: 'Calcutta High Court',   status: 'closed' },
];

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 24 * 3600 * 1000);
}

const DEMO_HEARINGS: Array<{ case_number: string; offset_days: number; order_passed: boolean; type: string }> = [
  { case_number: 'NV-DEMO-2026-0001', offset_days:  2,  order_passed: false, type: 'arguments'   },
  { case_number: 'NV-DEMO-2026-0002', offset_days:  4,  order_passed: false, type: 'evidence'    },
  { case_number: 'NV-DEMO-2026-0003', offset_days:  6,  order_passed: false, type: 'final'       },
  { case_number: 'NV-DEMO-2026-0004', offset_days: -3,  order_passed: false, type: 'bail'        },
  { case_number: 'NV-DEMO-2026-0005', offset_days: -8,  order_passed: false, type: 'mention'     },
  { case_number: 'NV-DEMO-2026-0006', offset_days: 11,  order_passed: false, type: 'reply'       },
  { case_number: 'NV-DEMO-2026-0001', offset_days: -12, order_passed: true,  type: 'IA-disposed' },
];

const DEMO_INVOICES = [
  { invoice_number: 'NV-DEMO-INV-2026-Q1-001', amount_in_paise: 18_50_00_00, paid_offset_days: -85 },
  { invoice_number: 'NV-DEMO-INV-2026-Q1-002', amount_in_paise:  9_75_00_00, paid_offset_days: -55 },
  { invoice_number: 'NV-DEMO-INV-2026-Q2-003', amount_in_paise: 12_30_00_00, paid_offset_days: -22 },
  { invoice_number: 'NV-DEMO-INV-2026-Q2-004', amount_in_paise:  6_45_00_00, paid_offset_days:  -8 },
];

export async function seedFirmSnapshotDemo(opts: { quiet?: boolean } = {}): Promise<SeedResult> {
  const log = (msg: string) => { if (!opts.quiet) console.log(msg); };

  if (process.env.NODE_ENV === 'production') {
    return { skipped: true, reason: 'NODE_ENV=production', inserted: { cases: 0, hearings: 0, invoices: 0 } };
  }

  const sql = makePgSql();

  // nv_cases is created by the platform's drizzle migrations. The other two
  // (nv_hearing_metadata, nv_invoices) are also drizzle-defined but on this
  // dev environment they aren't always provisioned, so create idempotent
  // shims that match the canonical column shapes from
  //   drizzle/0000_even_red_skull.sql:350 (nv_hearing_metadata)
  //   drizzle/0000_even_red_skull.sql:435 (nv_invoices)
  // The CREATE TABLE IF NOT EXISTS is a no-op when the real migration has
  // already run, so we never fight drizzle.
  await sql`
    CREATE TABLE IF NOT EXISTS nv_hearing_metadata (
      id              serial PRIMARY KEY,
      case_update_id  integer,
      case_number     varchar(200) NOT NULL,
      court_name      varchar(300),
      hearing_date    timestamp NOT NULL,
      hearing_type    varchar(100),
      judges          text[] DEFAULT '{}',
      advocates       text[] DEFAULT '{}',
      hearing_notes   text,
      order_passed    boolean DEFAULT false,
      order_summary   text,
      next_date       timestamp,
      metadata        jsonb DEFAULT '{}'::jsonb,
      created_at      timestamp DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS nv_invoices (
      id               serial PRIMARY KEY,
      user_id          varchar(100) NOT NULL,
      org_id           varchar(100),
      invoice_number   varchar(100) NOT NULL UNIQUE,
      subscription_id  integer,
      amount_in_paise  integer NOT NULL,
      currency         varchar(3) DEFAULT 'INR',
      status           varchar(40) DEFAULT 'PENDING',
      period_start     timestamp,
      period_end       timestamp,
      line_items       jsonb DEFAULT '[]'::jsonb,
      tax_breakdown    jsonb DEFAULT '{}'::jsonb,
      pdf_url          text,
      gst_number       varchar(20),
      billing_address  jsonb DEFAULT '{}'::jsonb,
      created_at       timestamp DEFAULT now(),
      paid_at          timestamp
    )
  `;

  // Defensive: bail cleanly if even after the IF-NOT-EXISTS shim the tables
  // can't be reached (permissions, schema search_path drift, …).
  const present = await sql`
    SELECT
      to_regclass('public.nv_cases')             AS c,
      to_regclass('public.nv_hearing_metadata')  AS h,
      to_regclass('public.nv_invoices')          AS i
  `;
  const r = present?.[0] as { c: string | null; h: string | null; i: string | null } | undefined;
  if (!r?.c || !r?.h || !r?.i) {
    log(`[seed-firm-snapshot] tables not provisioned (cases=${r?.c}, hearings=${r?.h}, invoices=${r?.i}) — skipped`);
    try { await (sql as any).end?.(); } catch { /* ignore */ }
    return { skipped: true, reason: 'tables_missing', inserted: { cases: 0, hearings: 0, invoices: 0 } };
  }
  await assertColumns(sql, './jrx-seed-firm-snapshot-demo', REQUIRED_COLUMNS);

  let cases = 0; let hearings = 0; let invoices = 0;
  try {
    for (const c of DEMO_CASES) {
      // No UNIQUE constraint on nv_cases.case_number on this dev DB, so we
      // can't use ON CONFLICT — emulate idempotence with INSERT … SELECT
      // WHERE NOT EXISTS, which is also race-safe enough for a dev seeder.
      const res = await sql`
        INSERT INTO nv_cases
          (case_number, title, case_type, jurisdiction, court_name, status, organization_id)
        SELECT ${c.case_number}, ${c.title}, ${c.case_type}, 'IN',
               ${c.court_name}, ${c.status}, ${ORG_ID}
         WHERE NOT EXISTS (
           SELECT 1 FROM nv_cases
            WHERE case_number = ${c.case_number}
              AND organization_id = ${ORG_ID}
         )
        RETURNING id
      `;
      if (res?.length) cases++;
    }

    for (const h of DEMO_HEARINGS) {
      // No unique index on nv_hearing_metadata; emulate idempotence with a
      // pre-check on (case_number, hearing_type). Each demo (case, type)
      // pair is unique in DEMO_HEARINGS so this is a safe natural key here;
      // the actual hearing_date drifts every minute (Date.now()-based) and
      // can't be the dedup key.
      const when = daysFromNow(h.offset_days).toISOString();
      const exists = await sql`
        SELECT 1 FROM nv_hearing_metadata
         WHERE case_number = ${h.case_number}
           AND hearing_type = ${h.type}
         LIMIT 1
      `;
      if (exists?.length) continue;
      await sql`
        INSERT INTO nv_hearing_metadata
          (case_number, court_name, hearing_date, hearing_type, order_passed)
        VALUES
          (${h.case_number},
           (SELECT court_name FROM nv_cases WHERE case_number = ${h.case_number} LIMIT 1),
           ${when}::timestamp, ${h.type}, ${h.order_passed})
      `;
      hearings++;
    }

    for (const inv of DEMO_INVOICES) {
      const paidAt = daysFromNow(inv.paid_offset_days).toISOString();
      const periodEnd = daysFromNow(inv.paid_offset_days + 5).toISOString();
      const periodStart = daysFromNow(inv.paid_offset_days - 25).toISOString();
      const res = await sql`
        INSERT INTO nv_invoices
          (user_id, org_id, invoice_number, amount_in_paise, currency, status,
           period_start, period_end, paid_at)
        VALUES
          ('demo-user-1', ${ORG_ID_STR}, ${inv.invoice_number}, ${inv.amount_in_paise},
           'INR', 'COMPLETED',
           ${periodStart}::timestamp, ${periodEnd}::timestamp, ${paidAt}::timestamp)
        ON CONFLICT (invoice_number) DO NOTHING
        RETURNING id
      `;
      if (res?.length) invoices++;
    }

    log(`[seed-firm-snapshot] org_id=${ORG_ID} inserted: cases=${cases}, hearings=${hearings}, invoices=${invoices}`);
  } catch (err: any) {
    log(`[seed-firm-snapshot] failed: ${err?.message ?? err}`);
    try { await (sql as any).end?.(); } catch { /* ignore */ }
    return { skipped: true, reason: `error: ${err?.message ?? err}`, inserted: { cases, hearings, invoices } };
  }

  try { await (sql as any).end?.(); } catch { /* ignore */ }
  return { skipped: false, inserted: { cases, hearings, invoices } };
}

// CLI entrypoint: `tsx scripts/jrx-seed-firm-snapshot-demo.ts`
const isCli = (() => {
  try {
    const arg = process.argv[1] ?? '';
    return arg.endsWith('./jrx-seed-firm-snapshot-demo.ts') || arg.endsWith('./jrx-seed-firm-snapshot-demo.js');
  } catch { return false; }
})();
if (isCli) {
  seedFirmSnapshotDemo()
    .then((r) => { console.log('done:', JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error('seed-firm-snapshot crashed:', e); process.exit(1); });
}
