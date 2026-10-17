/**
 * JRX-6 analyze-path probe. Runs INSIDE jrx-gateway (node 22, global fetch).
 * Written as .cjs because /app is ESM. No imports, so /tmp module resolution
 * is irrelevant — but it is copied into /app anyway per NV gotcha.
 *
 * Positive controls: /api/nv/health must be 200, key length must be 64, and the
 * court-filing fixture must exceed 500 chars. Any of these failing means the
 * instrument is broken and the run says nothing about the platform.
 */
const KEY = process.env.JRX_SDK_KEY_NSP || '';
const BASE = 'http://127.0.0.1:5000';
const H = {
  'x-api-key': KEY,
  'x-jrx-platform': 'nsp',
  'x-jrx-consent': 'granted',
  'content-type': 'application/json',
};

const COURT_DOC = `IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
Criminal Petition No. 4471 of 2025
Ram Kumar Reddy, S/o Late Venkat Reddy, aged 42 years ..... PETITIONER
AND
The State of Telangana, rep. by Public Prosecutor ..... RESPONDENT
The petitioner seeks anticipatory bail under Section 438 of the Code of Criminal Procedure, 1973
in connection with FIR No. 233 of 2025 registered at Banjara Hills Police Station for offences
punishable under Sections 420 and 406 of the Indian Penal Code, 1860 and Section 66D of the
Information Technology Act, 2000. The matter is listed before the Hon'ble Justice A. Rajashekar
Reddy on 28 March 2025. The petitioner undertakes to deposit Rs. 5,00,000 within 30 days.
PRAYER: It is prayed that this Hon'ble Court may be pleased to grant anticipatory bail to the
petitioner pending disposal of the investigation.`;

/* Negative control: ordinary chat text. A status field that reports the same value
 * here as for the filing above is indistinguishable from no status field at all. */
const TRIVIAL = 'Hello there. Please tell me the weather in Hyderabad today and nothing else at all.';

const SHAPE_KEYS = [
  'analysisStatus', 'analysisStatusReason', 'status', 'fieldSource', 'fieldCount',
  'degraded', 'degradeReason', 'source', 'isIndianCourtDocument', 'detectedDocumentType',
];
const ARRAY_KEYS = [
  'entities', 'statutes', 'deadlines', 'risks', 'obligations',
  'entitiesFlat', 'deadlinesFlat', 'risksFlat', 'obligationsFlat', 'fields',
];

function summarise(d) {
  const out = [];
  if (!d || typeof d !== 'object') return [`  NOT_OBJ ${String(d).slice(0, 200)}`];
  const body = d.data && typeof d.data === 'object' ? d.data : d;
  for (const k of SHAPE_KEYS) {
    if (k in body) out.push(`  ${k} = ${JSON.stringify(body[k]).slice(0, 200)}`);
  }
  for (const k of ARRAY_KEYS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (Array.isArray(v)) out.push(`  ${k}: ARRAY len=${v.length}`);
    else if (v && typeof v === 'object') {
      const lens = Object.fromEntries(
        Object.entries(v).map(([kk, vv]) => [kk, Array.isArray(vv) ? vv.length : typeof vv]),
      );
      out.push(`  ${k}: CONTAINER ${JSON.stringify(lens)}`);
    } else out.push(`  ${k}: ${typeof v}`);
  }
  out.push(`  ALL_TOP_KEYS = ${JSON.stringify(Object.keys(body).sort())}`);
  return out;
}

async function hit(label, method, path, body, tmoMs) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), tmoMs || 120000);
  let code = 0; let text = '';
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: H,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    code = r.status;
    text = await r.text();
  } catch (e) {
    text = `FETCH_ERR ${e.name}: ${e.message}`;
  } finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  console.log(`\n=== ${label}\nhttp=${code} time=${ms}ms ${method} ${path}`);
  if (code >= 200 && code < 300) {
    let j = null;
    try { j = JSON.parse(text); } catch { console.log(`  NON_JSON ${text.slice(0, 300)}`); }
    if (j) console.log(summarise(j).join('\n'));
  } else {
    console.log(`  raw: ${text.slice(0, 500)}`);
  }
  return { code, text, ms };
}

(async () => {
  console.log('PC=5150');
  console.log(`key_len=${KEY.length} doc_len=${COURT_DOC.length}`);
  if (KEY.length !== 64) { console.log('PROBE_BROKEN: key_len!=64'); process.exit(1); }
  if (COURT_DOC.length < 500) { console.log('PROBE_BROKEN: fixture too small'); process.exit(1); }
  const h = await hit('PC-health', 'GET', '/api/nv/health', undefined, 15000);
  if (h.code !== 200) { console.log('PROBE_BROKEN: health!=200'); process.exit(1); }

  await hit('P1-gateway-COURTDOC', 'POST', '/api/nv/gateway/documents/analyze',
    { content: COURT_DOC, type: 'court_filing', jurisdiction: 'IN' }, 180000);
  await hit('P2-docspipeline-analyze-COURTDOC', 'POST', '/api/nv/sdk/docs-pipeline/documents/analyze',
    { documentText: COURT_DOC, jurisdiction: 'IN' }, 180000);
  await hit('P2b-docspipeline-intelligence-COURTDOC', 'POST', '/api/nv/sdk/docs-pipeline/documents/intelligence',
    { documentText: COURT_DOC, jurisdiction: 'IN' }, 180000);
  await hit('P3-orchestrate-COURTDOC', 'POST', '/api/nv/orchestrate',
    { prompt: 'Analyse this court document and extract the structured fields.', content: COURT_DOC, taskType: 'analysis', jurisdiction: 'IN' }, 240000);

  await hit('N1-gateway-TRIVIAL', 'POST', '/api/nv/gateway/documents/analyze',
    { content: TRIVIAL, type: 'legal', jurisdiction: 'IN' }, 180000);
  await hit('N2-docspipeline-TRIVIAL', 'POST', '/api/nv/sdk/docs-pipeline/documents/analyze',
    { documentText: TRIVIAL, jurisdiction: 'IN' }, 180000);
  await hit('N3-orchestrate-TRIVIAL', 'POST', '/api/nv/orchestrate',
    { prompt: TRIVIAL, taskType: 'analysis', jurisdiction: 'IN' }, 240000);

  console.log('DONE=5150');
})();
