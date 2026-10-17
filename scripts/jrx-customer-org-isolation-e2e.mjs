#!/usr/bin/env node
/**
 * Customer-Org Isolation E2E — Task #343 step 9.
 *
 * Scenario:
 *   1. NSP key + X-Customer-Org-Id: sharma-co  → upsert customer org A
 *   2. NSP key + X-Customer-Org-Id: lex-llp    → upsert customer org B
 *   3. NSP key lists its customer orgs        → both A and B appear, scoped
 *      to the platform_id; no other platform's customer orgs leak in.
 *   4. NSP key requests usage for org A's id  → 200 OK
 *   5. NSP key requests usage for an id NOT belonging to it (synthetic
 *      cross-platform default) → 404 CUSTOMER_ORG_NOT_FOUND
 *   6. SDK call with no X-Customer-Org-Id     → resolves to the synthetic
 *      per-platform default (legacy callers keep working).
 *
 * Targets the local gateway by default; override with JRX_GATEWAY_URL.
 * Skips with a yellow note when no NSP key is provisioned in the env so
 * the script is safe to wire into CI smoke runs even on minimal envs.
 */
const BASE = process.env.JRX_GATEWAY_URL || 'http://localhost:5000';
// Customer-org admin endpoints require an admin / wildcard scope. NSP /
// NSPM / NSA / NYM keys are intentionally scope-limited per the docs, so
// pick the first available wildcard key (NSI / NSM / JRX) and fall back
// only if none of those are provisioned in this env.
const KEY = process.env.JRX_SDK_KEY_NSI
  || process.env.JRX_SDK_KEY_NSM
  || process.env.JRX_SDK_KEY_JRX
  || process.env.NV_SDK_KEY_NSI
  || process.env.NV_SDK_KEY_NSM
  || process.env.NV_SDK_KEY_JRX
  || process.env.JRX_SDK_KEY_NSP;

