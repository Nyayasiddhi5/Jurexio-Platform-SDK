#!/usr/bin/env bash
# Probe 4: DECISIVE per-court citation null-rate + metadata inventory against
# the CASELAW RDS (nyv-caselaw-pg), whose creds come from the RDS managed
# master secret — NOT from DATABASE_URL (that is the separate app DB, which is
# where archive_extracts lives).
set -uo pipefail
echo "PC1_ECHO=5150"
cd /opt/nyv/api || { echo "NO_APP_DIR"; exit 1; }
echo "PC2_HAS_SDK_RDS=$([ -d node_modules/@aws-sdk/client-rds ] && echo yes || echo no)"
echo "PC3_HAS_SDK_SM=$([ -d node_modules/@aws-sdk/client-secrets-manager ] && echo yes || echo no)"
echo "PC4_HAS_PG=$([ -d node_modules/pg ] && echo yes || echo no)"
PID=$(systemctl show -p MainPID --value nyv-api.service)
CA=$(tr '\0' '\n' < "/proc/$PID/environ" | grep -m1 '^RDS_CA_BUNDLE=' | cut -d= -f2-)
echo "PC5_CA_BUNDLE_SET=$([ -n "$CA" ] && echo yes || echo no)"
export RDS_CA_BUNDLE="$CA"

cat > /opt/nyv/api/_probe_caselaw.cjs <<'EOF'
const { readFileSync } = require('node:fs');
const { Pool } = require('pg');
const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const log = (s) => process.stdout.write(s + '\n');
const REGION = 'ap-south-1';
const DB_INSTANCE_ID = 'nyv-caselaw-pg';

(async () => {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID }));
  const inst = desc.DBInstances[0];
  log('PC_RDS_STATUS=' + inst.DBInstanceStatus + ' db=' + inst.DBName);
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
  const creds = JSON.parse(secret.SecretString);
  const caPath = process.env.RDS_CA_BUNDLE;
  const pool = new Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port,
    database: inst.DBName || 'nyv_caselaw',
    user: creds.username, password: creds.password,
    ssl: caPath ? { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') } : { rejectUnauthorized: false },
    max: 4, connectionTimeoutMillis: 20000, statement_timeout: 1800000,
  });
  log('PC_DB_CONTROL=' + (await pool.query('SELECT 5150 AS c')).rows[0].c);

  const timed = async (label, sql) => {
    const t0 = Date.now();
    try {
      const r = await pool.query(sql);
      log(`### ${label} elapsed_ms=${Date.now() - t0} rows=${r.rowCount}`);
      log(JSON.stringify(r.rows, null, 2));
    } catch (e) { log(`### ${label} FAILED: ${e.message}`); }
  };

  await timed('Q1_CITATION_BY_COURT', `
    SELECT court_type, count(*) AS total, count(citation) AS with_citation
    FROM judgments GROUP BY court_type ORDER BY court_type`);

  await timed('Q2_FIELD_POPULATION', `
    SELECT court_type,
           count(*) AS total, count(citation) AS citation, count(cnr) AS cnr,
           count(pdf_link) AS pdf_link, count(petitioner) AS petitioner,
           count(respondent) AS respondent, count(judges) AS judges,
           count(author_judge) AS author_judge,
           count(decision_date) AS decision_date, count(full_text) AS full_text,
           count(description) AS description, count(court_code) AS court_code,
           count(bench) AS bench, count(case_no) AS case_no
    FROM judgments GROUP BY court_type ORDER BY court_type`);

  await timed('Q3_PDFLINK_SHAPES', `
    SELECT court_type,
           CASE WHEN pdf_link IS NULL THEN 'null'
                WHEN pdf_link LIKE 's3://%' THEN 's3'
                WHEN pdf_link LIKE 'http%' THEN 'http'
                ELSE 'relative' END AS shape,
           count(*) AS n, min(pdf_link) AS example
    FROM judgments GROUP BY 1,2 ORDER BY 1,2`);

  await timed('Q4_CACHE_TABLES', `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('pdf_text_cache','archive_extracts','judgments')
    ORDER BY table_name`);
  await timed('Q5_PDF_TEXT_CACHE', `SELECT count(*) AS n FROM pdf_text_cache`);

  await timed('Q6_SC_KESAVANANDA', `
    SELECT id, year, title, citation, pdf_link FROM judgments
    WHERE court_type='sc' AND title ILIKE '%KESAVANANDA%' LIMIT 5`);
  await timed('Q7_SC_MANEKA', `
    SELECT id, year, title, citation, pdf_link FROM judgments
    WHERE court_type='sc' AND title ILIKE '%MANEKA GANDHI%' LIMIT 5`);
  await timed('Q8_SC_ANY_PDF', `
    SELECT id, year, title, citation, pdf_link FROM judgments
    WHERE court_type='sc' AND pdf_link IS NOT NULL LIMIT 3`);
  await timed('Q9_HC_ANY_PDF', `
    SELECT id, year, court_code, bench, title, pdf_link FROM judgments
    WHERE court_type='hc' AND pdf_link IS NOT NULL
      AND court_code IS NOT NULL AND bench IS NOT NULL LIMIT 3`);
  await timed('Q10_DC_ANY_PDF', `
    SELECT id, year, court_code, bench, title, pdf_link FROM judgments
    WHERE court_type='dc' AND pdf_link IS NOT NULL LIMIT 3`);

  log('PROBE_DONE=5150');
  await pool.end();
})().catch(e => { log('PROBE_ERROR=' + e.message); process.exit(1); });
EOF

nohup node /opt/nyv/api/_probe_caselaw.cjs > /tmp/nys_caselaw_inv.log 2>&1 &
echo "LAUNCHED=yes"
sleep 40
echo "--- output after 40s ---"
cat /tmp/nys_caselaw_inv.log
