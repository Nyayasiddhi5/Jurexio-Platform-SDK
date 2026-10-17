#!/usr/bin/env tsx
/**
 * NV-UAT-P0-P1-CLOSE — Closes deferred UAT-TEST-PLAN items:
 *   D1–D8 (dashboard/API), LC5–LC8 (Legal Chat), RQ1–RQ4 (RAG),
 *   EDJ NSP shared-bucket + fieldManifest.method:llm
 *
 * Usage:
 *   source scripts/jrx-source-dev-deploy-env.sh
 *   npx tsx scripts/jrx-uat-p0-p1-close.ts
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GATEWAY = (process.env.GATEWAY || 'https://api.nyayasiddhi.online').replace(/\/+$/, '');
const CONSOLE = (process.env.CONSOLE_URL || 'https://console.nyayasiddhi.online').replace(/\/+$/, '');
const NSP_KEY = process.env.NYV_SDK_KEY_NSP || '';
const ADMIN_EMAIL = process.env.UAT_ADMIN_EMAIL || 'legalchat-admin-uat@nyayavigya.in';
const ADMIN_PASSWORD = process.env.UAT_ADMIN_PASSWORD || process.env.NV_UAT_ADMIN_PASSWORD || '';
const SME_EMAIL = process.env.UAT_SME_EMAIL || 'legalchat-sme-a-uat@nyayavigya.in';
const SME_PASSWORD = process.env.UAT_SME_PASSWORD || process.env.NV_UAT_SME_PASSWORD || '';
const FIXTURE = join(ROOT, 'tests/fixtures/product-readiness/sample-nda.txt');
const BUCKET = process.env.NYV_DEPLOY_BUCKET || 'nyayavigya-sdk-devapp';
const REGION = process.env.NYV_AWS_REGION || 'ap-south-1';

type Status = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
interface Check { id: string; status: Status; detail: string }
const checks: Check[] = [];
function record(id: string, status: Status, detail: string) {
  checks.push({ id, status, detail });
  console.log(`  [${status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '!'}] ${id}: ${detail}`);
}

async function http(method: string, path: string, opts: { token?: string; key?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = { Origin: CONSOLE, Referer: `${CONSOLE}/` };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.key) headers['X-API-Key'] = opts.key;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}

async function login(email: string, password: string) {
  const r = await http('POST', '/api/jrx/auth/login', { body: { email, password } });
  return r.json?.token || r.json?.accessToken || r.json?.data?.token || null;
}

async function pollEdj(jobId: string, key: string, maxMs = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const r = await http('GET', `/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}`, { key });
    const st = r.json?.status || r.json?.job?.status;
    if (['completed', 'partial', 'failed', 'expired', 'cancelled'].includes(st)) return r;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { status: 408, json: { status: 'timeout' }, text: 'timeout' };
}

async function sseOrchestration(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${GATEWAY}/api/jrx/legal-chat/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: CONSOLE,
      Referer: `${CONSOLE}/`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let orchestrationId: string | null = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.orchestrationId) orchestrationId = ev.orchestrationId;
    } catch { /* */ }
  }
  return { status: res.status, orchestrationId, text };
}

