#!/usr/bin/env node
/**
 * NV-FB399-001 — counsel-grade durable probe (Queen comprehensive path).
 *
 * Default identity: superadmin@demo.nyayasiddhi.online (ssadmin demo org).
 * Loads password from NV_DEMO_PASSWORD env or /opt/Nyayavigya/secrets/.env.production on EC2.
 *
 * Flow:
 *   1) JWT login (demo ssadmin) OR NSP SDK key (NYV_PROBE_USE_NSP=1)
 *   2) POST /api/nv/orchestrate — legal-draft + draftLength comprehensive (counsel worker path)
 *   3) Poll /api/nv/queue/status/:jobId when 202+jobId; else treat sync body as completed
 *   4) PASS when status=completed and word_count >= MIN_WORDS (default 80)
 *
 * NV-SECRETS-001: never log passwords or API keys.
 */
import fs from 'node:fs';
import process from 'node:process';

const BASE = process.env.NYV_API_BASE || 'https://api.nyayasiddhi.online';
const CONSOLE_ORIGIN = process.env.NYV_CONSOLE_ORIGIN || 'https://console.nyayasiddhi.online';
const EMAIL = process.env.NYV_PROBE_EMAIL || 'superadmin@demo.nyayasiddhi.online';
const MIN_WORDS = Number(process.env.NYV_PROBE_MIN_WORDS || 80);
const MAX_POLLS = Number(process.env.NYV_PROBE_MAX_POLLS || 120);
const POLL_MS = Number(process.env.NYV_PROBE_POLL_MS || 5000);
const ORCH_TIMEOUT_MS = Number(process.env.NYV_PROBE_ORCH_TIMEOUT_MS || 600_000);
const USE_NSP = ['1', 'true', 'yes'].includes(String(process.env.NYV_PROBE_USE_NSP || '').toLowerCase());

const WS_PROMPT =
  process.env.NYV_PROBE_PROMPT ||
  'Draft a comprehensive written statement for a commercial suit in Delhi. Include cause title, preliminary objections, para-wise traverse, and verification. Use placeholders for dates and amounts.';

function loadCanonicalEnv() {
  const paths = [
    process.env.NYV_CANONICAL_ENV,
    '/opt/Nyayavigya/secrets/.env.production',
    '../.local/secrets/runtime.env',
  ].filter(Boolean);
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const i = t.indexOf('=');
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (process.env[k] == null || process.env[k] === '') process.env[k] = v;
      }
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function login(email, password) {
  const browserHeaders = {
    'Content-Type': 'application/json',
    Origin: CONSOLE_ORIGIN,
    Referer: `${CONSOLE_ORIGIN}/`,
  };
  const { status, body } = await fetchJson(`${BASE}/api/nv/auth/login`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify({ email, password }),
    timeoutMs: 30_000,
  });
  if (status !== 200 || !body?.token) {
    throw new Error(`login http=${status} success=${body?.success} error=${body?.error || body?.message || 'no token'}`);
  }
  const me = await fetchJson(`${BASE}/api/nv/auth/me`, {
    headers: { Authorization: `Bearer ${body.token}`, Origin: CONSOLE_ORIGIN, Referer: `${CONSOLE_ORIGIN}/` },
    timeoutMs: 15_000,
  });
  const orgId = me.body?.orgId ?? me.body?.data?.orgId ?? me.body?.user?.orgId;
  console.log(`LOGIN ok email=${email} org_id=${orgId ?? 'null'} role=${me.body?.role ?? me.body?.user?.role ?? '?'}`);
  return { token: body.token, orgId };
}

function authHeaders(token, nspKey) {
  if (nspKey) {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': nspKey,
      'X-NYV-Platform': 'nsp',
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    Origin: CONSOLE_ORIGIN,
    Referer: `${CONSOLE_ORIGIN}/`,
  };
}

