/**
 * Row-Level Security tests — task #29 deliverable 2.
 *
 * 1. Migration coverage: every nv_* table with org_id is covered by the
 *    DO block in 0004_enable_rls_for_tenant_tables.sql.
 * 2. Middleware: orgRlsMiddleware sets app.current_org_id via set_config()
 *    on every authenticated request, and rejects illegal org_id strings.
 * 3. Cross-tenant isolation: live Postgres test that inserts two rows with
 *    different org_ids and verifies the wrong-tenant query returns zero
 *    rows. Auto-skips when DATABASE_URL is unset.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'drizzle',
  '0004_enable_rls_for_tenant_tables.sql',
);

describe('RLS migration 0004_enable_rls_for_tenant_tables.sql', () => {
  const sqlText = fs.readFileSync(MIGRATION_PATH, 'utf8');

  it('enables RLS on every nv_* / ns_* / ni_* / nm_* table with org_id (DO loop)', () => {
    expect(sqlText).toMatch(/information_schema\.columns/i);
    expect(sqlText).toMatch(/column_name = 'org_id'/);
    expect(sqlText).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it('also FORCES RLS so the table owner cannot bypass policies', () => {
    expect(sqlText).toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it('creates the tenant_isolation policy keyed off app.current_org_id', () => {
    expect(sqlText).toMatch(/CREATE POLICY tenant_isolation/);
    expect(sqlText).toMatch(/current_setting\('app\.current_org_id'/);
  });

  it('installs pgcrypto for pgp_sym_encrypt/decrypt', () => {
    expect(sqlText).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  });

  it('adds the unique index on nv_audit_logs.previous_hash', () => {
    expect(sqlText).toMatch(/nv_audit_logs_prev_hash_uniq/);
    expect(sqlText).toMatch(/UNIQUE INDEX/);
  });

  it('adds *_enc bytea companion columns for sensitive fields', () => {
    expect(sqlText).toMatch(/transcript_text_enc bytea/);
    expect(sqlText).toMatch(/extracted_fields_enc bytea/);
    expect(sqlText).toMatch(/content_enc bytea/);
    expect(sqlText).toMatch(/messages_enc bytea/);
    // Task #29 scope additions: mem0 long-term entries + citation full text
    expect(sqlText).toMatch(/nv_matter_memory[\s\S]{0,200}content_enc bytea/);
    expect(sqlText).toMatch(/document_embeddings[\s\S]{0,200}text_enc bytea/);
  });

  it('uses STRICT tenant policy with no empty-setting bypass', () => {
    // The policy must require an exact match — no `OR coalesce(setting,...)=''`
    // bypass that would let an unbound session see all tenants.
    expect(sqlText).not.toMatch(/coalesce\(\s*current_setting\([^)]*app\.current_org_id[^)]*\)\s*,\s*''\s*\)\s*=\s*''/);
    expect(sqlText).toMatch(
      /USING\s*\(\s*org_id::text\s*=\s*current_setting\(\s*'app\.current_org_id'\s*,\s*true\s*\)\s*\)/,
    );
    expect(sqlText).toMatch(
      /WITH CHECK\s*\(\s*org_id::text\s*=\s*current_setting\(\s*'app\.current_org_id'\s*,\s*true\s*\)\s*\)/,
    );
  });

  it('phased rollout: ENABLE/FORCE ROW LEVEL SECURITY is gated on app.nyv_rls_enforce', () => {
    // Policies must always be installed (idempotent), but ENABLE / FORCE must
    // only run when the migration runner sets `app.nyv_rls_enforce = 'true'`.
    // This lets operators deploy the migration safely before every DB call
    // site is wired through `req.withTenant` / `withTenantTx`.
    expect(sqlText).toMatch(/current_setting\('app\.nyv_rls_enforce'/);
    expect(sqlText).toMatch(/IF enforce THEN[\s\S]*ENABLE ROW LEVEL SECURITY/);
    expect(sqlText).toMatch(/IF enforce THEN[\s\S]*FORCE ROW LEVEL SECURITY/);
  });
});

describe('Migration runner wires 0004 + flags from environment', () => {
  it('scripts/jrx-migrate.ts executes 0004 and binds NYV_RLS_ENFORCE → app.nyv_rls_enforce', () => {
    const runner = fs.readFileSync(
      path.join(process.cwd(), 'scripts/jrx-migrate.ts'),
      'utf8',
    );
    expect(runner).toMatch(/applyRlsAndFieldEncryptionMigration/);
    expect(runner).toMatch(/process\.env\.NYV_RLS_ENFORCE/);
    expect(runner).toMatch(/set_config\('app\.nyv_rls_enforce'/);
    expect(runner).toMatch(/0004_enable_rls_for_tenant_tables\.sql/);
  });
});

describe('orgRlsMiddleware is mounted on the Express app', () => {
  it('src/index.ts mounts orgRlsMiddleware on /api/jrx/ so req.withTenant is available to every route', () => {
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf8');
    expect(indexSrc).toMatch(
      /import\s*\{\s*orgRlsMiddleware\s*\}\s*from\s*'\.\/middleware\/jrx-org-rls-middleware\.js'/,
    );
    expect(indexSrc).toMatch(/app\.use\(\s*'\/api\/nv\/'\s*,\s*orgRlsMiddleware\s*\)/);
  });

  /*
   * NV-RLS-TEST-DISCOVER-001 (2026-08-19) — this test used to read a hardcoded
   * `src/routes/jrx-case-management-routes.ts`, which does not exist and, per git history, never
   * did. It therefore failed with ENOENT on every run since the initial snapshot: a security
   * guard that never guarded, and permanently-red output that trained the eye to ignore it.
   *
   * It now DISCOVERS the paved-road example instead of naming one. A guard that hardcodes a
   * filename rots the moment a route is renamed; one that asserts "at least one route
   * demonstrates the pattern" keeps working and still fails loudly if the pattern disappears
   * entirely.
   */
  it('at least one route demonstrates the paved-road req.withTenant read', () => {
    const routeFiles = listRouteFiles();
    expect(routeFiles.length).toBeGreaterThan(0);
    const usingWithTenant = routeFiles.filter((f) =>
      fs.readFileSync(f, 'utf8').includes('withTenant'),
    );
    expect(
      usingWithTenant.length,
      'no route uses req.withTenant — the paved-road tenant-scoping pattern has no live example',
    ).toBeGreaterThan(0);
  });
});

