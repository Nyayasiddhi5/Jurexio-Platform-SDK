#!/usr/bin/env python3
"""
NV-CASE-API-P1-001 — hydrate cases_search_staging from DuckDB case_lookup_full.
Reverse-year loop (2026 → 2025). Non-destructive: fills empty columns only.
Run on caselaw-worker with case_api venv python.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any

REGION = "ap-south-1"
DB_ID = "nyv-caselaw-pg"
DB_NAME = "case_api_search"

LOOKUP = os.environ.get(
    "CASE_API_LOOKUP_DIR",
    "/home/ubuntu/scripts/case_api/_build/case_lookup_full/current",
)
BATCH = int(os.environ.get("P1_ETL_BATCH_SIZE", "500"))
TIMEOUT_MS = int(os.environ.get("RDS_STATEMENT_TIMEOUT_MS", "600000"))
END_YEAR = int(os.environ.get("CORPUS_END_YEAR", "2026"))
START_YEAR = int(os.environ.get("CORPUS_START_YEAR", "2025"))

DIARY_RE = re.compile(r"^\d+/\d{4}$")

PII_ALIASES: dict[str, list[str]] = {
    "petitioner_address": ["petitioner_address", "pet_address", "petitionerAddress", "petAddress"],
    "respondent_address": ["respondent_address", "res_address", "respondentAddress", "resAddress"],
    "petitioner_phone": ["petitioner_phone", "pet_phone", "petitionerPhone", "petPhone"],
    "respondent_phone": ["respondent_phone", "res_phone", "respondentPhone", "resPhone"],
    "petitioner_email": ["petitioner_email", "pet_email", "petitionerEmail", "petEmail"],
    "respondent_email": ["respondent_email", "res_email", "respondentEmail", "resEmail"],
    "petitioner_father_name": [
        "petitioner_father_name",
        "pet_father_name",
        "petitionerFatherName",
        "petFatherName",
        "father_name",
    ],
    "respondent_father_name": [
        "respondent_father_name",
        "res_father_name",
        "respondentFatherName",
        "resFatherName",
    ],
}


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


def pick(extra: dict[str, Any], row: dict[str, Any], aliases: list[str]) -> str | None:
    for key in aliases:
        v = str_val(row.get(key)) or str_val(extra.get(key))
        if v:
            return v
    return None


def party_pii_from_structured(extra: dict[str, Any], side: str) -> dict[str, str | None]:
    out: dict[str, str | None] = {
        "address": None,
        "phone": None,
        "email": None,
        "father_name": None,
    }
    parties = extra.get("parties") or extra.get("party_details") or extra.get("partyDetails")
    if not isinstance(parties, list):
        return out
    side_re = re.compile(r"petitioner|applicant|appellant|complainant|plaintiff", re.I)
    res_re = re.compile(r"respondent|defendant|accused", re.I)
    for p in parties:
        if not isinstance(p, dict):
            continue
        role = str_val(p.get("role") or p.get("side") or p.get("party_type"))
        if side == "petitioner" and role and not side_re.search(role):
            continue
        if side == "respondent" and role and not res_re.search(role):
            continue
        out["address"] = out["address"] or str_val(p.get("address") or p.get("addr"))
        out["phone"] = out["phone"] or str_val(p.get("phone") or p.get("mobile"))
        out["email"] = out["email"] or str_val(p.get("email"))
        out["father_name"] = out["father_name"] or str_val(
            p.get("father_name") or p.get("fatherName")
        )
    return out


def extract_diary(row: dict[str, Any], extra: dict[str, Any]) -> str | None:
    d = str_val(row.get("diary_no")) or str_val(extra.get("diary_no"))
    if d:
        return d
    cn = str_val(row.get("case_number"))
    if cn and DIARY_RE.match(cn):
        return cn
    return None


def extract_acts(row: dict[str, Any], extra: dict[str, Any]) -> str | None:
    aj = row.get("acts_json")
    if aj is not None:
        s = json.dumps(aj) if not isinstance(aj, str) else aj
        if s.strip() not in ("", "[]", "null", "{}"):
            return s
    for key in ("acts_json", "acts_sections", "acts", "sections"):
        v = extra.get(key)
        if v is None:
            continue
        s = json.dumps(v) if not isinstance(v, str) else v
        if s.strip() not in ("", "[]", "null", "{}"):
            return s
    return None


def build_update(row: dict[str, Any]) -> dict[str, Any] | None:
    cnr = str_val(row.get("cnr"))
    court = str_val(row.get("court_level"))
    if not cnr or not court:
        return None
    extra = parse_extra(row.get("extra"))
    pet = party_pii_from_structured(extra, "petitioner")
    res = party_pii_from_structured(extra, "respondent")
    payload = {
        "cnr": cnr,
        "court_level": court,
        "diary_no": extract_diary(row, extra),
        "petitioner_address": pick(extra, row, PII_ALIASES["petitioner_address"]) or pet["address"],
        "respondent_address": pick(extra, row, PII_ALIASES["respondent_address"]) or res["address"],
        "petitioner_phone": pick(extra, row, PII_ALIASES["petitioner_phone"]) or pet["phone"],
        "respondent_phone": pick(extra, row, PII_ALIASES["respondent_phone"]) or res["phone"],
        "petitioner_email": pick(extra, row, PII_ALIASES["petitioner_email"]) or pet["email"],
        "respondent_email": pick(extra, row, PII_ALIASES["respondent_email"]) or res["email"],
        "petitioner_father_name": pick(extra, row, PII_ALIASES["petitioner_father_name"])
        or pet["father_name"],
        "respondent_father_name": pick(extra, row, PII_ALIASES["respondent_father_name"])
        or res["father_name"],
        "acts_json": extract_acts(row, extra),
    }
    if not any(
        payload[k]
        for k in (
            "diary_no",
            "petitioner_address",
            "respondent_address",
            "petitioner_phone",
            "respondent_phone",
            "petitioner_email",
            "respondent_email",
            "petitioner_father_name",
            "respondent_father_name",
            "acts_json",
        )
    ):
        return None
    return payload


NODE_API = os.environ.get("NYS_API_DIR", "/opt/nyv/api")
NODE_ENV_FILE = os.environ.get("NYS_API_ENV", f"{NODE_API}/.env")

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
      THEN $12::text ELSE acts_json END
  WHERE cnr = $1::text AND court_level = $2::text
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
if (mode === "ddl") {
  await p.query(payload);
  console.log(JSON.stringify({ ok: true, mode: "ddl" }));
} else if (mode === "batch") {
  const rows = JSON.parse(payload);
  let updated = 0;
  let acts = 0;
  for (const r of rows) {
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
  }
  console.log(JSON.stringify({ updated, acts }));
} else {
  console.log(JSON.stringify({ err: "unknown mode" }));
  process.exitCode = 2;
}
await p.end();
"""


