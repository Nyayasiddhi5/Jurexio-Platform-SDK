/**
 * Live nysapi probe through jrx-case-api-adapter (NV-SECRETS-001: no key values).
 */
import {
  fetchCaseByCnr,
  mapCaseApiToCnrResolveData,
  mapCaseApiNotFound,
} from '../src/services/jrx-case-api-adapter.js';

async function main(): Promise<void> {
  const cnrs = [
    'TSWL000000742024',
    'RJHC010324382023',
    'GJHC240256342024',
    'ZZZZ000000000000',
  ];
  for (const cnr of cnrs) {
    const r = await fetchCaseByCnr(cnr);
    if (r.ok) {
      const d = mapCaseApiToCnrResolveData({
        cnr,
        caseRow: r.case,
        latencyMs: r.latencyMs,
        wantCaseCreate: cnr === 'RJHC010324382023',
      });
      const tl = d.caseCreate?.timeline?.length ?? 0;
      const h = Array.isArray(d.fields?.hearings?.value)
        ? (d.fields.hearings.value as unknown[]).length
        : 0;
      console.log(
        `LIVE ${cnr} status=${d.status} source=${d.source} hearings=${h} timeline=${tl} ms=${r.latencyMs}`,
      );
    } else {
      const d = r.status === 404 ? mapCaseApiNotFound(cnr, r.latencyMs) : null;
      console.log(
        `LIVE ${cnr} http=${r.status} status=${d?.status ?? r.error} ms=${r.latencyMs}`,
      );
    }
  }
}

main().catch((e) => {
  console.error('PROBE_FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
