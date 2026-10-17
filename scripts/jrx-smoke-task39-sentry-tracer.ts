/**
 * Task #39 smoke — verify Queen tracer flips to Sentry backend.
 *
 * Black-box runtime check that exercises `src/utils/nyv-tracer.ts`
 * twice in a child process per mode:
 *
 *   1. With NYV_SENTRY_DSN unset → expect `backend: "jsonl"`.
 *   2. With NYV_SENTRY_DSN set    → expect `backend: "sentry"` and
 *      every started span reports `sentryBacked: true`.
 *
 * This proves Task #39's contract:
 *   - `@sentry/node` is installed (so the optional `await import(...)`
 *     in `initTracer()` resolves)
 *   - `getTracerStatus().backend` flips on DSN
 *   - `startSpan(...)` mirrors into Sentry as an inactive span
 *
 * Usage:
 *   cd nyayavigya-platform-312
 *   npx tsx scripts/jrx-smoke-task39-sentry-tracer.ts
 *
 * Exits non-zero on any assertion failure.
 */

import { spawnSync } from 'child_process';
import path from 'path';

const TRACER_PATH = path.resolve(import.meta.dirname, '../src/utils/nyv-tracer.ts');

const PROBE = `
import { initTracer, getTracerStatus, startSpan, _resetSpanLatencies } from ${JSON.stringify(TRACER_PATH)};
(async () => {
  await initTracer();
  const status = getTracerStatus();
  const root = startSpan('queen.orchestrate', {
    tags: { orchestrationId: 't-smoke-39', jurisdiction: 'IN', tier: 'standard' },
  });
  const child = startSpan('queen.rag', {
    parent: root,
    tags: { orchestrationId: 't-smoke-39', jurisdiction: 'IN' },
  });
  child.finish('ok');
  root.finish('ok');
  process.stdout.write('@@TRACER_PROBE_RESULT@@' + JSON.stringify({
    backend: status.backend,
    dsnConfigured: status.dsnConfigured,
    rootSentryBacked: root.sentryBacked,
    childSentryBacked: child.sentryBacked,
  }) + '@@END@@\\n');
  _resetSpanLatencies();
  process.exit(0);
})().catch((e) => {
  process.stderr.write('PROBE_ERR ' + (e?.message ?? String(e)) + '\\n');
  process.exit(2);
});
`;

interface ProbeResult {
  backend: 'sentry' | 'jsonl';
  dsnConfigured: boolean;
  rootSentryBacked: boolean;
  childSentryBacked: boolean;
}

function runProbe(env: Record<string, string | undefined>): ProbeResult {
  const result = spawnSync('npx', ['tsx', '-e', PROBE], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `probe exited ${result.status}: stdout=${result.stdout}\nstderr=${result.stderr}`,
    );
  }
  const m = result.stdout.match(/@@TRACER_PROBE_RESULT@@(.*?)@@END@@/);
  if (!m) throw new Error(`probe output missing marker: ${result.stdout}`);
  return JSON.parse(m[1]) as ProbeResult;
}

function assertEq<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}: ${JSON.stringify(actual)}`);
  }
}

(async () => {
  console.log('Task #39 smoke — Sentry tracer flip\n');

  console.log('[1/2] No DSN → JSONL fallback');
  const jsonl = runProbe({ NYV_SENTRY_DSN: '', SENTRY_DSN: '' });
  assertEq('backend', jsonl.backend, 'jsonl');
  assertEq('dsnConfigured', jsonl.dsnConfigured, false);
  assertEq('root.sentryBacked', jsonl.rootSentryBacked, false);
  assertEq('child.sentryBacked', jsonl.childSentryBacked, false);

  console.log('\n[2/2] DSN set → Sentry backend active');
  const sentry = runProbe({
    NYV_SENTRY_DSN: 'https://abc123@o0.ingest.sentry.io/0',
    SENTRY_DSN: '',
  });
  assertEq('backend', sentry.backend, 'sentry');
  assertEq('dsnConfigured', sentry.dsnConfigured, true);
  assertEq('root.sentryBacked', sentry.rootSentryBacked, true);
  assertEq('child.sentryBacked', sentry.childSentryBacked, true);

  console.log(
    process.exitCode
      ? '\n✗ Task #39 smoke FAILED'
      : '\n✓ Task #39 smoke PASSED — tracer flips between jsonl and sentry on demand',
  );
})().catch((e) => {
  console.error('smoke runner crashed:', e);
  process.exit(2);
});