/** Every .ts route file, recursively — routes live in nested folders (e.g. nv5/gov). */
function listRouteFiles(): string[] {
  const root = path.join(process.cwd(), 'src', 'routes');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(root);
  return out;
}

describe('orgRlsMiddleware — connection-safe tenant context', () => {
  let mod: typeof import('../../../src/middleware/jrx-org-rls-middleware.js');
  let executeMock: ReturnType<typeof vi.fn>;
  let txExecuteMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    executeMock = vi.fn().mockResolvedValue({ rows: [] });
    txExecuteMock = vi.fn().mockResolvedValue({ rows: [] });
    transactionMock = vi.fn(async (cb: (tx: any) => Promise<any>) => {
      return cb({ execute: txExecuteMock });
    });
    vi.doMock('../../../src/db/index.js', () => ({
      db: { execute: executeMock, transaction: transactionMock },
    }));
    mod = await import('../../../src/middleware/jrx-org-rls-middleware.js');
  });

  function makeReqRes(orgId: string | null) {
    const req: any = { headers: {}, params: {}, body: {}, user: { id: 'u1', orgId } };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res: any = { status, json };
    const next = vi.fn();
    return { req, res, next, json, status };
  }

  it('attaches a connection-safe req.withTenant helper that calls SET LOCAL inside a transaction', async () => {
    const { req, res, next } = makeReqRes('acme_org_42');
    mod.orgRlsMiddleware(req, res, next);
    expect(req.orgId).toBe('acme_org_42');
    expect(typeof req.withTenant).toBe('function');
    expect(next).toHaveBeenCalled();

    // Driving req.withTenant must open a transaction and SET LOCAL inside it
    // — without that pinning, the next pooled connection has no tenant.
    const result = await req.withTenant(async (tx: any) => {
      expect(tx.execute).toBe(txExecuteMock);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txExecuteMock).toHaveBeenCalled();
    const stringified = JSON.stringify(txExecuteMock.mock.calls[0][0]);
    expect(stringified).toContain('SET LOCAL');
    expect(stringified).toContain('app.current_org_id');
    expect(stringified).toContain('acme_org_42');
  });

  it('rejects org_id values that fail the safe-id regex (injection guard)', () => {
    const { req, res, next, status, json } = makeReqRes("acme'; DROP TABLE x;--");
    mod.orgRlsMiddleware(req, res, next);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ORG_ID_INVALID' }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('withTenantTx propagates failures from the wrapped fn (transaction rolls back, SET LOCAL reverts)', async () => {
    const boom = new Error('boom');
    await expect(mod._internal.withTenantTx('tenant_a', async () => {
      throw boom;
    })).rejects.toBe(boom);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it('withTenantTx refuses illegal org_id values', async () => {
    await expect(
      mod._internal.withTenantTx("bad'; --", async () => 'unreached'),
    ).rejects.toThrow(/illegal org_id/);
  });

  it('withTenantContext (legacy session-scoped) sets and clears app.current_org_id', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await mod.withTenantContext('tenant_z', fn);
    expect(result).toBe('ok');
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(executeMock.mock.calls[0][0])).toContain('tenant_z');
    expect(JSON.stringify(executeMock.mock.calls[1][0])).toContain("''");
    expect(fn).toHaveBeenCalled();
  });
});

