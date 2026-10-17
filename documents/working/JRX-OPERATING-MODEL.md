# JRX operating model

## Repositories

| Repo | Purpose |
|------|---------|
| `nyayavigya-platform-312` (NYV workspace) | India production — **never** receive Jurexio-only changes |
| **Jurexio-Platform-SDK** (GitHub) | Jurexio Enterprise Platform — all JRX work |

## Sync

1. Export: `bash scripts/jurexio-export-bootstrap.sh` from NYV (read-only).
2. Re-apply: `bash scripts/jurexio-reapply-patches.sh`.
3. Re-run rename/scrub tooling if needed: `jrx-phase2-rename.py`, `jrx-phase2-brand-scrub.py`.
4. Record SHA in `UPSTREAM-NYV-SHA.txt` + `Project-Tracker.md`.

## Forbidden

- Jurexio commits on NYV tree.
- Shared RDS (`nyayavigya`), jrx-staging secrets, NYV SDK keys on Jurexio hosts.
- Public `/api/jrx/` on Jurexio production (internal legacy alias off by default).

## Owner scripts

| Script | Role |
|--------|------|
| `scripts/jurexio-export-bootstrap.sh` | NYV-side export (run from NYV checkout only) |
| `scripts/jurexio-reapply-patches.sh` | Jurexio-only patch set |
| `scripts/jrx-guardrail-forbidden-brands.sh` | CI brand gate |
