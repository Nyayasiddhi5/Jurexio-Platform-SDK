// Re-test previously-fetch-failed jurisdictions in isolation (endpoint is fast now).
const GATEWAY = process.env.GATEWAY.replace(/\/+$/, '');
const TOKEN = process.env.SPOT_TOKEN;
const ORIGIN = GATEWAY;
const COMBOS = [
  { j: 'US', mode: 'free_chat', prompt: 'Summarise the elements of a valid contract under US common law.' },
  { j: 'EU', mode: 'free_chat', prompt: 'Summarise the key data-subject rights under the GDPR.' },
  { j: 'GLOBAL', mode: 'free_chat', prompt: 'Summarise the doctrine of frustration of contract.' },
];
async function createSession(j, mode) {
  const r = await fetch(`${GATEWAY}/api/nv/legal-chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN, 'X-NV-Shell': 'sme' },
    body: JSON.stringify({ title: `spot ${j} ${mode}`, jurisdictions: [j], tier: 'pro', mode }),
  });
  const x = await r.json().catch(() => ({}));
  return x?.session?.id || x?.id || null;
}
async function runOne({ j, mode, prompt }) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 280000);
  try {
    const sessionId = await createSession(j, mode);
    const r = await fetch(`${GATEWAY}/api/nv/legal-chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN, 'X-NV-Shell': 'sme' },
      body: JSON.stringify({ prompt, jurisdictions: [j], mode, sessionId: sessionId ?? undefined }),
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) return { j, mode, ok: false, ms: Date.now() - t0, why: `send ${r.status}` };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', orch, done = false;
    while (true) {
      const { value, done: d } = await reader.read();
      if (d) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const dl = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!dl) continue;
        try {
          const e = JSON.parse(dl.slice(6));
          if (e.orchestrationId) orch = e.orchestrationId;
          if (e.step === 'run_complete') done = true;
          if (e.step === 'run_failed') return { j, mode, ok: false, ms: Date.now() - t0, orch, why: 'run_failed' };
        } catch {}
      }
    }
    return { j, mode, ok: done, ms: Date.now() - t0, orch, why: done ? '' : 'no run_complete' };
  } catch (e) {
    return { j, mode, ok: false, ms: Date.now() - t0, why: e?.name === 'AbortError' ? 'client-timeout 280s' : `throw: ${e?.message || e}` };
  } finally { clearTimeout(timer); }
}
const results = [];
for (const c of COMBOS) {
  const res = await runOne(c);
  results.push(res);
  console.log(`  ${res.ok ? 'PASS' : 'FAIL'} ${res.j.padEnd(7)} ${res.mode.padEnd(12)} ${(res.ms / 1000).toFixed(1)}s orch=${res.orch ?? '-'} ${res.why}`);
}
const pass = results.filter((r) => r.ok).length;
console.log(`\nspotcheck ${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
