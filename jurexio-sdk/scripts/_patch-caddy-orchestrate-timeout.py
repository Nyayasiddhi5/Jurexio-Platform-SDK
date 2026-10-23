#!/usr/bin/env python3
"""Patch Caddyfile for long orchestrate upstream (NV-EDGE-ORCH-TIMEOUT-001)."""
from __future__ import annotations

import pathlib
import re
import sys

SNIPPET = """
(gateway_upstream_long) {
        reverse_proxy nyv-gateway-a:5000 nyv-gateway-b:5000 {
                lb_policy least_conn
                lb_try_duration 5s
                health_uri /health
                health_interval 10s
                health_timeout 3s
                fail_duration 30s
                max_fails 3
                import proxy_headers
                transport http {
                        read_timeout 10m
                        write_timeout 10m
                        response_header_timeout 10m
                }
        }
}
"""

API_BLOCK = """api.nyayasiddhi.online:80 {
        import common_headers
        import json_log
        import rate_limit_strict
        encode zstd gzip
        handle /api/nv/orchestrate* {
                import gateway_upstream_long
        }
        handle /api/nv/gateway/research/* {
                import gateway_upstream_long
        }
        handle /api/nv/completions/* {
                import gateway_upstream_long
        }
        handle {
                import gateway_upstream
        }
}"""


def main() -> int:
    path = pathlib.Path(sys.argv[1])
    text = path.read_text()
    if "gateway_upstream_long" in text and "handle /api/nv/orchestrate" in text:
        print("Caddyfile already patched")
        return 0
    bak = path.with_suffix(path.suffix + f".bak.{path.stat().st_mtime_ns}")
    bak.write_text(text)
    if "gateway_upstream_long" not in text:
        text = text.replace("(gateway_staging_upstream)", SNIPPET + "\n(gateway_staging_upstream)", 1)
    text = re.sub(
        r"api\.nyayasiddhi\.online:80 \{.*?\n\}",
        API_BLOCK,
        text,
        count=1,
        flags=re.DOTALL,
    )
    if "gateway_upstream_long" not in text:
        print("ERROR: patch failed", file=sys.stderr)
        return 1
    path.write_text(text)
    print(f"Patched {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