def node_rds(mode: str, payload: str = "") -> dict[str, Any]:
    import subprocess

    work = os.environ.get("P1_ETL_WORK", "/tmp/nv-p1-etl")
    os.makedirs(work, exist_ok=True)
    # Helper must live under NODE_API so ESM resolves pg + @aws-sdk/* from node_modules.
    helper_path = os.path.join(NODE_API, ".p1_rds_helper.mjs")
    with open(helper_path, "w", encoding="utf-8") as f:
        f.write(NODE_RDS_HELPER.strip())

    payload_path = os.path.join(work, f"payload-{mode}.json")
    with open(payload_path, "w", encoding="utf-8") as f:
        f.write(payload)

    env = os.environ.copy()
    env["P1_RDS_MODE"] = mode
    env["P1_RDS_PAYLOAD_FILE"] = payload_path
    env.pop("P1_RDS_PAYLOAD", None)
    env["RDS_STATEMENT_TIMEOUT_MS"] = str(TIMEOUT_MS)
    cmd = [
        "node",
        f"--env-file={NODE_ENV_FILE}",
        helper_path,
    ]
    proc = subprocess.run(
        cmd,
        cwd=NODE_API,
        capture_output=True,
        text=True,
        timeout=max(120, TIMEOUT_MS // 1000 + 30),
        env=env,
    )
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
    if line:
        try:
            result = json.loads(line)
            if proc.returncode != 0 and not result.get("ok") and "updated" not in result:
                log(f"NODE_RDS_WARN mode={mode} rc={proc.returncode} err={proc.stderr[:200]}")
            return result
        except json.JSONDecodeError:
            pass
    if proc.returncode != 0:
        log(f"NODE_RDS_ERR mode={mode} rc={proc.returncode} err={proc.stderr[:300]} out={proc.stdout[:200]}")
        raise RuntimeError(f"node rds helper failed: {proc.stderr[:200]}")
    return {}


def run_ddl() -> None:
    ddl_path = os.environ.get("P1_DDL_PATH")
    if not ddl_path or not os.path.isfile(ddl_path):
        log("DDL_SKIP no P1_DDL_PATH")
        return
    with open(ddl_path, encoding="utf-8") as f:
        sql = f.read()
    node_rds("ddl", sql)
    log("DDL_OK")


def run_view_ddl() -> None:
    view_path = os.environ.get("P1_VIEW_DDL_PATH")
    if not view_path or not os.path.isfile(view_path):
        log("VIEW_DDL_SKIP")
        return
    with open(view_path, encoding="utf-8") as f:
        view_sql = f.read()
    try:
        node_rds("ddl", view_sql)
        log("VIEW_DDL_OK")
    except RuntimeError as e:
        # Non-fatal — staging columns are SSoT; cases view refresh can lag
        log(f"VIEW_DDL_WARN {e}")


def flush_batch(batch: list[dict[str, Any]]) -> tuple[int, int]:
    if not batch:
        return 0, 0
    result = node_rds("batch", json.dumps(batch))
    return int(result.get("updated", 0)), int(result.get("acts", 0))


def process_year(year: int) -> dict[str, int]:
    import duckdb

    stats = {"scanned": 0, "candidates": 0, "updated": 0, "acts": 0}
    glob_pat = LOOKUP.rstrip("/") + "/**/*.parquet"
    log(f"YEAR_{year}_START lookup={LOOKUP}")
    con = duckdb.connect(":memory:")
    t0 = time.time()
    con.execute(
        f"""
        CREATE TABLE yr AS
        SELECT * FROM read_parquet('{glob_pat}', union_by_name=true)
        WHERE extract(year FROM try_cast(coalesce(decision_date, filing_date) AS DATE)) = {year}
        """
    )
    n = con.execute("SELECT count(*) FROM yr").fetchone()[0]
    stats["scanned"] = int(n)
    log(f"YEAR_{year}_DUCKDB_ROWS {n} ms={int((time.time()-t0)*1000)}")

    batch: list[dict[str, Any]] = []
    offset = 0
    while offset < n:
        rows = con.execute(f"SELECT * FROM yr LIMIT {BATCH} OFFSET {offset}").fetchdf().to_dict("records")
        if not rows:
            break
        for raw in rows:
            payload = build_update(raw)
            if payload:
                stats["candidates"] += 1
                batch.append(payload)
                if len(batch) >= BATCH:
                    u, a = flush_batch(batch)
                    stats["updated"] += u
                    stats["acts"] += a
                    batch = []
        offset += BATCH
        if offset % (BATCH * 20) == 0:
            log(f"YEAR_{year}_PROGRESS offset={offset}/{n} updated={stats['updated']}")

    if batch:
        u, a = flush_batch(batch)
        stats["updated"] += u
        stats["acts"] += a

    con.close()
    log(f"YEAR_{year}_DONE {json.dumps(stats)}")
    return stats


def main() -> int:
    log(f"=== NV-CASE-API-P1-ETL start years={END_YEAR}..{START_YEAR} batch={BATCH} ===")
    try:
        import duckdb  # noqa: F401
    except ImportError as e:
        log(f"IMPORT_ERR {e}")
        return 2

    run_ddl()
    run_view_ddl()

    totals = {"scanned": 0, "candidates": 0, "updated": 0, "acts": 0}
    for year in range(END_YEAR, START_YEAR - 1, -1):
        s = process_year(year)
        for k in totals:
            totals[k] += s[k]

    log(f"=== NV-CASE-API-P1-ETL complete totals={json.dumps(totals)} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
