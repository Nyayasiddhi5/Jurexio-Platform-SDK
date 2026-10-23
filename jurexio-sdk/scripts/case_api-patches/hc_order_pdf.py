"""NV-HC-ORDER-PDF-001 — fetch HC order PDF bytes for mirror/presign pipeline.

Mobile-depth corpus stores portal-relative `filename` paths (e.g. orders/2023/…pdf)
plus court routing codes. eCourts `display_pdf.php` expects either an opaque
download token (from a live case-status session) or valid mobile `pdf_url` params;
path-only fetches return ERROR_filename_validations (verified Session-82 SSM).

This module tries cookie-backed display_pdf with openjustice-style query params.
When NIC rejects the fetch, callers get a structured error — no fabricated PDFs.
"""
from __future__ import annotations

import http.cookiejar
import logging
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from .normalize import normalize_cnr

log = logging.getLogger("case_api.hc_order_pdf")

_DISPLAY_PDF = "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php"
_WARM_URLS = (
    "https://hcservices.ecourts.gov.in/",
    "https://hcservices.ecourts.gov.in/hcservices/",
)


def _norm_path(raw: str) -> str:
    return str(raw or "").strip().lstrip("/")


def _order_field(rec, key: str):
    if rec is None:
        return None
    if isinstance(rec, dict):
        return rec.get(key)
    return getattr(rec, key, None)


def _find_order(case, order_path: str):
    want = _norm_path(order_path)
    for kind, attr in (("final", "final_orders"), ("interim", "interim_orders")):
        arr = getattr(case, attr, None) or []
        for rec in arr:
            fn = _norm_path(_order_field(rec, "filename") or _order_field(rec, "file_name") or "")
            if fn == want or fn.endswith("/" + want) or want.endswith(fn):
                return kind, rec
    return None, None


def _fetch_pdf_url(opener, url: str, headers: dict) -> PdfFetchResult:
    req = urllib.request.Request(url, headers=headers)
    try:
        with opener.open(req, timeout=45) as resp:
            body = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        return PdfFetchResult(ok=False, http_status=e.code, error="http_error", detail=str(e.reason)[:120])
    except Exception as e:
        return PdfFetchResult(ok=False, error="fetch_failed", detail=type(e).__name__)
    if len(body) > 4 and body[:4] == b"%PDF" and len(body) > 500:
        return PdfFetchResult(ok=True, data=body, http_status=status)
    return PdfFetchResult(ok=False, http_status=status, error="not_pdf", detail=body[:80].decode("utf-8", errors="replace")[:120])


@dataclass
class PdfFetchResult:
    ok: bool
    data: bytes | None = None
    http_status: int | None = None
    error: str | None = None
    detail: str | None = None


def fetch_hc_order_pdf(case, cnr: str, filename: str) -> PdfFetchResult:
    norm_cnr = normalize_cnr(cnr)
    if not norm_cnr:
        return PdfFetchResult(ok=False, error="invalid_cnr")
    rel = _norm_path(filename)
    if not rel.lower().endswith(".pdf"):
        return PdfFetchResult(ok=False, error="invalid_filename")

    _kind, order = _find_order(case, rel)
    if order is None:
        return PdfFetchResult(ok=False, error="order_not_on_case", detail=rel[-80:])

    ctx = ssl.create_default_context()
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPSHandler(context=ctx),
    )
    headers = {"User-Agent": "nyv-case-api-hc-order-pdf/1.0"}

    # Session-83: prefer ephemeral mobile-depth download tokens when ingest persisted them.
    pdf_url = _order_field(order, "pdf_url") or _order_field(order, "pdfUrl")
    authtoken = _order_field(order, "authtoken") or _order_field(order, "auth_token")
    download_filename = _order_field(order, "download_filename") or _order_field(order, "opaque_filename")
    if pdf_url and str(pdf_url).strip():
        token_url = str(pdf_url).strip()
        if authtoken:
            sep = "&" if "?" in token_url else "?"
            token_url = f"{token_url}{sep}authtoken={urllib.parse.quote(str(authtoken))}"
        token_res = _fetch_pdf_url(
            opener,
            token_url,
            {
                **headers,
                "Referer": "https://hcservices.ecourts.gov.in/hcservices/cases/case_status.php",
            },
        )
        if token_res.ok:
            return token_res
    if download_filename and str(download_filename).strip():
        opaque = _norm_path(str(download_filename))
        q_op = {"filename": opaque, "appFlag": ""}
        url_op = _DISPLAY_PDF + "?" + urllib.parse.urlencode(q_op, quote_via=urllib.parse.quote)
        opaque_res = _fetch_pdf_url(
            opener,
            url_op,
            {
                **headers,
                "Referer": "https://hcservices.ecourts.gov.in/hcservices/cases/case_status.php",
            },
        )
        if opaque_res.ok:
            return opaque_res

    for warm in _WARM_URLS:
        try:
            opener.open(urllib.request.Request(warm, headers=headers), timeout=15).read(1024)
        except Exception:
            pass

    caseno = getattr(order, "case_no", None) or getattr(order, "caseno", None)
    q = {
        "filename": rel,
        "caseno": caseno,
        "cCode": getattr(order, "c_code", None) or getattr(order, "cCode", None),
        "state_code": getattr(order, "state_code", None) or getattr(order, "state_cd", None),
        "dist_code": getattr(order, "dist_code", None) or getattr(order, "dist_cd", None),
        "court_code": getattr(order, "court_code", None),
        "cino": norm_cnr,
        "appFlag": "",
    }
    q = {k: v for k, v in q.items() if v is not None and str(v).strip() != ""}
    q["appFlag"] = ""
    url = _DISPLAY_PDF + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)
    req = urllib.request.Request(
        url,
        headers={
            **headers,
            "Referer": "https://hcservices.ecourts.gov.in/hcservices/cases/case_status.php",
        },
    )
    try:
        with opener.open(req, timeout=45) as resp:
            body = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        return PdfFetchResult(ok=False, http_status=e.code, error="http_error", detail=str(e.reason)[:120])
    except Exception as e:
        log.warning("hc_order_pdf_fetch_failed cnr=%s detail=%s", norm_cnr, type(e).__name__)
        return PdfFetchResult(ok=False, error="fetch_failed", detail=type(e).__name__)

    if len(body) > 4 and body[:4] == b"%PDF" and len(body) > 500:
        return PdfFetchResult(ok=True, data=body, http_status=status)

    snippet = body[:80].decode("utf-8", errors="replace").replace("\n", " ")
    if b"ERROR_filename" in body:
        err = "ecourts_filename_validation"
    elif b"ERROR_appflag" in body:
        err = "ecourts_appflag_validation"
    elif b"ERROR" in body:
        err = "ecourts_error_body"
    else:
        err = "not_pdf"
    return PdfFetchResult(
        ok=False,
        http_status=status,
        error=err,
        detail=snippet[:120],
    )
