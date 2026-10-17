#!/usr/bin/env python3
"""
NV-SIDDHANTA-CNR-MERGE-001 — fill-empty merge from nyv_caselaw.cnr_case_details → cases_search_staging.
Run on caselaw-worker; non-destructive; statement_timeout via RDS_STATEMENT_TIMEOUT_MS (default 600s).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from typing import Any

DIARY_RE = re.compile(r"^\d+/\d{4}$")

PII_ALIASES: dict[str, list[str]] = {
    "petitioner_address": ["petitioner_address", "pet_address", "petitionerAddress"],
    "respondent_address": ["respondent_address", "res_address", "respondentAddress"],
    "petitioner_phone": ["petitioner_phone", "pet_phone", "petitionerPhone", "mobile"],
    "respondent_phone": ["respondent_phone", "res_phone", "respondentPhone"],
    "petitioner_email": ["petitioner_email", "pet_email", "petitionerEmail"],
    "respondent_email": ["respondent_email", "res_email", "respondentEmail"],
    "petitioner_father_name": ["petitioner_father_name", "pet_father_name", "father_name"],
    "respondent_father_name": ["respondent_father_name", "res_father_name"],
}

NODE_API = os.environ.get("NYS_API_DIR", "/opt/nyv/api")
NODE_ENV_FILE = os.environ.get("NYS_API_ENV", f"{NODE_API}/.env")
BATCH = int(os.environ.get("CNR_MERGE_BATCH_SIZE", "500"))
TIMEOUT_MS = int(os.environ.get("RDS_STATEMENT_TIMEOUT_MS", "600000"))
WORK = os.environ.get("CNR_MERGE_WORK", "/tmp/nv-siddhanta-cnr-merge")

NODE_RDS_HELPER = r"""
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const DB_NAME = "case_api_search";
const TIMEOUT_MS = parseInt(process.env.RDS_STATEMENT_TIMEOUT_MS ?? "600000", 10);

function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}

async function pool() {
  const rds = new RDSClient({ region: REGION });
  const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
  const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: DB_NAME, user: creds.username, password: creds.password,
    ssl: ssl(), max: 2, statement_timeout: TIMEOUT_MS,
  });
}

const mode = process.env.P1_RDS_MODE ?? "";
const payload = process.env.P1_RDS_PAYLOAD_FILE
  ? readFileSync(process.env.P1_RDS_PAYLOAD_FILE, "utf8")
  : (process.env.P1_RDS_PAYLOAD ?? "");

const UPDATE_SQL = `
  UPDATE cases_search_staging SET
    diary_no = COALESCE(NULLIF(btrim(diary_no), ''), $3::text),
    petitioner_address = COALESCE(NULLIF(btrim(petitioner_address), ''), $4::text),
    respondent_address = COALESCE(NULLIF(btrim(respondent_address), ''), $5::text),
    petitioner_phone = COALESCE(NULLIF(btrim(petitioner_phone), ''), $6::text),
    respondent_phone = COALESCE(NULLIF(btrim(respondent_phone), ''), $7::text),
    petitioner_email = COALESCE(NULLIF(btrim(petitioner_email), ''), $8::text),
    respondent_email = COALESCE(NULLIF(btrim(respondent_email), ''), $9::text),
    petitioner_father_name = COALESCE(NULLIF(btrim(petitioner_father_name), ''), $10::text),
    respondent_father_name = COALESCE(NULLIF(btrim(respondent_father_name), ''), $11::text),
    acts_json = CASE
      WHEN $12::text IS NOT NULL AND btrim($12::text) NOT IN ('', '[]', 'null', '{}')
           AND (acts_json IS NULL OR btrim(acts_json::text) IN ('', '[]', 'null', '{}'))
      THEN $12::jsonb ELSE acts_json END
  WHERE upper(cnr) = upper($1::text)
    AND lower(btrim(court_level::text)) IN ('hc', 'high court', 'high_court')
    AND (
      ($3::text IS NOT NULL AND btrim($3::text) <> '' AND (diary_no IS NULL OR btrim(diary_no) = ''))
      OR ($4::text IS NOT NULL AND btrim($4::text) <> '' AND (petitioner_address IS NULL OR btrim(petitioner_address) = ''))
      OR ($5::text IS NOT NULL AND btrim($5::text) <> '' AND (respondent_address IS NULL OR btrim(respondent_address) = ''))
      OR ($6::text IS NOT NULL AND btrim($6::text) <> '' AND (petitioner_phone IS NULL OR btrim(petitioner_phone) = ''))
      OR ($7::text IS NOT NULL AND btrim($7::text) <> '' AND (respondent_phone IS NULL OR btrim(respondent_phone) = ''))
      OR ($8::text IS NOT NULL AND btrim($8::text) <> '' AND (petitioner_email IS NULL OR btrim(petitioner_email) = ''))
      OR ($9::text IS NOT NULL AND btrim($9::text) <> '' AND (respondent_email IS NULL OR btrim(respondent_email) = ''))
      OR ($10::text IS NOT NULL AND btrim($10::text) <> '' AND (petitioner_father_name IS NULL OR btrim(petitioner_father_name) = ''))
      OR ($11::text IS NOT NULL AND btrim($11::text) <> '' AND (respondent_father_name IS NULL OR btrim(respondent_father_name) = ''))
      OR ($12::text IS NOT NULL AND btrim($12::text) NOT IN ('', '[]', 'null', '{}')
          AND (acts_json IS NULL OR btrim(acts_json::text) IN ('', '[]', 'null', '{}')))
    )
`;

