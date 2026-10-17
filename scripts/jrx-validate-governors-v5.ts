/**
 * jrx-validate-governors-v5.ts — Session-16 (2026-06-02) light dry-test for the
 * concurrency governor + cost-optimization suite enabled by the differentiated-
 * capability default-on pass (JRX_F_GOV_CONCURRENCY / JRX_F_GOV_COST_OPT).
 *
 * Pure in-memory validation — NO DB, NO Redis, NO LLM, NO network. Safe to run
 * anywhere. Exits non-zero on the first failed assertion so it can gate CI.
 *
 *   npx tsx scripts/jrx-validate-governors-v5.ts
 *
 * NV-DB-SCRIPT-001: N/A (no DB access). NV-LLM-001/ARCH-001: N/A (no emission).
 */

// Concurrency limits are read at module-load, so set a small cap BEFORE import.
process.env.ORCH_TENANT_CONCURRENCY = '2';
process.env.ORCH_PROVIDER_CONCURRENCY = '2';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

async function validateConcurrencyGovernor(): Promise<void> {
  console.log('\n[1] Concurrency governor — per-tenant semaphore (limit=2)');
  const { withTenantSlot, snapshotGovernor } = await import(
    '../src/orchestration/concurrency-governor.js'
  );

  const gates = [deferred(), deferred(), deferred()];
  const started = [false, false, false];

  // Launch 3 tasks against a limit-2 tenant pool. Two should start immediately;
  // the third must QUEUE (backpressure) until a slot frees.
  const tasks = gates.map((g, i) =>
    withTenantSlot('tenant-A', async () => {
      started[i] = true;
      await g.promise;
      return i;
    }),
  );

  await new Promise((r) => setTimeout(r, 50));
  check('2 tasks admitted immediately, 3rd queued', started[0] && started[1] && !started[2], { started });

  const snap1 = snapshotGovernor();
  const tenantA = snap1.tenants.find((t) => t.tenantId === 'tenant-A');
  check('snapshot reports tenantLimit=2', snap1.tenantLimit === 2, snap1.tenantLimit);
  check('snapshot reports 2 in-flight + 1 queued', !!tenantA && tenantA.inFlight === 2 && tenantA.queued === 1, tenantA);

  // Drain: release first slot → queued task starts.
  gates[0].resolve();
  await new Promise((r) => setTimeout(r, 50));
  check('queued task starts after a slot frees', started[2], { started });

  gates[1].resolve();
  gates[2].resolve();
  const results = await Promise.all(tasks);
  check('all 3 tasks complete in order', JSON.stringify(results) === JSON.stringify([0, 1, 2]), results);

  const snap2 = snapshotGovernor();
  const tenantA2 = snap2.tenants.find((t) => t.tenantId === 'tenant-A');
  check('governor fully drained (0 in-flight, 0 queued)', !!tenantA2 && tenantA2.inFlight === 0 && tenantA2.queued === 0, tenantA2);
}

async function validateCostOptimizer(): Promise<void> {
  console.log('\n[2] Cost-optimization suite — advisory token budget (1M/user)');
  const { nvCostOptimizationSuite } = await import(
    '../src/services/jrx-cost-optimization-suite.js'
  );
  const userId = `dry-test-user-${Date.now()}`;

  const fresh = await nvCostOptimizationSuite.checkTokenBudget(userId, 4096);
  check('fresh user is allowed (budget not exhausted)', fresh.allowed === true, fresh);
  check('fresh user reports ~1M remaining', fresh.remainingBudget > 990_000, fresh.remainingBudget);

  // Consume almost the whole budget, then assert the gate denies an over-spend.
  await nvCostOptimizationSuite.deductTokens(userId, 999_000, 'dry-test-model');
  const usage = await nvCostOptimizationSuite.getUserTokenUsage(userId, 'day');
  check('usage tracking reflects deduction', usage.totalTokens === 999_000, usage.totalTokens);

  const overspend = await nvCostOptimizationSuite.checkTokenBudget(userId, 50_000);
  check('over-budget request is denied (enforcement signal)', overspend.allowed === false, overspend);

  const small = await nvCostOptimizationSuite.checkTokenBudget(userId, 500);
  check('within-remaining request still allowed', small.allowed === true, small);
}

async function main(): Promise<void> {
  console.log('Jurexio governor validation (dry, in-memory) — Session-16');
  await validateConcurrencyGovernor();
  await validateCostOptimizer();

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS — concurrency governor + cost optimizer behave as expected.');
    process.exit(0);
  }
  console.error(`RESULT: FAIL — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
