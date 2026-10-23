# Scan corpus (Phase 1A expansion)

Place **real** scanned PDFs here (bank statements, ledgers, FNOL photos-as-PDF, ruled forms).

Synthetic expansion for CI (no secrets): from repo root:

```bash
npm run docparse-sdk:corpus:expand-scans
```

Manifest: `scans/manifest.json` (generated). Benchmark includes `scans/` when present.
