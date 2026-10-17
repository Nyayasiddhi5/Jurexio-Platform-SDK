#!/usr/bin/env python3
import subprocess
script = r"""
cd /opt/nyv/api
node --env-file=/opt/nyv/api/.env -e "
const { performance } = require('perf_hooks');
(async () => {
  const { getRdsPool } = await import('./lib/rdsPool.js');
  const pool = await getRdsPool();
  for (const cnr of ['RJHC010324382023','TSWL000000742024','TSWL010000012024']) {
    const t0 = performance.now();
    try {
      const j = await pool.query('SELECT id, court_type, left(title,50) t FROM judgments WHERE cnr=\$1 LIMIT 1', [cnr]);
      const t1 = performance.now();
      const d = await pool.query('SELECT cnr FROM cnr_case_details WHERE cnr=\$1 LIMIT 1', [cnr]);
      const t2 = performance.now();
      console.log('RDS', cnr, 'j_ms=' + Math.round(t1-t0), 'd_ms=' + Math.round(t2-t1), 'j_rows=' + j.rowCount, 'd_rows=' + d.rowCount, j.rows[0] || '');
    } catch (e) {
      console.log('RDS', cnr, 'ERR', e.message, 'ms=' + Math.round(performance.now()-t0));
    }
  }
  const idx = await pool.query(\"SELECT indexname FROM pg_indexes WHERE tablename='judgments' AND indexdef ILIKE '%cnr%'\");
  console.log('CNR_INDEXES', idx.rows.map(r=>r.indexname).join(','));
  await pool.end();
})().catch(e => console.log('FATAL', e.message));
"
echo "=== GLUE nyv_docs ==="
aws glue get-table --database-name nyv_docs --name judgments_meta_hc_case_details --region ap-south-1 --query 'Table.{Name:Name,Rows:Parameters.numRows}' --output json 2>&1
"""
print(subprocess.check_output(script, shell=True, stderr=subprocess.STDOUT, text=True, timeout=120))