async function submitOrchestrate(headers) {
  const payload = {
    prompt: WS_PROMPT,
    taskType: 'legal-draft',
    jurisdiction: 'IN',
    tier: 'enterprise',
    parameters: { documentType: 'written_statement' },
    options: { draftLength: 'comprehensive' },
  };
  const { status, body } = await fetchJson(`${BASE}/api/nv/orchestrate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    timeoutMs: ORCH_TIMEOUT_MS,
  });
  return { status, body };
}

async function pollQueue(token, jobId) {
  for (let i = 0; i < MAX_POLLS; i++) {
    const { status, body } = await fetchJson(`${BASE}/api/nv/queue/status/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 30_000,
    });
    const data = body?.data ?? body;
    const st = data?.status ?? 'unknown';
    console.log(`POLL n=${i + 1} http=${status} status=${st} progress=${data?.progress ?? '?'}`);
    if (st === 'completed') return { status: st, data };
    if (st === 'failed') throw new Error(`job failed: ${data?.error || 'unknown'}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`poll timeout after ${MAX_POLLS} attempts`);
}

function extractContent(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return (
    data.content ||
    data.output?.content ||
    data.result?.content ||
    data.text ||
    data.output?.text ||
    ''
  );
}

async function main() {
  const canon = loadCanonicalEnv();
  console.log(`PROBE fb399-counsel-durable base=${BASE} canon=${canon ?? 'env-only'} min_words=${MIN_WORDS}`);

  let token;
  let nspKey;
  if (USE_NSP) {
    nspKey = process.env.NYV_SDK_KEY_NSP;
    if (!nspKey || nspKey.length < 16) throw new Error('NYV_PROBE_USE_NSP=1 but NYV_SDK_KEY_NSP missing');
    console.log(`AUTH mode=NSP key_len=${nspKey.length}`);
  } else {
    const password = process.env.NV_DEMO_PASSWORD;
    if (!password || password.length < 4) throw new Error('NV_DEMO_PASSWORD missing (set env or canonical secrets file)');
    console.log(`AUTH mode=JWT email=${EMAIL} password_len=${password.length}`);
    ({ token } = await login(EMAIL, password));
  }

  const headers = authHeaders(token, nspKey);
  console.log('SUBMIT orchestrate legal-draft comprehensive…');
  const t0 = Date.now();
  const { status, body } = await submitOrchestrate(headers);
  const ms = Date.now() - t0;
  console.log(`SUBMIT http=${status} ms=${ms} success=${body?.success}`);

  if (status === 429 || body?.error?.code === 'CREDIT_CAP_EXCEEDED' || body?.details?.code === 'CREDIT_CAP_EXCEEDED') {
    console.log('FAIL credit_cap_exceeded — reset org credits on NYV and retry');
    process.exit(10);
  }

  let taskStatus = 'completed';
  let data = body?.data ?? body;

  if (status === 202) {
    const jobId = data?.jobId || data?.id;
    if (!jobId) throw new Error('202 without jobId');
    console.log(`ASYNC jobId=${jobId} — polling…`);
    const polled = await pollQueue(token, jobId);
    taskStatus = polled.status;
    data = polled.data?.output ?? polled.data;
  } else if (status !== 200) {
    throw new Error(`orchestrate http=${status} error=${JSON.stringify(body?.error || body?.details || body).slice(0, 300)}`);
  }

  const content = extractContent(data);
  const words = wordCount(content);
  const path = data?.routing?.path ?? data?.routing ?? data?.orchestration?.path;
  console.log(`RESULT task_status=${taskStatus} word_count=${words} content_len=${content.length} path=${path ?? '?'}`);

  if (taskStatus !== 'completed') {
    console.log('FAIL task not completed');
    process.exit(11);
  }
  if (words < MIN_WORDS) {
    console.log(`FAIL word_count=${words} < ${MIN_WORDS}`);
    process.exit(12);
  }
  console.log(`PROBE PASS word_count=${words} task_status=${taskStatus}`);
}

main().catch((e) => {
  console.error('PROBE ERROR', e.message);
  process.exit(1);
});
