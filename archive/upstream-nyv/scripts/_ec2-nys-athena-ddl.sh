#!/usr/bin/env bash
# Probe 7: Athena table DDL/partitioning (is `year` a partition key or a plain
# column?) — decides whether the HC 1.3-1.5 GB scans are prunable or a real
# per-query cost floor. Also polls the pending citation inventory.
set -uo pipefail
echo "PC1_ECHO=5150"
echo "=== pending citation inventory ==="
echo "PROBE_RUNNING=$(pgrep -f _probe_caselaw.cjs >/dev/null && echo yes || echo no)"
cat /tmp/nys_caselaw_inv.log 2>/dev/null | grep -v NodeVersionSupport | grep -v "^$" || echo NO_LOG
echo "=== Athena DDL ==="
cd /opt/nyv/api
cat > /opt/nyv/api/_probe_ath.cjs <<'EOF'
const { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } = require('@aws-sdk/client-athena');
const log = (s) => process.stdout.write(s + '\n');
const c = new AthenaClient({ region: 'ap-south-1' });
const DB = 'nyv_docs', OUT = 's3://usa-caselaw/athena/results/', WG = 'nyv-docs';
async function run(sql) {
  const s = await c.send(new StartQueryExecutionCommand({
    QueryString: sql, QueryExecutionContext: { Database: DB },
    ResultConfiguration: { OutputLocation: OUT }, WorkGroup: WG }));
  const id = s.QueryExecutionId;
  for (let i = 0; i < 60; i++) {
    const e = await c.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const st = e.QueryExecution.Status.State;
    if (st === 'SUCCEEDED') {
      const r = await c.send(new GetQueryResultsCommand({ QueryExecutionId: id, MaxResults: 60 }));
      return { ok: true, scanned: e.QueryExecution.Statistics.DataScannedInBytes,
        rows: (r.ResultSet.Rows || []).map(x => (x.Data || []).map(d => d.VarCharValue ?? '').join(' | ')) };
    }
    if (st === 'FAILED' || st === 'CANCELLED') return { ok: false, err: e.QueryExecution.Status.StateChangeReason, scanned: e.QueryExecution.Statistics.DataScannedInBytes };
    await new Promise(r => setTimeout(r, 800));
  }
  return { ok: false, err: 'timeout' };
}
(async () => {
  log('PC_ATHENA_CONTROL=' + JSON.stringify((await run('SELECT 5150 AS control')).rows));
  for (const t of ['judgments_meta', 'judgments_meta_hc', 'judgments_meta_us']) {
    log('=== SHOW CREATE TABLE ' + t + ' ===');
    const r = await run(`SHOW CREATE TABLE ${t}`);
    log(r.ok ? r.rows.join('\n') : 'FAILED: ' + r.err);
    log('=== SHOW PARTITIONS ' + t + ' (first 15) ===');
    const p = await run(`SHOW PARTITIONS ${t}`);
    log(p.ok ? (p.rows.slice(0, 15).join('\n') || '(no partitions => table is UNPARTITIONED)') : 'FAILED: ' + p.err);
  }
  log('=== row counts + scan cost per table ===');
  for (const t of ['judgments_meta', 'judgments_meta_hc']) {
    const r = await run(`SELECT count(*) AS n FROM ${t}`);
    log(`${t}: rows=${r.ok ? r.rows[1] : 'ERR ' + r.err} scanned_bytes=${r.scanned}`);
  }
  log('=== does a year predicate prune judgments_meta_hc? ===');
  const a = await run(`SELECT count(*) FROM judgments_meta_hc WHERE year = 2020`);
  log('WHERE year=2020 scanned=' + a.scanned + ' rows=' + (a.ok ? a.rows[1] : a.err));
  const b = await run(`SELECT count(*) FROM judgments_meta_hc WHERE year = 2020 AND court = 'x'`);
  log('WHERE year=2020 AND court scanned=' + b.scanned);
  log('ATHENA_PROBE_DONE=5150');
})().catch(e => log('ATH_ERR=' + e.message));
EOF
node /opt/nyv/api/_probe_ath.cjs 2>&1 | grep -v NodeVersionSupport
rm -f /opt/nyv/api/_probe_ath.cjs
echo "PROBE7_DONE=5150"
