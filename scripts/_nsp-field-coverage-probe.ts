/**
 * NSP field coverage probe — NV-SECRETS-001: field names only, no PII values.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadRuntimeEnv(): void {
  const candidates = [
    resolve(process.cwd(), '../.local/secrets/runtime.env'),
    resolve(process.cwd(), '.local/secrets/runtime.env'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    break;
  }
}

const IDENTITY_FIELDS = [
  'cnr', 'diaryNumber', 'courtName', 'courtType', 'caseNo', 'caseTitle',
  'caseStatus', 'filingNumber', 'filingNumberYear', 'filingDate',
  'decisionDate', 'disposalNature', 'citation', 'policeStation',
  'firNo', 'firYear', 'bench', 'complexName',
] as const;

function isNonempty(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'object') return Object.keys(val as object).length > 0;
  return true;
}

async function resolveCnr(
  api: string,
  key: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const res = await fetch(`${api}/api/jrx/v1/sdk/cnr/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
      'X-NYV-Platform': 'nsp',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  return { status: res.status, payload };
}

function report(label: string, payload: Record<string, unknown>): void {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const fields = (data.fields ?? {}) as Record<string, { value?: unknown }>;
  const meta = (data.meta ?? {}) as Record<string, unknown>;
  const counts = (meta.counts ?? {}) as Record<string, number>;
  const sources = (data.sourcesTried ?? []) as string[];
  const populated: string[] = [];
  const empty: string[] = [];
  for (const f of IDENTITY_FIELDS) {
    const val = fields[f]?.value;
    if (isNonempty(val)) populated.push(f);
    else empty.push(f);
  }
  const hearings = (fields.hearings?.value ?? []) as unknown[];
  const acts = (fields.actsSections?.value ?? []) as unknown[];
  const advocates = (fields.advocates?.value ?? []) as unknown[];
  const docs = (data.documents ?? []) as unknown[];
  const cc = (data.caseCreate ?? {}) as Record<string, unknown>;
  const clients = (cc.clients ?? []) as Array<Record<string, unknown>>;
  const partyPii = new Set<string>();
  for (const c of [...clients, ...((cc.opposingParties ?? []) as Array<Record<string, unknown>>)]) {
    for (const p of ['address', 'phone', 'email', 'fatherName'] as const) {
      if (c[p]) partyPii.add(p);
    }
  }
  const hearingDocUrls = (hearings as Array<{ docUrl?: string }>).filter((h) => h.docUrl).length;
  console.log(`=== ${label} ===`);
  console.log(`http_status=200 status=${data.status} source=${data.source} sourcesTried=${sources.join(',')}`);
  console.log(`populated_identity(${populated.length}): ${populated.join(',')}`);
  console.log(`empty_identity(${empty.length}): ${empty.join(',')}`);
  console.log(
    `hearings_len=${hearings.length} timeline_len=${((cc.timeline ?? []) as unknown[]).length} counts_hearings=${counts.hearings ?? 'null'} counts_acts=${counts.acts ?? 'null'}`,
  );
  console.log(`acts_len=${acts.length} advocates_len=${advocates.length} documents_len=${docs.length}`);
  console.log(`party_pii_nonempty=${partyPii.size ? [...partyPii].join(',') : 'none'}`);
  console.log(`hearing_docUrl_count=${hearingDocUrls}`);
}

async function main(): Promise<void> {
  loadRuntimeEnv();
  const api = (process.env.NYV_API_BASE_URL ?? 'https://api.nyayasiddhi.online').replace(/\/$/, '');
  const key = (process.env.NYV_SDK_KEY_NSP ?? '').trim();
  if (key.length < 16) {
    console.error('PROBE_SKIP: NYV_SDK_KEY_NSP not in runtime.env');
    process.exit(2);
  }
  console.log(`API=${api} key_len=${key.length}`);

  const probes: Array<[string, Record<string, unknown>]> = [
    ['SC_DIARY_173292025', { diaryNumber: '173292025', options: { courtType: 'sc', profile: 'caseCreate', includeTimeline: true } }],
    ['HC_RJHC010324382023', { cnr: 'RJHC010324382023', options: { courtType: 'hc', profile: 'caseCreate', includeTimeline: true } }],
    ['HC_GJHC240256342024', { cnr: 'GJHC240256342024', options: { courtType: 'hc', profile: 'default', includeTimeline: true } }],
    ['DC_TSWL000000742024', { cnr: 'TSWL000000742024', options: { courtType: 'dc', profile: 'default', includeTimeline: true } }],
  ];

  for (const [label, body] of probes) {
    try {
      const { status, payload } = await resolveCnr(api, key, body);
      if (status !== 200) {
        console.log(`=== ${label} ===`);
        console.log(`http_status=${status} success=${payload.success}`);
        continue;
      }
      report(label, payload);
    } catch (err) {
      console.log(`=== ${label} ===`);
      console.log(`ERROR=${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('=== PROBE COMPLETE ===');
}

main().catch((e) => {
  console.error('PROBE_FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
