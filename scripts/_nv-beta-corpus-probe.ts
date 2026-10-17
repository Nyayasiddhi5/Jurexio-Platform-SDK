#!/usr/bin/env npx tsx
/** NV-CASE-CORPUS-BETA-CLOSURE-001 — read-only resolve meta probe (no secret values). */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const envPath of [
  resolve(process.cwd(), '../.local/secrets/runtime.env'),
  resolve(process.cwd(), '.local/secrets/runtime.env'),
]) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  break;
}

const base = process.env.JRX_API_BASE_URL || 'https://api.jurexio.com';
const key = process.env.JRX_SDK_KEY_NSP || '';
const samples = ['TSWL000000742024', 'RJHC010324382023'] as const;

for (const cnr of samples) {
  const res = await fetch(`${base}/api/jrx/v1/sdk/cnr/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
      'X-JRX-Platform': 'NSP',
    },
    body: JSON.stringify({ cnr, options: { profile: 'caseCreate' } }),
  });
  const j = (await res.json()) as {
    data?: {
      meta?: {
        fieldAvailability?: Record<string, string>;
        betaReadiness?: { tier3RequiredFields?: string[]; edjJobPath?: string };
      };
      fields?: { actsSections?: { value?: unknown[] }; nextHearingDate?: { note?: string } };
      caseCreate?: { fieldManifest?: { manualRequired?: string[]; corpusUnavailable?: string[] } };
    };
  };
  const d = j.data ?? {};
  const fa = d.meta?.fieldAvailability ?? {};
  const actsLen = Array.isArray(d.fields?.actsSections?.value)
    ? d.fields!.actsSections!.value!.length
    : 0;
  console.log(`=== ${cnr} ===`);
  console.log(`http=${res.status} acts_len=${actsLen}`);
  console.log(
    `tier3=${fa.nextHearingDate ?? fa.next_hearing_date ?? 'missing'} witnesses=${fa.witnesses ?? 'missing'} pii=${fa.clientPhone ?? fa.party_pii ?? 'missing'}`,
  );
  console.log(`betaReadiness=${JSON.stringify(d.meta?.betaReadiness ?? null)}`);
  console.log(
    `next_note=${d.fields?.nextHearingDate?.note?.slice(0, 80) ?? 'none'}…`,
  );
  console.log(
    `manifest manualRequired=${JSON.stringify(d.caseCreate?.fieldManifest?.manualRequired?.slice(0, 6) ?? [])}`,
  );
}
console.log('=== BETA PROBE COMPLETE ===');
