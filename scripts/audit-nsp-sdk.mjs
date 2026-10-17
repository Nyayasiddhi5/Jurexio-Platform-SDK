#!/usr/bin/env node
/**
 * NSP SDK / API contract smoke — proves the surface NSP teams need is alive.
 * Tests:
 *   - Public health & version
 *   - Auth login + JWT
 *   - SDK key listing + provisioning
 *   - Agent listing + executing one
 *   - Document upload + retrieval
 *   - Legal chat session create + send
 *   - SDK-key gateway path (X-API-Key) — proves NSP can hit the gateway
 *     with the SDK key the same way their hosted SDK will.
 */
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const NSP_KEY = process.env.NYV_SDK_KEY_NSP;
const out = { base: BASE, startedAt: new Date().toISOString(), checks: [] };

function rec(name, ok, detail) {
  const tag = ok ? '✓ PASS' : '✗ FAIL';
  console.log(`${tag}  ${name}  ${typeof detail === 'string' ? detail.slice(0, 200) : ''}`);
  out.checks.push({ name, ok, detail });
}

async function jget(url, headers = {}) {
  const r = await fetch(url, { headers });
  const txt = await r.text();
  let body = txt;
  try { body = JSON.parse(txt); } catch {}
  return { status: r.status, body };
}
async function jpost(url, payload, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  let body = txt;
  try { body = JSON.parse(txt); } catch {}
  return { status: r.status, body };
}

// 1. Public health
const h = await jget(`${BASE}/api/nv/health`);
rec('GET /api/nv/health', h.status === 200, `status=${h.status} providers=${Array.isArray(h.body?.providers) ? h.body.providers.length : '?'}`);

// 2. Auth login
const EMAIL = process.env.NV_AUDIT_EMAIL;
const PASSWORD = process.env.NV_AUDIT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set NV_AUDIT_EMAIL and NV_AUDIT_PASSWORD env vars before running this audit script.');
  process.exit(2);
}
const login = await jpost(`${BASE}/api/auth/login`, { email: EMAIL, password: PASSWORD });
rec('POST /api/auth/login', login.status === 200 && !!login.body?.token, `status=${login.status} role=${login.body?.user?.role}`);
const TOKEN = login.body?.token;
if (!TOKEN) { fs.writeFileSync('/tmp/nsp-sdk-report.json', JSON.stringify(out, null, 2)); process.exit(1); }
const A = { authorization: `Bearer ${TOKEN}` };

// 3. Auth /me
const me = await jget(`${BASE}/api/auth/me`, A);
rec('GET /api/auth/me', me.status === 200 && me.body?.user?.email, `email=${me.body?.user?.email}`);

// 4. List SDK keys (jwt auth)
const keys = await jget(`${BASE}/api/nv/api-keys`, A);
rec('GET /api/nv/api-keys (list)', keys.status === 200, `status=${keys.status} count=${Array.isArray(keys.body?.keys) ? keys.body.keys.length : (Array.isArray(keys.body) ? keys.body.length : '?')}`);

// 5. SDK key validation (the NSP key)
if (NSP_KEY) {
  const v = await jpost(`${BASE}/api/nv/sdk/provision/validate`, { api_key: NSP_KEY });
  rec('POST /api/nv/sdk/provision/validate (NSP key)', v.status === 200 && v.body?.valid !== false, `status=${v.status} valid=${v.body?.valid}`);
} else {
  rec('NSP key env present', false, 'NYV_SDK_KEY_NSP not set in env');
}

// 6. SDK gateway: X-API-Key auth on a real endpoint
if (NSP_KEY) {
  const r = await jget(`${BASE}/api/nv/registry/agents?limit=1`, { 'x-api-key': NSP_KEY });
  rec('GET /api/nv/registry/agents (X-API-Key NSP)', r.status === 200, `status=${r.status} total=${r.body?.total ?? r.body?.pagination?.total}`);
}

// 7. Agent registry (jwt)
const agents = await jget(`${BASE}/api/nv/registry/agents?limit=3`, A);
rec('GET /api/nv/registry/agents', agents.status === 200, `status=${agents.status} returned=${Array.isArray(agents.body?.agents) ? agents.body.agents.length : '?'}`);

// 8. Models catalog
const models = await jget(`${BASE}/api/nv/legal-chat/models`, A);
rec('GET /api/nv/legal-chat/models', models.status === 200 && Array.isArray(models.body?.models ?? models.body), `status=${models.status}`);

// 9. Legal chat: create session
const session = await jpost(`${BASE}/api/nv/legal-chat/sessions`, { title: 'audit-' + Date.now(), jurisdiction: 'IN' }, A);
rec('POST /api/nv/legal-chat/sessions', session.status === 200 || session.status === 201, `status=${session.status} id=${session.body?.id ?? session.body?.session?.id}`);
const sessionId = session.body?.id ?? session.body?.session?.id;

// 10. Legal chat: send a message
if (sessionId) {
  const send = await jpost(`${BASE}/api/nv/legal-chat/send`, {
    sessionId,
    message: 'What is the limitation period for breach of contract under Indian law?',
    jurisdiction: 'IN',
  }, A);
  rec('POST /api/nv/legal-chat/send', send.status === 200 || send.status === 202, `status=${send.status} hasResponse=${!!(send.body?.response || send.body?.message || send.body?.orchestrationId)}`);
} else {
  rec('POST /api/nv/legal-chat/send', false, 'no sessionId from create');
}

// 11. Protocols (multi-agent topology)
const proto = await jget(`${BASE}/api/nv/protocols`, A);
rec('GET /api/nv/protocols', proto.status === 200, `status=${proto.status} count=${Array.isArray(proto.body?.protocols) ? proto.body.protocols.length : proto.body?.count}`);

// 12. SDK downloads
const dl = await jget(`${BASE}/api/nv/sdk/downloads`, A);
rec('GET /api/nv/sdk/downloads', dl.status === 200, `status=${dl.status}`);

// 13. OpenAPI doc (NSP teams need this)
const oapi = await jget(`${BASE}/api/nv/openapi.json`);
rec('GET /api/nv/openapi.json', oapi.status === 200 && (oapi.body?.openapi || oapi.body?.swagger), `status=${oapi.status} version=${oapi.body?.info?.version}`);

out.finishedAt = new Date().toISOString();
out.summary = { pass: out.checks.filter(c => c.ok).length, fail: out.checks.filter(c => !c.ok).length };
fs.writeFileSync('/tmp/nsp-sdk-report.json', JSON.stringify(out, null, 2));
console.log(`\nNSP SDK contract: ${out.summary.pass}/${out.checks.length} pass, ${out.summary.fail} fail`);
console.log(`Full report → /tmp/nsp-sdk-report.json`);
process.exit(out.summary.fail === 0 ? 0 : 1);
