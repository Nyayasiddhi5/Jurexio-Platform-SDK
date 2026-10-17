/**
 * tests/regression/jrx-gateway-boots-without-db.test.ts
 *
 * task-256 — Regression test that the gateway boots cleanly when the
 * database is unreachable.
 *
 * Background (task-251 / NYV-NS-022): the `db` singleton in `src/db/index.ts`
 * resolves to `null` when no DATABASE_URL / NV_DATABASE_URL is configured.
 * Approximately 95 consumer modules wrap the singleton in a lazy Proxy
 * (`lazyRequire(() => rawDb, 'db')`) so module *import* never throws — only
 * the first *use* throws a typed `NyvMissingDependencyError`. The contract
 * is fragile: a future PR can accidentally add `const db = requireDb(rawDb)`
 * at the top of one of those modules and silently break boot for every
 * downstream importer.
 *
 * This suite spawns clean `tsx` child processes with all DB env vars
 * stripped and asserts:
 *
 *   1. Importing `src/db/index.js`, the canonical Proxy module
 *      (`src/services/jrx-orchestration-services.js`), and a representative
 *      lazy-Proxy route (`src/routes/jrx-shared-docs-routes.js`) does NOT
 *      throw.
 *   2. `initializeDatabase()` resolves cleanly.
 *   3. A DB-backed Express route, served behind the canonical
 *      `nv-error-handler` middleware, returns HTTP 500 with a typed
 *      `NyvMissingDependencyError` payload (the contract advertised by
 *      task-251) — NOT a generic `Cannot read properties of undefined`.
 *
 * The child-process approach is deliberate:
 *   • `tests/setup.ts` globally mocks `src/db/index.js`, which would defeat
 *     the import-safety assertion if we ran in-process.
 *   • A fresh module cache per test guarantees we exercise the real
 *     module-init path, not a cached stub from an earlier suite.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runFixture(scriptName: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    // Strip every DB-related env var so the child sees an unconfigured
    // singleton even if the host shell exports DATABASE_URL.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of [
      'NV_DATABASE_URL',
      'DATABASE_URL',
      'NS_DATABASE_URL',
      'NM_DATABASE_URL',
      'PGDATABASE',
      'PGHOST',
    ]) {
      delete env[k];
    }
    env.NODE_ENV = 'test';
    // Quiet pino in tests.
    env.LOG_LEVEL = env.LOG_LEVEL || 'silent';

    const child = spawn(TSX_BIN, [path.join(FIXTURE_DIR, scriptName)], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('Gateway boots cleanly when database is unreachable (task-256)', () => {
  it(
    'imports db singleton + canonical lazy-Proxy modules + initializeDatabase() without throwing',
    async () => {
      const r = await runFixture('./jrx-db-unreachable-import-probe.mjs');
      // Always include child stderr in the assertion failure for diagnostics.
      const diag = `\n--- child stdout ---\n${r.stdout}\n--- child stderr ---\n${r.stderr}\n`;
      expect(r.status, `import probe exited non-zero${diag}`).toBe(0);
      expect(r.stdout, `import probe missing OK marker${diag}`).toContain('OK');
    },
    60_000,
  );

  it(
    'a DB-backed route surfaces a typed NyvMissingDependencyError as HTTP 500 via nv-error-handler',
    async () => {
      const r = await runFixture('./jrx-db-unreachable-route-probe.mjs');
      const diag = `\n--- child stdout ---\n${r.stdout}\n--- child stderr ---\n${r.stderr}\n`;
      expect(r.status, `route probe exited non-zero${diag}`).toBe(0);

      // Last non-empty stdout line is the JSON envelope.
      const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const lastLine = lines[lines.length - 1] ?? '';
      let parsed: { status: number; body: unknown };
      try {
        parsed = JSON.parse(lastLine);
      } catch (e) {
        throw new Error(`could not parse fixture stdout as JSON: ${lastLine}${diag}`);
      }

      expect(parsed.status, `expected HTTP 500${diag}`).toBe(500);

      // Accept either contract advertised by task-251:
      //   (a) `{ error: 'Database not available' }` — the early-return shape
      //       used by the route layer when `if (!db)` short-circuits, OR
      //   (b) the typed NyvMissingDependencyError surfaced through
      //       nv-error-handler (`{ success: false, error: { message:
      //       '[NYV-NS-005] Required dependency \'db\' …' } }`).
      const bodyJson = JSON.stringify(parsed.body);
      expect(
        bodyJson,
        `expected typed Database-not-available error, got: ${bodyJson}${diag}`,
      ).toMatch(/Database not (available|initialised)|NYV-NS-005|Required dependency 'db'/);

      // Critical negative assertion: must NOT be the pre-task-251 generic
      // crash. Catching this string in the regression suite is the whole
      // point — it is the symptom of an eager `requireDb(rawDb)` at module
      // top throwing a TypeError instead of the typed error.
      expect(bodyJson).not.toMatch(/Cannot read properties of undefined/i);
    },
    60_000,
  );
});
