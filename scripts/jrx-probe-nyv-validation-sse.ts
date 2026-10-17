/**
 * NV-NSP-PROBE-NYV-VALIDATION-001 — live NYV orchestrate/stream filing envelope probe.
 *
 * Set NSP_PROBE_REQUIRE_NYV_VALIDATION=1 to fail when validationResults[] is absent.
 * Keys from ../.local/secrets/runtime.env or NYV_SDK_KEY_NSP in env. NV-SECRETS-001.
 *
 * Run: npm run probe:nyv
 *      NSP_PROBE_REQUIRE_NYV_VALIDATION=1 npm run probe:nyv
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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

function requireValidation(): boolean {
  const v = String(process.env.NSP_PROBE_REQUIRE_NYV_VALIDATION ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

interface StreamProbeResult {
  label: string;
  http: number;
  ms: number;
  runCompleted: boolean;
  resultValidationLen: number;
  eventValidationLen: number;
  hasDraftProfile: boolean;
  validationIds: string[];
}

async function probeStream(
  api: string,
  key: string,
  label: string,
  body: Record<string, unknown>,
): Promise<StreamProbeResult> {
  const t0 = Date.now();
  const res = await fetch(`${api}/api/jrx/orchestrate/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
      'X-NYV-Platform': 'nsp',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let runCompleted = false;
  let resultValidationLen = 0;
  let eventValidationLen = 0;
  let hasDraftProfile = false;
  let validationIds: string[] = [];

  for (const block of text.split('\n\n')) {
    if (!block.includes('run_completed')) continue;
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const evt = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (evt.type !== 'run_completed') continue;
        runCompleted = true;
        const result = (evt.result ?? {}) as Record<string, unknown>;
        const resVr = result.validationResults;
        const evtVr = evt.validationResults;
        if (Array.isArray(resVr)) {
          resultValidationLen = resVr.length;
          validationIds = resVr.slice(0, 5).map((v) => String((v as { id?: string }).id ?? ''));
        }
        if (Array.isArray(evtVr)) {
          eventValidationLen = evtVr.length;
        }
        hasDraftProfile = !!(result.draftProfile ?? evt.draftProfile);
      } catch {
        /* skip malformed block */
      }
    }
  }

  return {
    label,
    http: res.status,
    ms: Date.now() - t0,
    runCompleted,
    resultValidationLen,
    eventValidationLen,
    hasDraftProfile,
    validationIds,
  };
}

async function main(): Promise<void> {
  loadRuntimeEnv();
  const api = (process.env.NYV_API_BASE_URL ?? 'https://api.nyayasiddhi.online').replace(/\/$/, '');
  const key = (process.env.NYV_SDK_KEY_NSP ?? '').trim();
  if (key.length < 16) {
    console.error('PROBE_SKIP: NYV_SDK_KEY_NSP missing (pull runtime.env or run demo:probe:ec2 pattern)');
    process.exit(2);
  }
  const stamp = createHash('sha256').update(randomBytes(8)).digest('hex').slice(0, 8);
  console.log(`API=${api} key_len=${key.length} require_validation=${requireValidation()}`);

  const cases: Array<[string, Record<string, unknown>]> = [
    [
      'filing_book_caveat_stream',
      {
        prompt: `Draft caveat skeleton ref ${stamp}`,
        taskType: 'doc-draft-fast',
        jurisdiction: 'IN',
        parameters: {
          documentType: 'civil_caveat',
          filingContext: {
            nvTemplateKey: 'civil_caveat',
            filingBookRowId: `probe-${stamp}`,
            advisoryOnly: true,
          },
        },
        options: { draftLength: 'low' },
        maxTokens: 512,
      },
    ],
    [
      'prompt_only_legal_draft_fast',
      {
        prompt: `Draft legal notice for cheque dishonour ref ${stamp}`,
        taskType: 'legal-draft-fast',
        jurisdiction: 'IN',
        options: { draftLength: 'low' },
        maxTokens: 512,
      },
    ],
  ];

  let failed = 0;
  for (const [label, body] of cases) {
    try {
      const r = await probeStream(api, key, label, body);
      const validationOk = r.resultValidationLen > 0;
      const mirrorOk = r.eventValidationLen === 0 || r.eventValidationLen === r.resultValidationLen;
      const pass = r.http === 200 && r.runCompleted && validationOk && r.hasDraftProfile && mirrorOk;
      console.log(
        `PROBE ${label} http=${r.http} ms=${r.ms} run_completed=${r.runCompleted} `
        + `result.validationResults_len=${r.resultValidationLen} `
        + `event.validationResults_len=${r.eventValidationLen} draftProfile=${r.hasDraftProfile} `
        + `ids_sample=${JSON.stringify(r.validationIds)} pass=${pass}`,
      );
      if (!pass) failed++;
    } catch (err) {
      failed++;
      console.log(
        `PROBE ${label} ERROR=${err instanceof Error ? err.message : String(err)} pass=false`,
      );
    }
  }

  if (failed > 0 && requireValidation()) {
    console.error(`NV-NSP-PROBE-NYV-VALIDATION-001 FAIL — ${failed} case(s)`);
    process.exit(1);
  }
  if (failed > 0) {
    console.warn(`NV-NSP-PROBE-NYV-VALIDATION-001 WARN — ${failed} case(s) (require flag off)`);
    process.exit(0);
  }
  console.log('NV-NSP-PROBE-NYV-VALIDATION-001 PASS — stream run_completed carries validationResults + draftProfile');
}

main().catch((e) => {
  console.error('PROBE_FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
