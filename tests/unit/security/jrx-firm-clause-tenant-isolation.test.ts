/**
 * NV-FIRM-CLAUSE-DRAFT-001 — live cross-tenant proof against a real Postgres.
 *
 * Why this exists separately from the unit suite: the unit tests prove the
 * TypeScript guard drops a foreign clause. They do NOT prove the READ is
 * scoped, because the tx handle is faked there. FB-190 was a read-side leak
 * (the clause library was "readable cross-tenant"), so a guard that only lives
 * in application code is the wrong shape of evidence. This asserts that with
 * `app.current_org_id` bound to org B and RLS forced, the very query
 * `loadOrgFirmClauses` issues cannot see org A's clause JSON at all — and, in
 * the harder case, that it still cannot see it when the SQL's own WHERE is
 * removed, i.e. the database is the backstop and not the application.
 *
 * Auto-skips without NYV_TEST_PG_URL. It does not read DATABASE_URL: pointing
 * a test that creates tables and forces RLS at whatever a developer has in
 * DATABASE_URL is how a "test" ends up mutating a shared database.
 */
import { describe, it, expect } from 'vitest';
import { loadOrgFirmClauses } from '../../../src/services/jrx-firm-clause-library.js';

const PG_URL = process.env.NYV_TEST_PG_URL;
const liveDescribe = PG_URL ? describe : describe.skip;

const ORG_A = '4001';
const ORG_B = '4002';
const A_SECRET = 'ORG-A-SECRET-CARVEOUT';
const B_OWN = 'ORG-B-OWN-WORDING';

