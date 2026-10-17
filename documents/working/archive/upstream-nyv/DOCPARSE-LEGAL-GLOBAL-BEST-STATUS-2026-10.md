# DocParse — India legal + PII positioning (2026-10-07)

## Claim (today)

**India legal deterministic docparse — local-first for NSP, NYV for scale, optional snippet LLM and cloud OCR on gaps only.**

Engine line: `@nyv/docparse-sdk@1.0.0-alpha.3` + `@nyayavigya/nsp-docparse@1.0.0-alpha.2` hybrid.

## Closed in this release (NYV monorepo)

| Gap | Status |
|-----|--------|
| Dual engine cutover | `@nyv/docparse` only when `NYV_F_DOCPARSE_LEGACY=1`; SDK default via `runComplete` |
| Partial LLM intelligence | Snippet-only `PartialFieldRecoveryProvider`; merge into resolutions/autofill |
| Extractive legal intelligence | Obligations/reliefs/deadlines/risks in bundle (`extractiveLegal`) without full-doc LLM |
| Cloud OCR in SDK path | `CloudOcrProvider` wired in `run()` page OCR; NYV GOT adapter inject |
| AWS Textract backup (before LLM) | **LIVE nysdev** — deploy `2026-10-07T0844Z-aws-ssm`; `NYV_F_TEXTRACT=1`; IAM `textract:AnalyzeDocument` (ap-south-1). T3–T4 (TABLES/FORMS merge, Queries) **later**. NSP: `createNspTextractCloudOcrReference` |
| Ruled/table path | Text-layer ruled detection on all routes; image ruled on OCR pages |
| NSP case autofill mapping | `mapExtractionToNspCaseCreate` + hybrid `caseCreate` payload |
| SDK HTTP batch jobs | `POST /api/nv/v1/sdk/docparse/jobs/batch` |
| JRX HTTP docparse | Same routes at `/api/nv/v1/sdk/jrx/docparse` |
| npm publish prep | Version alpha.3; tarball handoff remains primary until registry GO |

## Still partner-side or needs deploy GO

| Item | Owner / action |
|------|----------------|
| 7-day nysdev legal gate OCR > 0 | Run `bash scripts/_ec2-docparse-legal-gate.sh` after **GO deploy nysdev** |
| Latest HTTP on EC2 | User **GO deploy nysdev** — no key rotation |
| NSP Pro UI bind | NSP consumes `caseCreate` + contracts |
| NSP bulk corpus backfill | Use `/jobs/batch` from NSP orchestration |
| Public `@nyv/docparse-sdk` on npm | Legal/license GO; set `private: false` + publish |
| HR/finance/health packs | Roadmap — legal-in only for “global best” claim |
| Indic handwriting | Triage + human review; not claimed as reliable OCR |

## NSP handoff artifact

Regenerate after pull:

```bash
cd nyayavigya-platform-312 && npm run nsp:pack:docparse-local
```

Deliver `NSP-DOCPARSE-LOCAL-BUNDLE-*.tar.gz` + SHA-256 from `.local/nsp-docparse-bundle/MANIFEST-*.txt`.

Optional typed escalation: `@nyayavigya/client-sdk@5.2.2+`.

## Evidence commands (workstation)

```bash
cd nyayavigya-platform-312
npm run docparse-sdk:build
npm run docparse-sdk:test
npm run docparse-sdk:gate:legal
npm run nsp-docparse:build
```

Strict OCR on workers: `NYV_DOCPARSE_GATE_REQUIRE_OCR=1 npm run docparse-sdk:gate:legal`.
