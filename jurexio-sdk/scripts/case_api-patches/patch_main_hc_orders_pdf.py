from pathlib import Path

main = Path("/home/ubuntu/scripts/case_api/app/main.py")
text = main.read_text()
marker = '@app.get("/v1/_cache"'
snip = Path("/tmp/hc_orders_pdf_route.snippet.py").read_text()
if marker not in text:
    raise SystemExit("main_marker_missing")
if "hc/orders/pdf" in text:
    raise SystemExit("already")
if "hc_order_pdf" not in text:
    text = text.replace(
        "from . import auth, docurl, timeline",
        "from . import auth, docurl, timeline, hc_order_pdf",
    )
main.write_text(text.replace(marker, snip + "\n\n" + marker))
print("main_patched")
