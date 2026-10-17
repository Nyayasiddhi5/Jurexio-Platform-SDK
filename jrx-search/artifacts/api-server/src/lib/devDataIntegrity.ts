/**
 * Dev-database data-state checks (as opposed to seed-FILE checks in
 * seedIntegrity.ts / statutesIntegrity.ts, which validate the JSON files).
 *
 * The dev DB has drifted repeatedly: legal_tasks jurisdiction tags reverted
 * to all-GLOBAL (breaking the jurisdiction-segregation suite) and statutes
 * embeddings went entirely NULL (silently degrading hybrid retrieval to
 * keyword-only). Each drift makes correct code look broken.
 *
 * Shared by:
 *  - src/check-devdata.ts        (`pnpm run check:devdata` — verify + one-line
 *                                 remediation per failure, exit 1 on drift)
 *  - src/__tests__/globalSetup.ts (vitest pre-flight — self-heals before suites)
 *
 * Every check returns a DevDataCheckResult with `ok`, a human-readable
 * `detail`, and the exact `remediation` command to run when it fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { EXPECTED_COUNTS } from "./statutesIntegrity";

export interface DevDataCheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Exact command to run to fix this drift. Empty when ok. */
  remediation: string;
}

const FILTER = "pnpm --filter @workspace/api-server run";

export function fmtDist(m: Map<string, number>): string {
  return (
    [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("/") || "empty"
  );
}

/**
 * legal_tasks per-jurisdiction distribution must exactly match
 * data/seed-tasks.json (this is the drift that broke the
 * jurisdiction-segregation suite three times).
 */
export async function checkTaskJurisdictionDistribution(
  pool: Pool,
  dataDir: string,
): Promise<DevDataCheckResult> {
  const name = "legal_tasks jurisdiction distribution";
  const remediation = `${FILTER} seed`;
  const tasks = JSON.parse(
    readFileSync(join(dataDir, "seed-tasks.json"), "utf-8"),
  ) as { jurisdiction?: string }[];

  const expected = new Map<string, number>();
  for (const t of tasks) {
    const j = t.jurisdiction ?? "GLOBAL";
    expected.set(j, (expected.get(j) ?? 0) + 1);
  }

  try {
    const res = await pool.query(
      "SELECT jurisdiction, count(*)::int AS n FROM legal_tasks GROUP BY jurisdiction",
    );
    const actual = new Map<string, number>(
      res.rows.map((r: { jurisdiction: string | null; n: number }) => [
        r.jurisdiction ?? "GLOBAL",
        r.n,
      ]),
    );
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    for (const k of keys) {
      if ((expected.get(k) ?? 0) !== (actual.get(k) ?? 0)) {
        return {
          name,
          ok: false,
          detail: `expected ${fmtDist(expected)}, got ${fmtDist(actual)}`,
          remediation,
        };
      }
    }
    return { name, ok: true, detail: fmtDist(actual), remediation: "" };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `legal_tasks not readable (${(err as Error).message})`,
      remediation,
    };
  }
}

/**
 * Seeded (is_custom=false) template per-jurisdiction distribution must match
 * data/seed-templates.json. User-created rows are ignored.
 */
export async function checkTemplateDistribution(
  pool: Pool,
  dataDir: string,
): Promise<DevDataCheckResult> {
  const name = "templates (seeded library) distribution";
  const remediation = `${FILTER} seed:templates`;
  const items = JSON.parse(
    readFileSync(join(dataDir, "seed-templates.json"), "utf-8"),
  ) as { jurisdiction: string }[];

  const expected = new Map<string, number>();
  for (const t of items) {
    expected.set(t.jurisdiction, (expected.get(t.jurisdiction) ?? 0) + 1);
  }

  try {
    const res = await pool.query(
      "SELECT jurisdiction, count(*)::int AS n FROM templates WHERE is_custom = false GROUP BY jurisdiction",
    );
    const actual = new Map<string, number>(
      res.rows.map((r: { jurisdiction: string; n: number }) => [r.jurisdiction, r.n]),
    );
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    for (const k of keys) {
      if ((expected.get(k) ?? 0) !== (actual.get(k) ?? 0)) {
        return {
          name,
          ok: false,
          detail: `expected ${fmtDist(expected)}, got ${fmtDist(actual)}`,
          remediation,
        };
      }
    }
    return { name, ok: true, detail: fmtDist(actual), remediation: "" };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `templates not readable (${(err as Error).message})`,
      remediation,
    };
  }
}

/**
 * Core statutes corpus row counts (the codes owned by data/seed-statutes.json:
 * BNS/BNSS/BSA/IPC/CrPC/IEA/USC) must match expectations exactly. Other
 * corpora sharing the table (COI, India Code central Acts) are deliberately
 * NOT checked here — they're expensive to rebuild and owned by their own
 * seeders/ingesters.
 */
export async function checkCoreStatuteCounts(pool: Pool): Promise<DevDataCheckResult> {
  const name = "core statutes row counts";
  const remediation = `${FILTER} seed:statutes`;
  const ownedCodes = Object.keys(EXPECTED_COUNTS);

  try {
    const res = await pool.query(
      "SELECT code, count(*)::int AS n FROM statutes WHERE code = ANY($1) GROUP BY code",
      [ownedCodes],
    );
    const actual = new Map<string, number>(
      res.rows.map((r: { code: string; n: number }) => [r.code, r.n]),
    );
    for (const [code, n] of Object.entries(EXPECTED_COUNTS)) {
      if ((actual.get(code) ?? 0) !== n) {
        return {
          name,
          ok: false,
          detail: `expected ${fmtDist(new Map(Object.entries(EXPECTED_COUNTS)))}, got ${fmtDist(actual)}`,
          remediation,
        };
      }
    }
    return { name, ok: true, detail: fmtDist(actual), remediation: "" };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `statutes not readable (${(err as Error).message})`,
      remediation,
    };
  }
}

/**
 * Statute embedding coverage must be 100% (embedding IS NOT NULL on every
 * row). NULL embeddings silently degrade hybrid retrieval to keyword-only —
 * the second recurring drift. Also fails when the embedding column doesn't
 * exist yet (embed:statutes self-provisions it).
 */
export async function checkStatuteEmbeddingCoverage(
  pool: Pool,
): Promise<DevDataCheckResult> {
  const name = "statutes embedding coverage";
  const remediation = `${FILTER} embed:statutes`;

  try {
    const res = await pool.query<{ total: number; embedded: number }>(
      "SELECT count(*)::int AS total, count(embedding)::int AS embedded FROM statutes",
    );
    const { total, embedded } = res.rows[0]!;
    if (total === 0) {
      return {
        name,
        ok: false,
        detail: "statutes table is empty",
        remediation: `${FILTER} seed:statutes && ${remediation}`,
      };
    }
    if (embedded !== total) {
      return {
        name,
        ok: false,
        detail: `${embedded}/${total} rows embedded (${total - embedded} NULL — hybrid retrieval degrades to keyword-only)`,
        remediation,
      };
    }
    return { name, ok: true, detail: `${embedded}/${total} rows embedded`, remediation: "" };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `statutes embedding not readable (${(err as Error).message})`,
      remediation,
    };
  }
}

/** Run all dev-data checks against the given pool. */
export async function runDevDataChecks(
  pool: Pool,
  dataDir: string,
): Promise<DevDataCheckResult[]> {
  return [
    await checkTaskJurisdictionDistribution(pool, dataDir),
    await checkTemplateDistribution(pool, dataDir),
    await checkCoreStatuteCounts(pool),
    await checkStatuteEmbeddingCoverage(pool),
  ];
}
