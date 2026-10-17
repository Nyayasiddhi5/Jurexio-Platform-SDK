/**
 * task-256 fixture — runs in a clean child process under tsx with no
 * database connection strings set.
 *
 * Mounts a tiny Express app whose only route uses the canonical
 * `lazyRequire(() => rawDb, 'db', ...)` Proxy, calls `db.execute(...)` on
 * it, and lets the resulting `JrxMissingDependencyError` propagate to the
 * shared `jrx-error-handler` middleware (the same chain used by every
 * production route).
 *
 * Prints a single JSON line on stdout: `{"status":<httpStatus>,"body":<obj>}`
 * which the parent vitest assertion parses. Exits 0 on success regardless
 * of the HTTP status — the assertion is performed by the parent.
 */

import express from 'express';
import http from 'node:http';

async function main() {
  for (const k of ['NV_DATABASE_URL', 'DATABASE_URL', 'NS_DATABASE_URL', 'NM_DATABASE_URL']) {
    if (process.env[k]) throw new Error(`${k} is still set: ${process.env[k]}`);
  }

  const { lazyRequire } = await import('../../../src/utils/jrx-type-helpers.js');
  const { db: rawDb } = await import('../../../src/db/index.js');
  const { errorHandler } = await import('../../../src/middleware/jrx-error-handler.js');

  if (rawDb !== null) throw new Error(`expected rawDb === null, got ${typeof rawDb}`);

  const lazyDb = lazyRequire(() => rawDb, 'db', 'Database not available');

  const app = express();
  app.get('/db-backed', async (_req, _res, next) => {
    try {
      // First property access on the Proxy → requireDb(rawDb) → throws
      // JrxMissingDependencyError because rawDb is null.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await /** @type {any} */ (lazyDb).execute('SELECT 1');
      next(new Error('lazyRequire did NOT throw — regression: lazy Proxy contract broken'));
    } catch (e) {
      next(e);
    }
  });
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const resp = await fetch(`http://127.0.0.1:${port}/db-backed`);
  let body;
  try {
    body = await resp.json();
  } catch {
    body = await resp.text();
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ status: resp.status, body }));
  server.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`FAIL: ${err && err.stack ? err.stack : String(err)}`);
  process.exit(1);
});
