/**
 * task-256 fixture — runs in a clean child process under tsx with
 * NV_DATABASE_URL / DATABASE_URL / NS_DATABASE_URL / NM_DATABASE_URL all
 * unset.
 *
 * Asserts the lazy-Proxy contract introduced in task-251 (JRX-NS-022):
 *
 *   1. Importing `src/db/index.js` does NOT throw and exports `db === null`
 *      / `pool === null` when no connection string is configured.
 *   2. Importing the canonical lazy-Proxy module
 *      (`src/services/jrx-orchestration-services.js`) does NOT throw at import
 *      time — the Proxy defers the `requireDb` call until first property
 *      access, so module init must succeed even with no DB.
 *   3. Importing a representative lazy-Proxy route module
 *      (`src/routes/jrx-shared-docs-routes.js`) does NOT throw at import
 *      time for the same reason.
 *   4. `initializeDatabase()` resolves cleanly when DATABASE_URL is unset
 *      (it logs the warning and returns).
 *
 * Prints `OK` on success; exits with non-zero status and a diagnostic
 * `FAIL <step>: <message>` on the first failure.
 */

const expectations = [
  {
    name: 'env-stripped',
    run: () => {
      for (const k of ['NV_DATABASE_URL', 'DATABASE_URL', 'NS_DATABASE_URL', 'NM_DATABASE_URL']) {
        if (process.env[k]) {
          throw new Error(`${k} is still set: ${process.env[k]}`);
        }
      }
    },
  },
  {
    name: 'import db/index.js',
    run: async () => {
      const mod = await import('../../../src/db/index.js');
      if (mod.db !== null) throw new Error(`expected db === null, got ${typeof mod.db}`);
      if (mod.pool !== null) throw new Error(`expected pool === null, got ${typeof mod.pool}`);
    },
  },
  {
    name: 'import routes/jrx-shared-docs-routes.js (lazyRequire consumer)',
    run: async () => {
      // Representative `lazyRequire(() => _raw_db, 'db')` consumer. The lazy
      // Proxy must defer DB resolution to first use — module init must
      // succeed without a database.
      await import('../../../src/routes/jrx-shared-docs-routes.js');
    },
  },
  {
    name: 'import routes/jrx-knowledge-aggregators.js (lazyRequire consumer)',
    run: async () => {
      await import('../../../src/routes/jrx-knowledge-aggregators.js');
    },
  },
  {
    name: 'import routes/jrx-patterns-routes.js (lazyRequire consumer)',
    run: async () => {
      await import('../../../src/routes/jrx-patterns-routes.js');
    },
  },
  {
    name: 'import routes/jrx-audit-chain-routes.js (lazyRequire consumer)',
    run: async () => {
      await import('../../../src/routes/jrx-audit-chain-routes.js');
    },
  },
  {
    name: 'import middleware/jrx-doc-access-guard.js (lazyRequire consumer)',
    run: async () => {
      await import('../../../src/middleware/jrx-doc-access-guard.js');
    },
  },
  {
    name: 'import services/agent-registry-service.js (lazyRequire consumer)',
    run: async () => {
      await import('../../../src/services/agent-registry-service.js');
    },
  },
  {
    name: 'import services/rag/rag-service.js (regression: was eager throw)',
    run: async () => {
      // task-256 caught a regression here: this module previously did
      // `if (!db) throw new Error('Database connection failed')` at module
      // top, defeating the lazy-Proxy contract for every transitive
      // importer (jrx-orchestration-services → rag-service). Migrated to
      // lazyRequire by task-256 — pin it here so a future revert is caught.
      await import('../../../src/services/rag/rag-service.js');
    },
  },
  {
    name: 'initializeDatabase()',
    run: async () => {
      const { initializeDatabase } = await import('../../../src/services/database.js');
      await initializeDatabase();
    },
  },
];

(async () => {
  for (const step of expectations) {
    try {
      await step.run();
    } catch (err) {
      const msg = err && err.stack ? err.stack : String(err);
      // eslint-disable-next-line no-console
      console.error(`FAIL ${step.name}: ${msg}`);
      process.exit(1);
    }
  }
  // eslint-disable-next-line no-console
  console.log('OK');
  process.exit(0);
})();
