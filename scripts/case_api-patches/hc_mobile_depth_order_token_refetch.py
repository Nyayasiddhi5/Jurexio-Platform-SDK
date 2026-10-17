#!/usr/bin/env python3
"""NV-HC-MOBILE-DEPTH-TOKEN-001 — merge ephemeral HC order download tokens into case_api RDS.

Sources (in order):
  1. S3 `judgments/hcservices_depth_backfill/{CNR}.json` (mobile depth backfill)
  2. Live hcservices case_status HTML (opaque display_pdf filenames) — best-effort

Updates `cnr_case_details.raw` mobile_depth / final_orders / interim_orders when --apply.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from typing import Any

DISPLAY_PDF_RE = re.compile(
    r"display_pdf\.php\?[^\"'>\s]*filename=([^\"'&>\s]+)",
    re.I,
)


def _norm_path(raw: str) -> str:
    return str(raw or "").strip().lstrip("/")


def _order_key(rec: dict) -> str:
    return _norm_path(rec.get("filename") or rec.get("file_name") or "")


def _merge_tokens(base: dict, enriched: dict) -> dict:
    """Copy pdf_url / authtoken / download_filename from enriched onto base orders by filename."""
    out = json.loads(json.dumps(base))
    for attr in ("final_orders", "interim_orders", "finalOrder", "interimOrder"):
        arr = out.get(attr)
        if not isinstance(arr, list):
            continue
        src = enriched.get(attr) or enriched.get(attr.replace("Order", "_orders")) or []
        if not isinstance(src, list):
            continue
        by_fn = {_order_key(r): r for r in src if isinstance(r, dict) and _order_key(r)}
        for i, rec in enumerate(arr):
            if not isinstance(rec, dict):
                continue
            fn = _order_key(rec)
            src_rec = by_fn.get(fn)
            if not src_rec:
                continue
            for k in ("pdf_url", "pdfUrl", "authtoken", "auth_token", "download_filename", "opaque_filename"):
                if src_rec.get(k) and not rec.get(k):
                    rec[k] = src_rec[k]
            arr[i] = rec
    md = out.get("mobile_depth")
    if isinstance(md, dict):
        out["mobile_depth"] = _merge_tokens(md, enriched)
    return out


def _load_s3_depth(cnr: str) -> dict | None:
    buckets_keys: list[tuple[str, str]] = []
    for bucket in (
        os.environ.get("NV_HC_DEPTH_BUCKET", "ns-indian-highcourt-judgements-2"),
        "ns-highcourt-data-bucket",
        "siddhanta",
    ):
        buckets_keys.append((bucket, f"judgments/hcservices_depth_backfill/{cnr}.json"))
    # Siddhanta raw HC mobile-depth tree (case_api ingest_hcservices_depth.py)
    buckets_keys.append(("siddhanta", f"IND/00_RAW/high_courts/judgments/hcservices_depth_backfill/{cnr}.json"))
    extra_prefix = os.environ.get("NV_HC_SIDDHANTA_PREFIX", "").strip()
    if extra_prefix:
        buckets_keys.append(("siddhanta", f"{extra_prefix.rstrip('/')}/{cnr}.json"))
    path = f"/tmp/hcs_depth_{cnr}.json"
    for bucket, key in buckets_keys:
        try:
            subprocess.run(
                ["aws", "s3", "cp", f"s3://{bucket}/{key}", path],
                check=True,
                capture_output=True,
                timeout=120,
            )
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (subprocess.CalledProcessError, OSError, json.JSONDecodeError):
            continue
    return None


def _parse_case_status_tokens(cnr: str, case_row: dict) -> dict:
    """Best-effort: warm cookies and scrape opaque filenames from case_status HTML."""
    ctx = ssl.create_default_context()
    cj = CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPSHandler(context=ctx),
    )
    headers = {"User-Agent": "nyv-hc-mobile-depth-token-refetch/1.0"}
    for warm in (
        "https://hcservices.ecourts.gov.in/",
        "https://hcservices.ecourts.gov.in/hcservices/cases/case_status.php",
    ):
        try:
            opener.open(urllib.request.Request(warm, headers=headers), timeout=20).read(4096)
        except Exception:
            pass
    fo = (case_row.get("final_orders") or [{}])[0] if case_row.get("final_orders") else {}
    q = urllib.parse.urlencode(
        {
            "court_code": fo.get("court_code") or case_row.get("court_code"),
            "state_cd": fo.get("state_code") or fo.get("state_cd") or case_row.get("state_code"),
            "dist_cd": fo.get("dist_code") or fo.get("dist_cd"),
            "court_complex_code": fo.get("court_complex_code"),
            "caseStatusSearchType": "CNRNumber",
            "cino": cnr,
        }
    )
    url = f"https://hcservices.ecourts.gov.in/hcservices/cases/case_status.php?{q}"
    try:
        html = opener.open(urllib.request.Request(url, headers=headers), timeout=45).read().decode(
            "utf-8", errors="replace"
        )
    except urllib.error.HTTPError as e:
        return {"_error": f"case_status_http_{e.code}"}
    except Exception as e:
        return {"_error": type(e).__name__}

    tokens: list[dict[str, str]] = []
    for m in DISPLAY_PDF_RE.finditer(html):
        opaque = urllib.parse.unquote(m.group(1))
        tokens.append({"download_filename": opaque, "filename": opaque})
    return {"_html_len": len(html), "parsed_tokens": len(tokens), "interim_orders": tokens}


def _fetch_case_api(cnr: str) -> dict:
    base = (os.environ.get("NYSAPI_URL") or "http://127.0.0.1:8090").rstrip("/")
    key = (os.environ.get("NYSAPI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("missing_NYSAPI_API_KEY")
    req = urllib.request.Request(
        f"{base}/v1/cases/{urllib.parse.quote(cnr)}",
        headers={"X-API-Key": key},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        body = json.load(resp)
    return body.get("case") or body.get("data", {}).get("case") or {}


def _update_rds(cnr: str, merged_raw: dict, dry_run: bool) -> None:
    url = os.environ.get("NYS_CASEAPI_DATABASE_URL") or os.environ.get("CASE_API_DATABASE_URL")
    if not url:
        raise RuntimeError("missing_NYS_CASEAPI_DATABASE_URL")
    try:
        import psycopg2  # type: ignore
        import psycopg2.extras  # type: ignore
    except ImportError as e:
        raise RuntimeError("missing_psycopg2_use_case_api_venv") from e

    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT raw FROM cnr_case_details WHERE cnr = %s LIMIT 1", (cnr,))
            row = cur.fetchone()
            if not row:
                raise RuntimeError("cnr_not_in_cnr_case_details")
            current = row[0]
            if isinstance(current, str):
                current = json.loads(current)
            if not isinstance(current, dict):
                current = {}
            new_raw = _merge_tokens(current, merged_raw)
            if dry_run:
                print(json.dumps({"event": "dry_run_skip_rds", "cnr": cnr}))
                return
            cur.execute(
                "UPDATE cnr_case_details SET raw = %s::jsonb, updated_at = NOW() WHERE cnr = %s",
                (psycopg2.extras.Json(new_raw), cnr),
            )
        conn.commit()
    finally:
        conn.close()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--cnr", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--skip-live", action="store_true", help="S3 merge only")
    args = p.parse_args()
    cnr = args.cnr.strip().upper()

    report: dict[str, Any] = {"event": "hc_mobile_depth_token_refetch", "cnr": cnr, "dry_run": args.dry_run}
    enriched: dict[str, Any] = {}

    depth = _load_s3_depth(cnr)
    if depth:
        report["s3_depth"] = True
        enriched = depth
    else:
        report["s3_depth"] = False

    case_row = _fetch_case_api(cnr)
    report["api_final"] = len(case_row.get("final_orders") or [])
    report["api_interim"] = len(case_row.get("interim_orders") or [])

    if not args.skip_live:
        live = _parse_case_status_tokens(cnr, case_row)
        report["live_case_status"] = {k: live[k] for k in live if not k.startswith("_")}
        if live.get("_error"):
            report["live_error"] = live["_error"]
        elif live.get("parsed_tokens"):
            enriched = _merge_tokens(enriched, live)

    merged_preview = _merge_tokens(case_row, enriched)
    tok_count = 0
    for attr in ("final_orders", "interim_orders"):
        for rec in merged_preview.get(attr) or []:
            if isinstance(rec, dict) and (rec.get("pdf_url") or rec.get("download_filename")):
                tok_count += 1
    report["orders_with_tokens"] = tok_count

    if tok_count == 0:
        print(json.dumps({**report, "status": "blocked_no_tokens"}))
        return 2

    try:
        raw_base = case_row.get("extra") or {}
        if isinstance(raw_base, dict):
            _update_rds(cnr, {**raw_base, **merged_preview}, args.dry_run)
        else:
            _update_rds(cnr, merged_preview, args.dry_run)
        report["rds_updated"] = not args.dry_run
    except Exception as e:
        report["rds_error"] = type(e).__name__
        print(json.dumps(report))
        return 3

    print(json.dumps({**report, "status": "ok"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