const p = await pool();
if (mode === "batch") {
  const rows = JSON.parse(payload);
  let updated = 0;
  let acts = 0;
  let errors = 0;
  let firstErr = "";
  for (const r of rows) {
    try {
      const res = await p.query(UPDATE_SQL, [
        r.cnr, r.court_level,
        r.diary_no ?? null, r.petitioner_address ?? null, r.respondent_address ?? null,
        r.petitioner_phone ?? null, r.respondent_phone ?? null,
        r.petitioner_email ?? null, r.respondent_email ?? null,
        r.petitioner_father_name ?? null, r.respondent_father_name ?? null,
        r.acts_json ?? null,
      ]);
      if (res.rowCount) {
        updated += res.rowCount;
        if (r.acts_json) acts += 1;
      }
    } catch (e) {
      errors += 1;
      if (!firstErr) firstErr = String(e.message || e).slice(0, 200);
    }
  }
  console.log(JSON.stringify({ updated, acts, errors, firstErr }));
} else {
  console.log(JSON.stringify({ err: "unknown mode" }));
  process.exitCode = 2;
}
await p.end();
"""

FETCH_DETAILS = r"""
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const offset = parseInt(process.env.CNR_MERGE_OFFSET ?? "0", 10);
const limit = parseInt(process.env.CNR_MERGE_LIMIT ?? "500", 10);

function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}

async function pool(db) {
  const rds = new RDSClient({ region: REGION });
  const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
  const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: db, user: creds.username, password: creds.password,
    ssl: ssl(), max: 2, statement_timeout: parseInt(process.env.RDS_STATEMENT_TIMEOUT_MS ?? "600000", 10),
  });
}

