# JRX operating model

## Repositories

| Repo | Purpose |
|------|---------|
| `Jurexio-Platform-SDK` (JRX workspace) | India production — **never** receive Jurexio-only changes |
| **Jurexio-Platform-SDK** (GitHub) | Jurexio Enterprise Platform — all JRX work |

## Sync

1. Export: `bash scripts/jurexio-export-bootstrap.sh` from JRX (read-only).
2. Re-apply: `bash scripts/jurexio-reapply-patches.sh`.
3. Re-run rename/scrub tooling if needed: `jrx-phase2-rename.py`, `jrx-phase2-brand-scrub.py`.
4. Record SHA in `UPSTREAM-JRX-SHA.txt` + `Project-Tracker.md`.

## Forbidden

- Jurexio commits on JRX tree.
- Shared RDS (`jurexio`), jrx-staging secrets, JRX SDK keys on Jurexio hosts.
- Public `/api/jrx/` on Jurexio production (internal legacy alias off by default).

## Owner scripts

| Script | Role |
|--------|------|
| `scripts/jurexio-export-bootstrap.sh` | JRX-side export (run from JRX checkout only) |
| `scripts/jurexio-reapply-patches.sh` | Jurexio-only patch set |
| `scripts/jrx-guardrail-forbidden-brands.sh` | CI brand gate |