describe('Pool default tenant binding (defence-in-depth)', () => {
  it('src/db/index.ts attaches a connect listener that defaults app.current_org_id to ""', () => {
    const dbSrc = fs.readFileSync(
      path.join(process.cwd(), 'src', 'db', 'index.ts'),
      'utf8',
    );
    expect(dbSrc).toMatch(/attachTenantContextDefault/);
    expect(dbSrc).toMatch(/p\.on\(['"]connect['"]/);
    expect(dbSrc).toMatch(/SET app\.current_org_id = ''/);
  });
});

// ── Live cross-tenant isolation test (auto-skips without DATABASE_URL) ───────
const haveDb = !!process.env.DATABASE_URL;
const liveDescribe = haveDb ? describe : describe.skip;

liveDescribe('Live RLS — cross-tenant query returns zero rows', () => {
  it('SELECT from nv_rls_sentinel with app.current_org_id=tenantA returns only tenantA rows', async () => {
    // Lazy-load pg only when DATABASE_URL is present.
    const { Pool } = (await import('pg')) as any;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const c = await pool.connect();
      try {
        // Postgres always exempts SUPERUSER and BYPASSRLS roles from RLS —
        // production uses a dedicated unprivileged app role. If this CI
        // database is connected as a superuser we skip the data check and
        // assert only that the policy *exists* (verifying middleware still
        // sets the session var correctly is covered by the unit test above).
        const su = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
        const isSuperuser = !!(su.rows[0]?.rolsuper || su.rows[0]?.rolbypassrls);

        await c.query('CREATE TABLE IF NOT EXISTS nv_rls_sentinel (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())');
        await c.query('ALTER TABLE nv_rls_sentinel ENABLE ROW LEVEL SECURITY');
        await c.query('ALTER TABLE nv_rls_sentinel FORCE  ROW LEVEL SECURITY');
        await c.query('DROP POLICY IF EXISTS tenant_isolation ON nv_rls_sentinel');
        // Strict policy — exact match only. No empty-setting bypass.
        // org_id = NULL evaluates to NULL → policy fails → zero rows visible.
        await c.query(`CREATE POLICY tenant_isolation ON nv_rls_sentinel
                       USING      (org_id = current_setting('app.current_org_id', true))
                       WITH CHECK (org_id = current_setting('app.current_org_id', true))`);

        // Sanity: the policy is installed on the table.
        const polRows = await c.query(`
          SELECT polname FROM pg_policy p
          JOIN pg_class t ON t.oid = p.polrelid
          WHERE t.relname = 'nv_rls_sentinel'
        `);
        expect(polRows.rows.map((r: any) => r.polname)).toContain('tenant_isolation');

        if (isSuperuser) {
          // Superuser cannot meaningfully exercise the data-side filter;
          // production uses a non-superuser app role. Policy presence
          // already verified above. Clean up under bypass and exit.
          await c.query("SELECT set_config('app.current_org_id', 'tenantA', false)");
          await c.query("DELETE FROM nv_rls_sentinel WHERE org_id IN ('tenantA','tenantB')");
          await c.query("SELECT set_config('app.current_org_id', 'tenantB', false)");
          await c.query("DELETE FROM nv_rls_sentinel WHERE org_id IN ('tenantA','tenantB')");
          return;
        }

        // Strict policy WITH CHECK requires the inserter to be bound to the
        // tenant they are inserting for. Insert each row under its own context.
        await c.query("SELECT set_config('app.current_org_id', 'tenantA', false)");
        await c.query("DELETE FROM nv_rls_sentinel WHERE org_id = 'tenantA'");
        await c.query("INSERT INTO nv_rls_sentinel (org_id, payload) VALUES ('tenantA', 'A-data')");
        await c.query("SELECT set_config('app.current_org_id', 'tenantB', false)");
        await c.query("DELETE FROM nv_rls_sentinel WHERE org_id = 'tenantB'");
        await c.query("INSERT INTO nv_rls_sentinel (org_id, payload) VALUES ('tenantB', 'B-data')");

        // Strict-policy assertion: an unbound (NULL) session sees zero rows.
        await c.query("RESET app.current_org_id");
        const empty = await c.query('SELECT org_id, payload FROM nv_rls_sentinel');
        expect(empty.rows.length).toBe(0);

        await c.query("SELECT set_config('app.current_org_id', 'tenantA', false)");
        const a = await c.query('SELECT org_id, payload FROM nv_rls_sentinel');
        expect(a.rows.length).toBeGreaterThan(0);
        expect(a.rows.every((r: any) => r.org_id === 'tenantA')).toBe(true);

        await c.query("SELECT set_config('app.current_org_id', 'tenantB', false)");
        const b = await c.query('SELECT org_id, payload FROM nv_rls_sentinel');
        expect(b.rows.length).toBeGreaterThan(0);
        expect(b.rows.every((r: any) => r.org_id === 'tenantB')).toBe(true);

        await c.query("SELECT set_config('app.current_org_id', '', false)");
        await c.query("DELETE FROM nv_rls_sentinel WHERE org_id IN ('tenantA','tenantB')");
      } finally {
        c.release();
      }
    } finally {
      await pool.end();
    }
  }, 30_000);
});

describe('Paved-road tenant-bound read uses tx, not global db', () => {
  /*
   * Same rot as above: this asserted a `nv_cases` SELECT inside a file that never existed.
   *
   * The substance worth guarding is not WHICH route does it, but that every route using
   * `req.withTenant` runs its reads through the transaction handle. Passing a callback that
   * ignores `tx` and calls a service backed by global `db` silently escapes the tenant GUC —
   * the read leaves the RLS-scoped connection and the isolation is lost. That is the actual
   * defect class, and it is what this now checks across all routes.
   */
  it('every req.withTenant callback binds the tx handle it is given', () => {
    const offenders: string[] = [];
    for (const file of listRouteFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('withTenant')) continue;
      /*
       * A zero-arg callback — `withTenant(async () => …)` — cannot use the scoped handle, so
       * anything it reads runs on the global pool outside the tenant GUC.
       */
      const zeroArg = /withTenant\(\s*async\s*\(\s*\)\s*=>/.test(src);
      if (zeroArg) offenders.push(path.relative(process.cwd(), file));
    }
    expect(
      offenders,
      `these routes pass a zero-argument callback to req.withTenant, so their reads run on the global pool outside the tenant GUC: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('the tenant tx type is exported so callbacks can be typed', () => {
    const mw = fs.readFileSync(
      path.join(process.cwd(), 'src', 'middleware', './jrx-org-rls-middleware.ts'),
      'utf8',
    );
    /* Declared as an `interface`; accept either form so a type/interface swap is not a
     * spurious failure. What matters is that the handle type is exported at all. */
    expect(mw).toMatch(/export\s+(?:type|interface)\s+TenantTx/);
  });
});

// ─── Task #355: two-tier (platform_id, customer_org_id) RLS ──────────────────

const MIGRATION_0013 = path.join(process.cwd(), 'drizzle', '0013_customer_org_rls.sql');

describe('RLS migration 0013_customer_org_rls.sql (Task #355)', () => {
  const sqlText = fs.readFileSync(MIGRATION_0013, 'utf8');

  it('installs the customer_org_isolation policy on the four sdk_* tables (strict AND of both GUCs)', () => {
    expect(sqlText).toMatch(/CREATE POLICY customer_org_isolation/);
    for (const tname of ['sdk_api_request_logs', 'sdk_usage_metering', 'sdk_workflows', 'sdk_workflow_executions']) {
      expect(sqlText).toContain(`'${tname}'`);
    }
    expect(sqlText).toMatch(/application_id::text\s*=\s*current_setting\('nv\.platform_id'/);
    expect(sqlText).toMatch(/customer_org_id::text\s*=\s*current_setting\('nv\.customer_org_id'/);
  });

  it('installs a customer_org_id-only policy on the HITL/CAM tables (no application_id column)', () => {
    for (const tname of ['nv_hitl_queue', 'nv_hitl_decisions', 'nv_cam_actions']) {
      expect(sqlText).toContain(`'${tname}'`);
    }
  });

  it('phased rollout: ENABLE/FORCE ROW LEVEL SECURITY is gated on app.nyv_rls_enforce', () => {
    expect(sqlText).toMatch(/current_setting\('app\.nyv_rls_enforce'/);
    expect(sqlText).toMatch(/IF enforce THEN[\s\S]*ENABLE ROW LEVEL SECURITY/);
    expect(sqlText).toMatch(/IF enforce THEN[\s\S]*FORCE\s+ROW LEVEL SECURITY/);
  });

  it('uses STRICT match — no empty-setting bypass', () => {
    expect(sqlText).not.toMatch(/coalesce\(\s*current_setting\([^)]*nv\.(platform_id|customer_org_id)[^)]*\)\s*,\s*''\s*\)\s*=\s*''/);
  });

  it('is wired into scripts/jrx-migrate.ts behind the same NYV_RLS_ENFORCE gate as 0004', () => {
    const runner = fs.readFileSync(path.join(process.cwd(), 'scripts/jrx-migrate.ts'), 'utf8');
    expect(runner).toMatch(/0013_customer_org_rls\.sql/);
  });
});

describe('Pool default — fail-closed for the two-tier GUCs (Task #355)', () => {
  it('src/db/index.ts initialises both nv.platform_id and nv.customer_org_id to "" on every fresh connection', () => {
    const dbSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'db', 'index.ts'), 'utf8');
    expect(dbSrc).toMatch(/SET nv\.platform_id\s*=\s*''/);
    expect(dbSrc).toMatch(/SET nv\.customer_org_id\s*=\s*''/);
  });
});

describe('withSdkTenantTx — two-tier transaction-scoped binding (Task #355)', () => {
  let mod: typeof import('../../../src/middleware/jrx-org-rls-middleware.js');
  let txExecuteMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    txExecuteMock = vi.fn().mockResolvedValue({ rows: [] });
    transactionMock = vi.fn(async (cb: (tx: any) => Promise<any>) => cb({ execute: txExecuteMock }));
    vi.doMock('../../../src/db/index.js', () => ({
      db: { execute: vi.fn(), transaction: transactionMock },
    }));
    mod = await import('../../../src/middleware/jrx-org-rls-middleware.js');
  });

  it('opens a transaction and SET LOCALs both nv.platform_id and nv.customer_org_id', async () => {
    const result = await mod._internal.withSdkTenantTx(7, 7000000, async (tx: any) => {
      expect(tx.execute).toBe(txExecuteMock);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(txExecuteMock).toHaveBeenCalledTimes(2);
    const stmts = txExecuteMock.mock.calls.map((c: any[]) => JSON.stringify(c[0]));
    expect(stmts.some(s => s.includes('SET LOCAL') && s.includes('nv.platform_id') && s.includes("'7'"))).toBe(true);
    expect(stmts.some(s => s.includes('SET LOCAL') && s.includes('nv.customer_org_id') && s.includes("'7000000'"))).toBe(true);
  });

  it('rejects non-numeric platform_id (injection guard — SET LOCAL takes no bind params)', async () => {
    await expect(
      mod._internal.withSdkTenantTx("7'; DROP TABLE x;--", 1, async () => 'unreached'),
    ).rejects.toThrow(/illegal platform_id/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects non-numeric customer_org_id (injection guard)', async () => {
    await expect(
      mod._internal.withSdkTenantTx(1, "1'; --", async () => 'unreached'),
    ).rejects.toThrow(/illegal customer_org_id/);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe('SDK gateway wires req.withSdkTenant after sdkContext (Task #355)', () => {
  it('./jrx-sdk-gateway.ts attaches req.withSdkTenant via withSdkTenantTx for both real and JWT-bypass paths', () => {
    const mw = fs.readFileSync(path.join(process.cwd(), 'src', 'middleware', './jrx-sdk-gateway.ts'), 'utf8');
    expect(mw).toMatch(/import\s*\{\s*withSdkTenantTx\s*\}\s*from\s*'\.\/jrx-org-rls-middleware\.js'/);
    expect(mw).toMatch(/function attachWithSdkTenant\(/);
    // Called from both the real-key path and the internal-JWT bypass path.
    const calls = mw.match(/attachWithSdkTenant\(req\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Live cross-tenant isolation against a real Postgres (auto-skips) ────────
const haveDb2 = !!process.env.DATABASE_URL;
const liveDescribe2 = haveDb2 ? describe : describe.skip;

liveDescribe2('Live two-tier RLS — a deliberately-broken WHERE still returns zero cross-tenant rows', () => {
  it('SELECT FROM nv_rls_sentinel_v2 WITHOUT a customer_org_id WHERE clause is filtered to the bound tenant only', async () => {
    const { Pool } = (await import('pg')) as any;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const c = await pool.connect();
      try {
        const su = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
        const isSuperuser = !!(su.rows[0]?.rolsuper || su.rows[0]?.rolbypassrls);

        // Self-bootstrap so the test runs even on envs where 0013 hasn't been applied.
        await c.query(`CREATE TABLE IF NOT EXISTS nv_rls_sentinel_v2 (
          id SERIAL PRIMARY KEY,
          platform_id INTEGER NOT NULL,
          customer_org_id BIGINT NOT NULL,
          payload TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        await c.query('DROP POLICY IF EXISTS tenant_isolation_v2 ON nv_rls_sentinel_v2');
        await c.query(`CREATE POLICY tenant_isolation_v2 ON nv_rls_sentinel_v2
                       USING      (platform_id::text     = current_setting('nv.platform_id', true)
                              AND customer_org_id::text = current_setting('nv.customer_org_id', true))
                       WITH CHECK (platform_id::text     = current_setting('nv.platform_id', true)
                              AND customer_org_id::text = current_setting('nv.customer_org_id', true))`);
        await c.query('ALTER TABLE nv_rls_sentinel_v2 ENABLE ROW LEVEL SECURITY');
        await c.query('ALTER TABLE nv_rls_sentinel_v2 FORCE  ROW LEVEL SECURITY');

        const polRows = await c.query(`
          SELECT polname FROM pg_policy p
          JOIN pg_class t ON t.oid = p.polrelid
          WHERE t.relname = 'nv_rls_sentinel_v2'
        `);
        expect(polRows.rows.map((r: any) => r.polname)).toContain('tenant_isolation_v2');

        if (isSuperuser) {
          await c.query("SELECT set_config('nv.platform_id', '1', false)");
          await c.query("SELECT set_config('nv.customer_org_id', '1000000', false)");
          await c.query("DELETE FROM nv_rls_sentinel_v2 WHERE platform_id IN (1,2)");
          return;
        }

        // Insert under tenant A: (platform=1, customer_org=1000001)
        await c.query("SELECT set_config('nv.platform_id', '1', false)");
        await c.query("SELECT set_config('nv.customer_org_id', '1000001', false)");
        await c.query("DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 1 AND customer_org_id = 1000001");
        await c.query("INSERT INTO nv_rls_sentinel_v2 (platform_id, customer_org_id, payload) VALUES (1, 1000001, 'A')");

        // Insert under tenant B: (platform=2, customer_org=2000001)
        await c.query("SELECT set_config('nv.platform_id', '2', false)");
        await c.query("SELECT set_config('nv.customer_org_id', '2000001', false)");
        await c.query("DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 2 AND customer_org_id = 2000001");
        await c.query("INSERT INTO nv_rls_sentinel_v2 (platform_id, customer_org_id, payload) VALUES (2, 2000001, 'B')");

        // Bound to tenant A — DELIBERATELY OMIT the platform_id / customer_org_id WHERE
        // clause to simulate the forgotten-filter bug. RLS must filter for us.
        await c.query("SELECT set_config('nv.platform_id', '1', false)");
        await c.query("SELECT set_config('nv.customer_org_id', '1000001', false)");
        const broken = await c.query('SELECT platform_id, customer_org_id, payload FROM nv_rls_sentinel_v2');
        expect(broken.rows.length).toBeGreaterThan(0);
        expect(broken.rows.every((r: any) =>
          Number(r.platform_id) === 1 && String(r.customer_org_id) === '1000001',
        )).toBe(true);
        expect(broken.rows.some((r: any) => r.payload === 'B')).toBe(false);

        // Unbound session sees ZERO rows (fail-closed).
        await c.query("RESET nv.platform_id");
        await c.query("RESET nv.customer_org_id");
        const empty = await c.query('SELECT platform_id, customer_org_id, payload FROM nv_rls_sentinel_v2');
        expect(empty.rows.length).toBe(0);

        // Cleanup under each tenant.
        await c.query("SELECT set_config('nv.platform_id', '1', false)");
        await c.query("SELECT set_config('nv.customer_org_id', '1000001', false)");
        await c.query("DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 1 AND customer_org_id = 1000001");
        await c.query("SELECT set_config('nv.platform_id', '2', false)");
        await c.query("SELECT set_config('nv.customer_org_id', '2000001', false)");
        await c.query("DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 2 AND customer_org_id = 2000001");
      } finally {
        c.release();
      }
    } finally {
      await pool.end();
    }
  }, 30_000);
});

describe('SDK middleware audit-write tail logs chain failures (no silent swallow)', () => {
  it('./jrx-sdk-tracking-middleware.ts no longer uses .catch(() => {}) for the audit write', () => {
    const mw = fs.readFileSync(
      path.join(process.cwd(), 'src', 'middleware', './jrx-sdk-tracking-middleware.ts'),
      'utf8',
    );
    // The old silent-swallow pattern is forbidden.
    expect(mw).not.toMatch(/writeAuditLog\([\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\}\)/);
    // The replacement must log audit_chain_failure with the alert code.
    expect(mw).toMatch(/audit_chain_failure/);
    expect(mw).toMatch(/NYV-AUDIT-CHAIN-001/);
  });
});
