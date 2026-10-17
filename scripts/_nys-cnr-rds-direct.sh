#!/usr/bin/env bash
cd /opt/nyv/api
node --env-file=/opt/nyv/api/.env <<'NODE'
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";

function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}

const url = process.env.DATABASE_URL;
if (!url) { console.log("NO DATABASE_URL"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, ssl: ssl(), max: 1 });
const cnrs = ["TSWL000000742024", "RJHC010324382023"];
for (const cnr of cnrs) {
  const t0 = Date.now();
  const res = await pool.query(
    `SELECT id, cnr, court_type, title FROM judgments WHERE cnr = $1 LIMIT 3`,
    [cnr],
  );
  console.log(cnr, "rows", res.rowCount, "ms", Date.now() - t0, res.rows[0]?.court_type ?? "-");
}
await pool.end();
NODE