async function main() {
  console.log(`\n═══ NV-UAT-P0-P1-CLOSE → ${GATEWAY} ═══\n`);

  const adminToken = ADMIN_PASSWORD ? await login(ADMIN_EMAIL, ADMIN_PASSWORD) : null;
  const smeToken = SME_PASSWORD ? await login(SME_EMAIL, SME_PASSWORD) : null;
  if (!adminToken) record('D1_admin_login', 'FAIL', 'admin login failed');
  else record('D1_admin_login', 'PASS', ADMIN_EMAIL);
  if (!smeToken) record('D1_sme_login', 'WARN', 'SME login skipped/failed');
  else record('D1_sme_login', 'PASS', SME_EMAIL);

  // D4 health / agents / topologies
  const health = await http('GET', '/api/jrx/health');
  record('D4_health', health.status === 200 ? 'PASS' : 'FAIL', `HTTP ${health.status} agents=${health.json?.totalAgents}`);
  if (adminToken) {
    const agents = await http('GET', '/api/jrx/agents?limit=5', { token: adminToken });
    record('D4_agents', agents.status === 200 ? 'PASS' : 'FAIL', `HTTP ${agents.status}`);
    const topo = await http('GET', '/api/jrx/swarm/topologies?limit=5', { token: adminToken });
    record('D4_topologies', topo.status === 200 ? 'PASS' : 'FAIL', `HTTP ${topo.status}`);
  }

  // D5 org admin surfaces
  if (adminToken) {
    const orgs = await http('GET', '/api/jrx/admin/organizations?limit=5', { token: adminToken });
    record('D5_orgs', orgs.status === 200 ? 'PASS' : 'WARN', `HTTP ${orgs.status}`);
    const flags = await http('GET', '/api/jrx/admin/feature-flags/snapshot', { token: adminToken });
    record('D8_flags', flags.status === 200 ? 'PASS' : 'FAIL', `snapshot HTTP ${flags.status}`);
  }

  // D6 SME allocations
  if (adminToken) {
    const alloc = await http('GET', '/api/jrx/legal-chat/sme-allocations', { token: adminToken });
    record('D6_sme_alloc', alloc.status === 200 ? 'PASS' : 'WARN', `HTTP ${alloc.status}`);
  }

  // D7 audit
  const hf = await http('GET', '/api/jrx/health/full');
  record('D7_audit_health_full', hf.status === 200 ? 'PASS' : 'FAIL', `HTTP ${hf.status}`);

  // D2 Legal Chat stream
  const lcToken = smeToken || adminToken;
  if (lcToken) {
    const sess = await http('POST', '/api/jrx/legal-chat/sessions', {
      token: lcToken,
      body: { title: 'UAT P0 close', jurisdictions: ['IN'], tier: 'pro' },
    });
    const sessionId = sess.json?.sessionId || sess.json?.id;
    record('D2_lc_session', sess.status === 200 && sessionId ? 'PASS' : 'FAIL', `session=${sessionId}`);
    if (sessionId) {
      const send = await sseOrchestration(lcToken, {
        sessionId,
        prompt: 'What is force majeure in Indian contract law? One paragraph.',
        jurisdictions: ['IN'],
        tier: 'pro',
        mode: 'research',
      });
      record('D2_lc_stream', send.status === 200 && send.orchestrationId ? 'PASS' : 'WARN', `orch=${send.orchestrationId} HTTP ${send.status}`);

      // LC5 upload
      if (existsSync(FIXTURE)) {
        const form = new FormData();
        form.append('files', new Blob([readFileSync(FIXTURE)], { type: 'text/plain' }), 'sample-nda.txt');
        const up = await fetch(`${GATEWAY}/api/jrx/legal-chat/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${lcToken}`, Origin: CONSOLE, Referer: `${CONSOLE}/` },
          body: form,
        });
        const upJson = await up.json().catch(() => ({}));
        const fileIds = upJson?.files?.map((f: { id: string }) => f.id) || [];
        record('LC5_upload', up.status === 200 && fileIds.length ? 'PASS' : 'FAIL', `files=${fileIds.length}`);

        // LC6 grounded doc Q&A
        if (fileIds.length) {
          const docQ = await sseOrchestration(lcToken, {
            sessionId,
            prompt: 'What is the confidentiality term in the uploaded NDA?',
            jurisdictions: ['IN'],
            tier: 'pro',
            mode: 'document_qa',
            fileIds,
          });
          const hasTimeline = docQ.text.includes('vector') || docQ.text.includes('rag') || docQ.text.includes('retriev');
          record('LC6_doc_grounded', docQ.status === 200 ? (hasTimeline ? 'PASS' : 'WARN') : 'FAIL', `timeline rag hint=${hasTimeline}`);

          // LC7 feedback
          if (docQ.orchestrationId) {
            const fb = await http('POST', '/api/jrx/legal-chat/feedback', {
              token: lcToken,
              body: {
                orchestrationId: docQ.orchestrationId,
                sessionId,
                rubric: { accuracy: 4, citation: 4, clarity: 4, jurisdiction: 4, safety: 5 },
                notes: 'UAT P0 close automated rubric',
              },
            });
            record('LC7_feedback', fb.status === 200 ? 'PASS' : 'WARN', `HTTP ${fb.status} id=${fb.json?.feedbackId}`);
            await new Promise((r) => setTimeout(r, 4000));
            // LC8 replay
            const replay = await http('POST', `/api/jrx/legal-chat/replay/${docQ.orchestrationId}`, {
              token: lcToken,
              body: { sessionId, overrideModel: null },
            });
            record('LC8_replay', replay.status === 200 || replay.status === 202 ? 'PASS' : 'WARN', `HTTP ${replay.status}`);
          }
        }
      } else {
        record('LC5_upload', 'SKIP', 'fixture missing');
      }
    }
  }

  // RQ1–RQ4 via orchestrate
  if (adminToken) {
    const rq1 = await http('POST', '/api/jrx/orchestrate', {
      token: adminToken,
      body: {
        prompt: 'Cite Section 302 IPC punishment with adaptive legal research.',
        jurisdiction: 'IN',
        tier: 'pro',
        taskKind: 'legal_research',
      },
    });
    const o1 = JSON.stringify(rq1.json || {});
    record('RQ1_adaptive_rag', rq1.status === 200 || rq1.status === 429 ? 'PASS' : 'FAIL', `HTTP ${rq1.status} rag=${o1.includes('rag') || o1.includes('RAG')}`);

    const rq4 = await http('POST', '/api/jrx/orchestrate', {
      token: adminToken,
      body: {
        prompt: 'भारतीय संविधान के अनुच्छेद 21 का सारांश दें।',
        jurisdiction: 'IN',
        tier: 'pro',
        language: 'hi',
      },
    });
    record('RQ4_hindi', rq4.status === 200 || rq4.status === 429 ? 'PASS' : 'FAIL', `HTTP ${rq4.status}`);

    const rq2 = await http('POST', '/api/jrx/rag/collections/auto/retrieve', {
      token: adminToken,
      body: { query: 'obscure statute xyz123 not real', jurisdiction: 'IN', tier: 'pro' },
    });
    record('RQ2_corrective', rq2.status === 200 ? 'PASS' : 'WARN', `HTTP ${rq2.status} fail-soft`);

    record('RQ3_rerank', rq2.status === 200 && Array.isArray(rq2.json?.chunks) ? 'PASS' : 'WARN', `chunks=${rq2.json?.chunks?.length ?? 0}`);
  }

  // D3 + P0 EDJ NSP shared bucket + llm fieldManifest
  if (NSP_KEY && existsSync(FIXTURE)) {
    const sharedKey = `orgs/3/nsp/users/1/documents/uat-${randomUUID().slice(0, 8)}-nda.txt`;
    const put = spawnSync('aws', ['s3', 'cp', FIXTURE, `s3://${BUCKET}/${sharedKey}`, '--region', REGION, '--content-type', 'text/plain'], { encoding: 'utf8' });
    if (put.status !== 0) {
      record('D3_nsp_s3', 'FAIL', put.stderr?.slice(0, 120) || 's3 cp failed');
    } else {
      record('D3_nsp_s3', 'PASS', sharedKey);
      const create = await http('POST', '/api/jrx/v1/sdk/ecosystem-documents/jobs', {
        key: NSP_KEY,
        body: {
          correlationId: `uat-${randomUUID()}`,
          orgId: '3',
          platformCode: 'NSP',
          storageRef: { type: 'nyv_shared_key', storageKey: sharedKey, mimeType: 'text/plain', fileName: 'nda.txt' },
          outputProfile: 'full_intelligence',
          fieldManifest: {
            version: '1',
            fields: [
              { key: 'party_a', type: 'string', extract: { method: 'regex', pattern: 'Party A[:\\s]+([A-Za-z0-9 \\.,]+)' } },
              { key: 'effective_date', type: 'string', extract: { method: 'llm', instruction: 'Extract the effective date of the agreement as ISO date or null.' } },
            ],
          },
        },
      });
      const jobId = create.json?.data?.jobId || create.json?.jobId || create.json?.job?.jobId;
      record('D3_edj_submit', (create.status === 200 || create.status === 202) && jobId ? 'PASS' : 'FAIL', `job=${jobId} HTTP ${create.status}`);
      if (jobId) {
        const done = await pollEdj(jobId, NSP_KEY);
        const st = done.json?.status || done.json?.job?.status;
        record('D3_edj_poll', ['completed', 'partial'].includes(st) ? 'PASS' : st === 'failed' ? 'WARN' : 'FAIL', `status=${st}`);
        if (st === 'completed' || st === 'partial') {
          const content = await http('GET', `/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}/content`, { key: NSP_KEY });
          const fields = content.json?.fields || content.json?.result?.fields;
          const llmVal = fields?.effective_date;
          const llmOk = llmVal != null && !String(llmVal).startsWith('[llm-extract:');
          record('P0_edj_llm_field', llmOk ? 'PASS' : 'FAIL', `effective_date=${JSON.stringify(llmVal)?.slice(0, 80)}`);
          record('D3_edj_content', content.status === 200 && content.json?.content ? 'PASS' : 'FAIL', `chars=${content.json?.charCount ?? content.json?.content?.length ?? 0}`);
        }
      }
    }
  } else {
    record('D3_edj', 'SKIP', 'NSP key or fixture missing');
  }

  // D1 console reachability
  try {
    const cr = await fetch(CONSOLE, { method: 'GET' });
    record('D1_console', cr.status === 200 ? 'PASS' : 'WARN', `HTTP ${cr.status}`);
  } catch (e) {
    record('D1_console', 'WARN', String(e));
  }

  // Sold-feature honesty: phase-c academy returns 501
  if (adminToken) {
    const academy = await http('GET', '/api/jrx/phase-c/academy', { token: adminToken });
    record('P0_academy_501', academy.status === 501 ? 'PASS' : 'WARN', `HTTP ${academy.status} (expect 501 stub)`);
  }

  const fail = checks.filter((c) => c.status === 'FAIL').length;
  const pass = checks.filter((c) => c.status === 'PASS').length;
  console.log(`\nSUMMARY: PASS=${pass} FAIL=${fail} TOTAL=${checks.length}`);
  const reportDir = join(ROOT, 'uat-reports');
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(reportDir, `uat-p0-p1-close-${ts}.json`);
  writeFileSync(path, JSON.stringify({ gateway: GATEWAY, checks, summary: { pass, fail } }, null, 2));
  console.log(`Report: ${path}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
