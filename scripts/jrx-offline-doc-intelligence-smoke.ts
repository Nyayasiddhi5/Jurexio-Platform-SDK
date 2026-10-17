#!/usr/bin/env npx tsx
/**
 * Offline document intelligence smoke — summarize ×3 depths + optional EDJ ingest.
 * Usage:
 *   NYV_BASE_URL=http://127.0.0.1:5000 NYV_API_KEY=… npx tsx scripts/jrx-offline-doc-intelligence-smoke.ts
 */
const BASE = (process.env.NYV_BASE_URL ?? 'http://127.0.0.1:5000').replace(/\/$/, '');
const KEY = process.env.NYV_API_KEY ?? process.env.NYV_SDK_API_KEY ?? '';

const SAMPLE = `
MUTUAL NON-DISCLOSURE AGREEMENT
This Agreement is entered into as of 1 January 2026 between Alpha Pvt Ltd (Party A)
and Beta LLC (Party B). Purpose: evaluating a software licensing transaction.
Confidential Information excludes public information. Term: three (3) years.
Governing Law: India. Dispute resolution: arbitration in Mumbai under the Arbitration
and Conciliation Act, 1996. Each party shall return or destroy Confidential Information
upon written request. Limitation of liability excludes indirect damages.
`.trim();

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': KEY,
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  if (!KEY) {
    console.error('NYV_API_KEY required');
    process.exit(2);
  }
  const depths = ['concise', 'detailed', 'comprehensive'] as const;
  let fail = 0;
  for (const depth of depths) {
    const { status, json } = await post('/api/jrx/gateway/documents/summarize', {
      content: SAMPLE,
      jurisdiction: 'IN',
      documentType: 'nda',
      depth,
    });
    const ok = status >= 200 && status < 300;
    console.log(JSON.stringify({ step: 'summarize', depth, status, ok, dataKeys: Object.keys((json as any)?.data ?? {}) }));
    if (!ok) fail++;
  }

  const draft = await post('/api/jrx/gateway/documents/draft', {
    template: 'nda_mutual',
    jurisdiction: 'IN',
    documentType: 'nda',
    depth: 'detailed',
    parameters: { partyA: 'Alpha Pvt Ltd', partyB: 'Beta LLC', purpose: 'software diligence' },
  });
  console.log(JSON.stringify({ step: 'draft', status: draft.status, ok: draft.status >= 200 && draft.status < 300 }));
  if (draft.status < 200 || draft.status >= 300) fail++;

  const vaultHealth = await fetch(`${BASE}/api/jrx/matter-vault/health`, {
    headers: { 'X-API-Key': KEY, Authorization: `Bearer ${KEY}` },
  });
  console.log(JSON.stringify({ step: 'matter-vault-health', status: vaultHealth.status }));

  if (fail) {
    console.error(`FAIL ${fail} step(s)`);
    process.exit(1);
  }
  console.log('PASS offline doc intelligence smoke');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