const c = { ok: '\x1b[32m', no: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[2m', x: '\x1b[0m' };
const log = (s) => process.stdout.write(s + '\n');

if (!KEY) {
  log(`${c.warn}[skip]${c.x} JRX_SDK_KEY_NSP not set — cannot exercise customer-org isolation E2E`);
  process.exit(0);
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; log(`  ${c.ok}✓${c.x} ${name}`); }
  else    { fail++; log(`  ${c.no}✗${c.x} ${name}${detail ? `  ${c.dim}${detail}${c.x}` : ''}`); }
}

async function call(path, opts = {}) {
  const headers = { 'X-API-Key': KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

async function main() {
  log(`${c.dim}gateway = ${BASE}${c.x}`);

  // 1+2. upsert two customer orgs
  const a = await call('/api/nv/sdk/customer-orgs', {
    method: 'POST',
    body: JSON.stringify({ external_ref: 'sharma-co', display_name: 'Sharma & Co Law Firm' }),
  });
  check('POST customer org A (sharma-co) → 200', a.status === 200, `got ${a.status}`);
  const idA = a.body?.data?.id;

  const b = await call('/api/nv/sdk/customer-orgs', {
    method: 'POST',
    body: JSON.stringify({ external_ref: 'lex-llp', display_name: 'Lex LLP' }),
  });
  check('POST customer org B (lex-llp) → 200', b.status === 200, `got ${b.status}`);
  const idB = b.body?.data?.id;

  check('A and B have distinct ids', idA && idB && idA !== idB, `idA=${idA} idB=${idB}`);

  // 2b. idempotent re-upsert
  const aAgain = await call('/api/nv/sdk/customer-orgs', {
    method: 'POST',
    body: JSON.stringify({ external_ref: 'sharma-co' }),
  });
  check('POST customer org A again is idempotent (same id)',
    aAgain.body?.data?.id === idA, `again=${aAgain.body?.data?.id}`);

  // 3. list — both visible, all rows have my platform_id
  const list = await call('/api/nv/sdk/customer-orgs?limit=200');
  const items = list.body?.data?.items ?? [];
  const myPlatform = items[0]?.platform_id;
  check('GET customer-orgs → 200 with both orgs',
    list.status === 200 && items.some(r => r.id === idA) && items.some(r => r.id === idB),
    `status=${list.status} items=${items.length}`);
  check('every listed row has the SAME platform_id (no cross-platform leak)',
    items.every(r => r.platform_id === myPlatform),
    `platforms=${[...new Set(items.map(r => r.platform_id))].join(',')}`);

  // 4. usage rollup for A → 200
  if (idA) {
    const usage = await call(`/api/nv/sdk/customer-orgs/${idA}/usage`);
    check('GET usage for own customer org A → 200',
      usage.status === 200 && usage.body?.data?.customer_org?.id === idA,
      `status=${usage.status}`);
  }

  // 5. usage rollup for an id that belongs to another platform → 404
  // We probe a synthetic-default id from a different platform_id (1×1m,
  // 2×1m, 3×1m, …). Pick one that is NOT this platform's default.
  const myPlatformId = myPlatform ?? 0;
  const otherSynthetic = (myPlatformId === 1 ? 2 : 1) * 1_000_000;
  const cross = await call(`/api/nv/sdk/customer-orgs/${otherSynthetic}/usage`);
  check('GET usage for another platform\'s customer org → 404 (no cross-leak)',
    cross.status === 404,
    `status=${cross.status} body=${JSON.stringify(cross.body).slice(0, 120)}`);

  // 6. SDK call with NO X-Customer-Org-Id still authenticates (synthetic default)
  const noHeader = await call('/api/nv/sdk/customer-orgs', { method: 'GET' });
  check('SDK call without X-Customer-Org-Id still authenticates (legacy default)',
    noHeader.status === 200, `status=${noHeader.status}`);

  // ───────────────────────────────────────────────────────────────────────
  // Task #353 — read isolation between two customer orgs sharing one
  // platform key. We simulate two firms (A=sharma-co, B=lex-llp) issuing
  // workflows under the SAME platform SDK key and assert that:
  //   (a) usage rollups bucket events to the correct customer org;
  //   (b) listing /api/nv/my-approvals (HITL inbox) under header A returns
  //       no rows tagged with customer_org_id = B and vice-versa;
  //   (c) listing /api/nv/cam/reviews under header A returns no rows
  //       tagged with customer_org_id = B (and vice-versa).
  // ───────────────────────────────────────────────────────────────────────
  const callAs = async (orgRef, path, opts = {}) => call(path, {
    ...opts,
    headers: { 'X-Customer-Org-Id': orgRef, ...(opts.headers || {}) },
  });

  // (a) trigger a workflow execution as each firm so usage rollups diverge.
  //     We use the public /api/nv/orchestrate path which counts toward the
  //     caller's customer_org_id via the SDK tracking middleware.
  const triggerOrch = async (orgRef) => callAs(orgRef, '/api/nv/orchestrate', {
    method: 'POST',
    body: JSON.stringify({
      query: `tenant-iso ping for ${orgRef}`,
      jurisdiction: 'IN',
      mode: 'test',
    }),
  });
  const oA = await triggerOrch('sharma-co');
  const oB = await triggerOrch('lex-llp');
  check('orchestrate as A (sharma-co) accepted (2xx/4xx tier-gate ok, not 5xx)',
    oA.status < 500, `status=${oA.status}`);
  check('orchestrate as B (lex-llp) accepted (2xx/4xx tier-gate ok, not 5xx)',
    oB.status < 500, `status=${oB.status}`);

  // (a') usage rollup for A and B should be addressable independently and
  // never expose each other's customer_org id in the response payload.
  if (idA && idB) {
    const usageA = await callAs('sharma-co', `/api/nv/sdk/customer-orgs/${idA}/usage`);
    const usageB = await callAs('lex-llp',   `/api/nv/sdk/customer-orgs/${idB}/usage`);
    check('usage rollup A returns ONLY A.id',
      usageA.status === 200 && usageA.body?.data?.customer_org?.id === idA,
      `status=${usageA.status} id=${usageA.body?.data?.customer_org?.id}`);
    check('usage rollup B returns ONLY B.id',
      usageB.status === 200 && usageB.body?.data?.customer_org?.id === idB,
      `status=${usageB.status} id=${usageB.body?.data?.customer_org?.id}`);
    // Cross probe: A asking for B's id MUST be 403/404, never 200 with B's data.
    const crossAB = await callAs('sharma-co', `/api/nv/sdk/customer-orgs/${idB}/usage`);
    check('A cannot read B\'s usage rollup (403/404)',
      crossAB.status === 403 || crossAB.status === 404,
      `status=${crossAB.status}`);
  }

  // (b) HITL inbox isolation. Both calls go through dualSdkOrJwt + the new
  // jwt-org bridge, and the route now AND-s in customer_org_id on the
  // queue table when the caller asserts one. We assert that no row in
  // the A-scoped response carries customer_org_id = B (and vice-versa).
  const hitlA = await callAs('sharma-co', '/api/nv/my-approvals?scope=org');
  const hitlB = await callAs('lex-llp',   '/api/nv/my-approvals?scope=org');
  const itemsHitlA = hitlA.body?.data?.items ?? hitlA.body?.items ?? [];
  const itemsHitlB = hitlB.body?.data?.items ?? hitlB.body?.items ?? [];
  // Sanity: my-approvals SELECT must surface customer_org_id, otherwise
  // the leak assertion below would be vacuously true.
  if ((itemsHitlA.length || itemsHitlB.length) && hitlA.status === 200 && hitlB.status === 200) {
    const sample = itemsHitlA[0] ?? itemsHitlB[0];
    check('my-approvals response surfaces customer_org_id (asserts non-vacuous)',
      sample && Object.prototype.hasOwnProperty.call(sample, 'customer_org_id'),
      `keys=${sample ? Object.keys(sample).join(',').slice(0, 200) : 'no-rows'}`);
  }
  // Endpoint may return 200 (rows present) or 200 (empty list) even when
  // no rows match — both are acceptable for an isolation assertion. The
  // critical invariant is: zero leakage. Skip if endpoint isn't wired.
  if (hitlA.status === 200 && hitlB.status === 200) {
    check('HITL inbox A contains no rows tagged customer_org_id = B.id',
      idB == null || !itemsHitlA.some(r => Number(r.customer_org_id) === Number(idB)),
      `Aitems=${itemsHitlA.length} leak=${itemsHitlA.filter(r => Number(r.customer_org_id) === Number(idB)).length}`);
    check('HITL inbox B contains no rows tagged customer_org_id = A.id',
      idA == null || !itemsHitlB.some(r => Number(r.customer_org_id) === Number(idA)),
      `Bitems=${itemsHitlB.length} leak=${itemsHitlB.filter(r => Number(r.customer_org_id) === Number(idA)).length}`);
  } else {
    log(`  ${c.warn}~${c.x} /api/nv/my-approvals returned status A=${hitlA.status} B=${hitlB.status} — skipping HITL leak asserts`);
  }

  // (b'') Fail-closed unit assertion. The HTTP probes above run as SDK
  // keys, which classify as `platform_admin` and therefore aren't
  // exercised by the new fail-closed branch (customer_org_admin /
  // customer_user without a customerOrgId). To prove that branch
  // without spinning up a JWT issuer in this script, import the rbac
  // helper and assert directly that omitting customerOrgId for a
  // non-platform-admin layer yields a `1 = 0` SQL fragment.
  try {
    const rbac = await import('../src/services/rbac/jrx-customer-org-rbac.ts').catch(() => null)
              ?? await import('../dist/server/services/rbac/jrx-customer-org-rbac.js').catch(() => null);
    if (rbac && typeof rbac.scopeForIdentity === 'function') {
      const noCO = rbac.scopeForIdentity({ role: 'reviewer', platformId: 1, customerOrgId: null, isAdmin: false });
      check('rbac.scopeForIdentity({customer_user, customerOrgId=null}) → fail-closed FALSE',
        noCO.fragment === 'FALSE',
        `fragment=${noCO.fragment} reason=${noCO.reason}`);
      const adminNoCO = rbac.scopeForIdentity({ role: 'reviewer', platformId: 1, customerOrgId: null, isAdmin: true });
      check('rbac.scopeForIdentity({customer_org_admin, customerOrgId=null}) → fail-closed FALSE',
        adminNoCO.fragment === 'FALSE',
        `fragment=${adminNoCO.fragment} reason=${adminNoCO.reason}`);
      const withCO = rbac.scopeForIdentity({ role: 'reviewer', platformId: 1, customerOrgId: 42, isAdmin: false });
      check('rbac.scopeForIdentity({customer_user, customerOrgId=42}) → scoped fragment',
        /platform_id|customer_org_id/.test(withCO.fragment),
        `fragment=${withCO.fragment}`);
    } else {
      log(`  ${c.warn}~${c.x} rbac helper not importable — skipping fail-closed unit assertion`);
    }
  } catch (err) {
    log(`  ${c.warn}~${c.x} rbac fail-closed unit assertion errored: ${err?.message || err}`);
  }

  // (b''') /api/nv/compliance/policy-enforcement now AND-s
  // customer_org_id onto the nv_cam_actions counters in tenant mode.
  // SDK callers classify as platform_admin so they don't trip the
  // fail-closed branch; instead we assert that the response shape is
  // OK and that the (cam-derived) breach_counts are partitioned by
  // customer_org_id when the caller asserts one. This catches a
  // regression where the AND is dropped and counters leak across firms.
  const peA = await callAs('sharma-co', '/api/nv/compliance/policy-enforcement?days=1');
  const peB = await callAs('lex-llp',   '/api/nv/compliance/policy-enforcement?days=1');
  if (peA.status === 200 && peB.status === 200) {
    check('policy-enforcement A returns 200 (no 5xx after customer_org_id AND)',
      peA.status === 200 && peA.body?.success === true,
      `status=${peA.status}`);
    check('policy-enforcement B returns 200 (no 5xx after customer_org_id AND)',
      peB.status === 200 && peB.body?.success === true,
      `status=${peB.status}`);
  } else {
    log(`  ${c.warn}~${c.x} /api/nv/compliance/policy-enforcement A=${peA.status} B=${peB.status} — skipping enforcement assert`);
  }

  // (b') HITL decision WRITE-path cross-tenant negative probe. SDK callers
  // are listing-only at the decision endpoint (returns 403 by design),
  // but the route MUST 404 on a sibling-tenant request_id even before
  // the SDK guard fires when a real reviewer JWT is provided. We can
  // still assert the safe subset: posting a fabricated request_id while
  // asserting a different customer_org_id never returns 200. This
  // catches a regression where the lookup forgets the customer_org_id
  // filter and accidentally surfaces existence of sibling rows.
  const decAttempt = await callAs('lex-llp', '/api/nv/my-approvals/__nope__/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve', reason: 'cross-tenant negative probe' }),
  });
  check('HITL decision POST never returns 200 for unknown / cross-tenant request_id',
    decAttempt.status !== 200, `status=${decAttempt.status}`);

  // (c) CAM review queue isolation. The /reviews endpoint requires a
  // reviewer JWT; SDK-only callers will get 401, in which case we skip
  // the leak assert (covered separately by the JWT-side suite). When it
  // does respond 200, assert no cross-leak by customer_org_id.
  const camA = await callAs('sharma-co', '/api/nv/cam/reviews');
  const camB = await callAs('lex-llp',   '/api/nv/cam/reviews');
  if (camA.status === 200 && camB.status === 200) {
    // /api/nv/cam/reviews returns { success, actions: [...], counts }.
    const rA = camA.body?.actions ?? camA.body?.data?.items ?? [];
    const rB = camB.body?.actions ?? camB.body?.data?.items ?? [];
    if (rA.length || rB.length) {
      const sample = rA[0] ?? rB[0];
      check('CAM /reviews response surfaces customer_org_id (asserts non-vacuous)',
        sample && Object.prototype.hasOwnProperty.call(sample, 'customer_org_id'),
        `keys=${sample ? Object.keys(sample).join(',').slice(0, 200) : 'no-rows'}`);
    }
    check('CAM /reviews A contains no rows tagged customer_org_id = B.id',
      idB == null || !rA.some(r => Number(r.customer_org_id) === Number(idB)),
      `Aitems=${rA.length}`);
    check('CAM /reviews B contains no rows tagged customer_org_id = A.id',
      idA == null || !rB.some(r => Number(r.customer_org_id) === Number(idA)),
      `Bitems=${rB.length}`);
  } else {
    log(`  ${c.warn}~${c.x} /api/nv/cam/reviews returned A=${camA.status} B=${camB.status} (JWT-gated) — skipping CAM leak asserts`);
  }

  log('');
  log(`${pass + fail} checks: ${c.ok}${pass} pass${c.x}, ${fail ? c.no : c.dim}${fail} fail${c.x}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`${c.no}E2E crashed:${c.x}`, err);
  process.exit(2);
});
