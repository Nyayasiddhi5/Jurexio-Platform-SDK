#!/usr/bin/env python3
"""NV-BENCH-COST-001 (prices) — read per-1M prices out of the DEPLOYED catalog.

Reads `model-catalog.ts` on stdin, prints `{"models": {...}, "count": n}`.

Prices are parsed from the code that is actually running rather than kept in a
second table, because a benchmark that prices spend from a hardcoded dict can
drift from the catalog and report a saving that no longer exists.
`scripts/nv-cost-model.py` keeps its own PRICE dict on purpose — that file
computes *projections*; this one measures.

Lives as its own file rather than as `python3 -c "..."` inside the host runner:
the runner is base64'd into an SSM payload, and a regex containing quotes inside
a double-quoted `-c` string inside a bash script inside a JSON parameter had
already produced one silently truncated price table.
"""
from __future__ import annotations

import base64
import gzip
import json
import re
import sys

# Each catalog entry is an object literal opening with `id: '<model-id>',`. The
# price/quality fields follow within the same literal, so a bounded window after
# the id is enough and avoids depending on brace matching in TypeScript.
ID_RE = re.compile(r"id:\s*'([^']+)'")
WINDOW = 1600


def parse(src: str) -> dict:
    out = {}
    for m in ID_RE.finditer(src):
        tail = src[m.end():m.end() + WINDOW]
        cin = re.search(r"costInPer1M:\s*([0-9.]+)", tail)
        cout = re.search(r"costOutPer1M:\s*([0-9.]+)", tail)
        if not (cin and cout):
            continue
        lq = re.search(r"legalQuality:\s*([0-9.]+)", tail)
        model_id = m.group(1)
        # Later duplicates are aliases (e.g. vertex mirrors); keep the first.
        if model_id in out:
            continue
        out[model_id] = {
            'inPer1M': float(cin.group(1)),
            'outPer1M': float(cout.group(1)),
            'legalQuality': float(lq.group(1)) if lq else None,
        }
    return out


def main() -> int:
    models = parse(sys.stdin.read())
    if not models:
        print('NVBENCH_FATAL catalog price parse produced 0 models — refusing to cost anything')
        return 1
    payload = json.dumps({'models': models, 'count': len(models)}, separators=(',', ':'))
    # gzip + indexed fixed-width base64 chunks: the plain table is ~9 KB, and
    # `aws ssm list-command-invocations --output text` reflows long lines, which
    # silently corrupted an unchunked blob into an unterminated one. The
    # index/total prefix makes truncation and reordering detectable instead.
    blob = base64.b64encode(gzip.compress(payload.encode())).decode()
    width = 512
    chunks = [blob[i:i + width] for i in range(0, len(blob), width)] or ['']
    for idx, chunk in enumerate(chunks):
        print(f'NVBENCH_PRICES_GZB64 {idx} {len(chunks)} {chunk}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
