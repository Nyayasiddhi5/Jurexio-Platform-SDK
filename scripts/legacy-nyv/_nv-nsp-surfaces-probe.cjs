/**
 * NSP blocker probe (NYV-7/8/9/10/11) run INSIDE nyv-gateway.
 * .cjs because /app is ESM; uses node 22 global fetch, so no host curl needed.
 *
 * Positive controls: key_len must be 64, /api/nv/health must be 200, and an
 * unauthenticated call must be 401 (proves auth is actually being evaluated, so a
 * 200 elsewhere is a real answer and not an open door).
 */
const KEY = process.env.NYV_SDK_KEY_NSP || '';
const BASE = 'http://127.0.0.1:5000';
const H = {
  'x-api-key': KEY,
  'x-nyv-platform': 'nsp',
  'x-nyv-consent': 'granted',
  'content-type': 'application/json',
};

async function hit(label, method, path, body, tmoMs, headers) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), tmoMs || 60000);
  let code = 0; let text = '';
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: headers === undefined ? H : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    code = r.status;
    text = await r.text();
  } catch (e) {
    text = `FETCH_ERR ${e.name}: ${e.message}`;
  } finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  console.log(`\n--- ${label}\nhttp=${code} time=${ms}ms ${method} ${path}`);
  console.log(`  body: ${text.slice(0, 900)}`);
  return { code, ms, text };
}

(async () => {
  console.log('PC=5150');
  console.log(`key_len=${KEY.length}`);
  if (KEY.length !== 64) { console.log('PROBE_BROKEN: key_len'); process.exit(1); }
  const h = await hit('PC-health', 'GET', '/api/nv/health', undefined, 15000);
  if (h.code !== 200) { console.log('PROBE_BROKEN: health'); process.exit(1); }
  const na = await hit('PC-noauth-expect-401', 'GET', '/api/nv/matter-vault/packs', undefined, 15000, { 'content-type': 'application/json' });
  if (na.code !== 401) console.log('  WARN: expected 401 for unauthenticated call');

  // NYV-7 Matter Vault
  await hit('NYV7-root', 'GET', '/api/nv/matter-vault', undefined, 30000);
  await hit('NYV7-packs', 'GET', '/api/nv/matter-vault/packs', undefined, 30000);
  const c = await hit('NYV7-create', 'POST', '/api/nv/matter-vault/packs', { name: 'NSP probe pack', jurisdiction: 'IN' }, 30000);
  let packId = null;
  try { packId = JSON.parse(c.text)?.data?.vaultId; } catch { /* reported below */ }
  console.log(`  packId=${packId}`);
  if (packId) {
    await hit('NYV7-get-pack', 'GET', `/api/nv/matter-vault/packs/${packId}`, undefined, 30000);
    await hit('NYV7-playbook', 'POST', `/api/nv/matter-vault/packs/${packId}/playbook`, { playbook: 'due-diligence' }, 60000);
  }

  // NYV-8 legal-work
  await hit('NYV8-tasks', 'GET', '/api/nv/legal-work/tasks?limit=1', undefined, 45000);
  await hit('NYV8-runs', 'GET', '/api/nv/legal-work/runs', undefined, 30000);
  await hit('NYV8-evaluate', 'POST', '/api/nv/legal-work/evaluate',
    { instruction: 'Summarise the limitation period for a suit on a promissory note in India.', timeoutMs: 60000 }, 200000);

  // NYV-9 compliance evidence-pack
  await hit('NYV9-health', 'GET', '/api/nv/compliance/health', undefined, 20000);
  await hit('NYV9-evpack-GET', 'GET', '/api/nv/compliance/evidence-pack', undefined, 90000);
  await hit('NYV9-evpack-GET-fw', 'GET', '/api/nv/compliance/evidence-pack?frameworks=ISO42001,SOC2', undefined, 90000);
  await hit('NYV9-evpack-POST', 'POST', '/api/nv/compliance/evidence-pack', { frameworks: 'ISO42001,SOC2' }, 90000);

  // NYV-11 verify-citation vs treatment
  await hit('NYV11-verify-real', 'POST', '/api/nv/knowledge/caselaw/verify-citation', { citation: '(1973) 4 SCC 225' }, 60000);
  await hit('NYV11-treatment-real', 'GET', '/api/nv/knowledge/caselaw/treatment?citation=' + encodeURIComponent('(1973) 4 SCC 225'), undefined, 120000);

  // NYV-10 latency: fts vs hybrid, 5 runs each, interleaved
  console.log('\n=== NYV-10 latency ===');
  const fts = []; const hyb = [];
  for (let i = 0; i < 5; i++) {
    const a = await hit(`NYV10-fts-${i + 1}`, 'GET', '/api/nv/knowledge/caselaw/search?q=anticipatory+bail&mode=fts&limit=10', undefined, 60000);
    if (a.code === 200) fts.push(a.ms);
    const b = await hit(`NYV10-hybrid-${i + 1}`, 'GET', '/api/nv/knowledge/caselaw/search?q=anticipatory+bail&mode=hybrid&limit=10', undefined, 90000);
    if (b.code === 200) hyb.push(b.ms);
  }
  const stat = (a) => a.length ? `n=${a.length} min=${Math.min(...a)} max=${Math.max(...a)} mean=${Math.round(a.reduce((x, y) => x + y, 0) / a.length)} sorted=${JSON.stringify(a.slice().sort((x, y) => x - y))}` : 'n=0 (no 200s)';
  console.log(`\nFTS_STATS  ${stat(fts)}`);
  console.log(`HYBRID_STATS ${stat(hyb)}`);

  // Circuit-breaker state — the shared 503 cause
  await hit('NYS-client-health', 'GET', '/api/nv/knowledge/health', undefined, 30000);
  console.log('DONE=5150');
})();
