from fastapi.responses import Response

@app.get("/v1/hc/orders/pdf", tags=["cases"])
def hc_orders_pdf(
    cnr: str,
    filename: str,
):
    """Return raw HC order PDF bytes for mirror jobs (NV-HC-ORDER-PDF-001)."""
    norm = normalize_cnr(cnr)
    if not norm:
        raise HTTPException(status_code=400, detail="cnr must not be empty")
    case, _tried = service.get_case(norm)
    if case is None:
        raise HTTPException(status_code=404, detail="case_not_found")
    result = hc_order_pdf.fetch_hc_order_pdf(case, norm, filename)
    if result.ok and result.data:
        return Response(content=result.data, media_type="application/pdf")
    raise HTTPException(
        status_code=502,
        detail={
            "error": result.error or "pdf_unavailable",
            "detail": result.detail,
            "http_status": result.http_status,
            "hint": "Corpus mobile_depth stores pdf_filename paths only; live Tier-3 NIC session needed for opaque pdf_url tokens.",
        },
    )