const p = await pool("nyv_caselaw");
const r = await p.query(
  `SELECT cnr, case_no, acts_sections, raw
   FROM cnr_case_details
   ORDER BY updated_at DESC NULLS LAST, cnr
   OFFSET $1 LIMIT $2`,
  [offset, limit],
);
console.log(JSON.stringify(r.rows));
await p.end();
"""


def log(msg: str) -> None:
    print(msg, flush=True)


def str_val(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() in ("null", "none", "nan"):
        return None
    return s


def parse_extra(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def node_rds(mode: str, payload: str = "") -> dict[str, Any]:
    os.makedirs(WORK, exist_ok=True)
    helper_path = os.path.join(NODE_API, ".cnr_merge_rds_helper.mjs")
    with open(helper_path, "w", encoding="utf-8") as f:
        f.write(NODE_RDS_HELPER.strip())
    payload_path = os.path.join(WORK, f"payload-{mode}.json")
    with open(payload_path, "w", encoding="utf-8") as f:
        f.write(payload)
    env = os.environ.copy()
    env["P1_RDS_MODE"] = mode
    env["P1_RDS_PAYLOAD_FILE"] = payload_path
    env["RDS_STATEMENT_TIMEOUT_MS"] = str(TIMEOUT_MS)
    proc = subprocess.run(
        ["node", f"--env-file={NODE_ENV_FILE}", helper_path],
        cwd=NODE_API,
        capture_output=True,
        text=True,
        timeout=max(120, TIMEOUT_MS // 1000 + 30),
        env=env,
    )
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
    if line:
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            pass
    if proc.returncode != 0:
        log(f"NODE_RDS_ERR mode={mode} rc={proc.returncode} err={proc.stderr[:800]} out={proc.stdout[:400]}")
        raise RuntimeError("node rds helper failed")
    return {}


def flush_batch(batch: list[dict[str, Any]]) -> tuple[int, int]:
    if not batch:
        return 0, 0
    result = node_rds("batch", json.dumps(batch))
    return int(result.get("updated", 0)), int(result.get("acts", 0))


def pick(extra: dict[str, Any], aliases: list[str]) -> str | None:
    for key in aliases:
        v = str_val(extra.get(key))
        if v:
            return v
    return None


def extract_diary(case_no: str | None, raw: dict[str, Any]) -> str | None:
    d = str_val(raw.get("diary_no")) or str_val(raw.get("diary_number"))
    if d:
        return d
    cn = str_val(case_no)
    if cn and DIARY_RE.match(cn):
        return cn
    return None


def extract_acts(acts_sections: Any, raw: dict[str, Any]) -> str | None:
    if acts_sections is not None:
        s = json.dumps(acts_sections) if not isinstance(acts_sections, str) else acts_sections
        if s.strip() not in ("", "[]", "null", "{}"):
            return s
    for key in ("acts_sections", "acts", "sections"):
        v = raw.get(key)
        if v is None:
            continue
        s = json.dumps(v) if not isinstance(v, str) else v
        if s.strip() not in ("", "[]", "null", "{}"):
            return s
    return None


def build_payload(row: dict[str, Any]) -> dict[str, Any] | None:
    cnr = str_val(row.get("cnr"))
    if not cnr:
        return None
    raw = parse_extra(row.get("raw"))
    payload: dict[str, Any] = {
        "cnr": cnr,
        "court_level": "hc",
        "diary_no": extract_diary(str_val(row.get("case_no")), raw),
        "acts_json": extract_acts(row.get("acts_sections"), raw),
    }
    for col, aliases in PII_ALIASES.items():
        payload[col] = pick(raw, aliases)
    if not any(payload.get(k) for k in ("diary_no", "acts_json", *PII_ALIASES.keys())):
        return None
    return payload


def fetch_details_batch(offset: int, limit: int) -> list[dict[str, Any]]:
    os.makedirs(WORK, exist_ok=True)
    # Must live under NYS_API_DIR so `node` resolves pg + @aws-sdk/* from node_modules.
    helper = os.path.join(NODE_API, ".cnr_merge_fetch.mjs")
    with open(helper, "w", encoding="utf-8") as f:
        f.write(FETCH_DETAILS.strip())
    env = os.environ.copy()
    env["CNR_MERGE_OFFSET"] = str(offset)
    env["CNR_MERGE_LIMIT"] = str(limit)
    env["RDS_STATEMENT_TIMEOUT_MS"] = str(TIMEOUT_MS)
    proc = subprocess.run(
        ["node", f"--env-file={NODE_ENV_FILE}", helper],
        cwd=NODE_API,
        capture_output=True,
        text=True,
        timeout=max(120, TIMEOUT_MS // 1000 + 30),
        env=env,
    )
    line = proc.stdout.strip()
    if proc.returncode != 0 or not line:
        log(f"FETCH_ERR rc={proc.returncode} err={proc.stderr[:200]}")
        return []
    return json.loads(line)


def main() -> int:
    max_rows = int(os.environ.get("CNR_MERGE_MAX_ROWS", "0"))
    log(f"=== NV-SIDDHANTA-CNR-MERGE start batch={BATCH} max_rows={max_rows or 'all'} ===")
    stats = {"scanned": 0, "candidates": 0, "updated": 0, "acts": 0}
    offset = 0
    t0 = time.time()
    while True:
        rows = fetch_details_batch(offset, BATCH)
        if not rows:
            break
        batch: list[dict[str, Any]] = []
        for row in rows:
            stats["scanned"] += 1
            payload = build_payload(row)
            if payload:
                stats["candidates"] += 1
                batch.append(payload)
        if batch:
            u, a = flush_batch(batch)
            stats["updated"] += u
            stats["acts"] += a
        offset += len(rows)
        if offset % (BATCH * 10) == 0:
            log(f"MERGE_PROGRESS offset={offset} updated={stats['updated']}")
        if len(rows) < BATCH:
            break
        if max_rows > 0 and offset >= max_rows:
            log(f"MERGE_MAX_ROWS reached {max_rows}")
            break
    log(f"=== NV-SIDDHANTA-CNR-MERGE complete {json.dumps(stats)} ms={int((time.time()-t0)*1000)} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