liveDescribe('Live RLS — a firm clause cannot cross tenants into another firm\'s prompt', () => {
  it('org B, bound via SET LOCAL, cannot read org A clause JSON — even with the query\'s own WHERE removed', async () => {
    const { Pool } = (await import('pg')) as any;
    const pool = new Pool({ connectionString: PG_URL });
    try {
      const c = await pool.connect();
      try {
        // Positive control (NV-VALIDATE-THE-PROBE-001): if the role bypasses
        // RLS, every assertion below would pass for the wrong reason. Fail the
        // test rather than report a green that proves nothing.
        const su = await c.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
        const bypasses = !!(su.rows[0]?.rolsuper || su.rows[0]?.rolbypassrls);
        expect(
          bypasses,
          'connected as a SUPERUSER/BYPASSRLS role — RLS would be skipped and this test would be vacuous. Point NYV_TEST_PG_URL at an unprivileged role.',
        ).toBe(false);

        /* Runs in a dedicated schema owned by the test role, with `search_path`
         * pointed at it, so the service's UNQUALIFIED `nv_organizations` query
         * resolves here. Without this the test tried to bootstrap whatever
         * `nv_organizations` already existed in `public` and failed with
         * `must be owner of table` against a table owned by another role —
         * which is an environment collision, not a platform finding. */
        await c.query('CREATE SCHEMA IF NOT EXISTS nv_firm_clause_rls_test');
        await c.query('SET search_path TO nv_firm_clause_rls_test');
        await c.query('DROP TABLE IF EXISTS nv_organizations');
        await c.query(`CREATE TABLE nv_organizations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT,
          settings JSONB DEFAULT '{}'::jsonb
        )`);
        await c.query('DROP POLICY IF EXISTS tenant_isolation ON nv_organizations');
        // Mirrors drizzle/0004: strict equality, no empty-setting bypass. For
        // nv_organizations the tenant key IS the row's own id.
        await c.query(`CREATE POLICY tenant_isolation ON nv_organizations
                       USING      (id::text = current_setting('app.current_org_id', true))
                       WITH CHECK (id::text = current_setting('app.current_org_id', true))`);
        await c.query('ALTER TABLE nv_organizations ENABLE ROW LEVEL SECURITY');
        await c.query('ALTER TABLE nv_organizations FORCE  ROW LEVEL SECURITY');

        const libFor = (org: string, title: string) =>
          JSON.stringify([
            {
              orgId: org,
              clauseType: 'indemnity',
              title,
              text: `${title} — aggregate cap of two times fees paid.`,
              documentTypes: ['msa'],
              jurisdiction: 'IN',
            },
          ]);

        for (const [org, title] of [[ORG_A, A_SECRET], [ORG_B, B_OWN]] as const) {
          await c.query(`SELECT set_config('app.current_org_id', '${org}', false)`);
          await c.query('DELETE FROM nv_organizations WHERE id::text = $1', [org]);
          await c.query(
            `INSERT INTO nv_organizations (id, name, slug, settings)
             VALUES ($1::int, $2, $3, jsonb_build_object('clauseLibrary', $4::jsonb))`,
            [org, `Firm ${org}`, `firm-${org}`, libFor(org, title)],
          );
        }

        // Positive control #2: bound to A, the service must actually FIND A's
        // clause. Without this, "B sees nothing" could just mean the read is
        // broken for everyone.
        await c.query(`SELECT set_config('app.current_org_id', '${ORG_A}', false)`);
        const asA = await loadOrgFirmClauses(ORG_A, { execute: (q: any) => runMockedDrizzleSql(c, q) });
        expect(asA.map((x) => x.title)).toContain(A_SECRET);

        // The actual claim: bound to B, A's wording is unreachable.
        await c.query(`SELECT set_config('app.current_org_id', '${ORG_B}', false)`);
        const asB = await loadOrgFirmClauses(ORG_B, { execute: (q: any) => runMockedDrizzleSql(c, q) });
        expect(asB.map((x) => x.title)).toContain(B_OWN);
        expect(asB.map((x) => x.title)).not.toContain(A_SECRET);
        expect(asB.every((x) => x.orgId === ORG_B)).toBe(true);

        // Harder case — the forgotten-filter bug. Bound to B, ask for A's row
        // with NO tenant predicate at all. RLS must return zero rows, proving
        // the isolation does not depend on the application remembering.
        const unfiltered = await c.query(
          `SELECT id::text AS org_id, settings -> 'clauseLibrary' AS clause_library FROM nv_organizations`,
        );
        expect(unfiltered.rows.every((r: any) => r.org_id === ORG_B)).toBe(true);
        expect(JSON.stringify(unfiltered.rows)).not.toContain(A_SECRET);

        // Unbound session sees nothing — fail-closed.
        await c.query('RESET app.current_org_id');
        const unbound = await c.query('SELECT id FROM nv_organizations');
        expect(unbound.rows.length).toBe(0);

        for (const org of [ORG_A, ORG_B]) {
          await c.query(`SELECT set_config('app.current_org_id', '${org}', false)`);
          await c.query('DELETE FROM nv_organizations WHERE id::text = $1', [org]);
        }
        await c.query('DROP SCHEMA IF EXISTS nv_firm_clause_rls_test CASCADE');
      } finally {
        c.release();
      }
    } finally {
      await pool.end();
    }
  }, 60_000);
});

/**
 * Run the query object the SERVICE built on a raw pg client, so the live test
 * exercises the same SQL rather than a hand-copied duplicate that could drift.
 *
 * `tests/setup.ts` globally mocks drizzle's `sql` tag to `{ strings, values }`,
 * so that — not a drizzle `SQL` instance — is what arrives here. Two earlier
 * instruments failed on this: walking `queryChunks` (empty under the mock) and
 * `PgDialect.sqlToQuery` (throws `sql2.toQuery is not a function`). The shape
 * assertion below exists so that if the global mock ever changes, this test
 * fails loudly instead of quietly proving nothing.
 */
async function runMockedDrizzleSql(client: any, query: any): Promise<{ rows: Record<string, unknown>[] }> {
  const strings: string[] | undefined = query?.strings;
  const values: unknown[] = query?.values ?? [];
  expect(
    Array.isArray(strings),
    'the global drizzle `sql` mock no longer yields { strings, values } — this live test can no longer reconstruct the service query and must be updated, not skipped',
  ).toBe(true);
  const text = (strings as string[]).reduce(
    (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
    '',
  );
  const res = await client.query(text, values);
  return { rows: res.rows };
}
