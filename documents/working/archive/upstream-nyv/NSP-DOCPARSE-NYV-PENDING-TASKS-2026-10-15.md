# NSP ↔ NYV docparse — pending tasks (2026-10-15)

| ID | Owner | Task | Status |
|----|-------|------|--------|
| P0 | NYV | Deploy nysdev with alpha.6 routes | **DONE** `2026-10-15T1026Z-aws-ssm` |
| P0 | NYV | NSP handoff NYV-01–12 (OpenAPI, schemas, runbook, smoke spec) | **DONE** — `NYV-NSP-DOCPARSE-HANDOFF-TICKETS-2026-10-15.md` |
| P0 | NYV ops | Enable `NYV_F_DOCPARSE_EVIDENCE_DEPICT` + `NYV_F_DOCPARSE_ATTACH_UNDERSTAND` on nysdev secrets (no key rotation) | **DONE** SSM `381b7439` + probe `8987b1c3` |
| P0 | NYV | Pro joint smoke: depict + attach **200** (vision + schema fix) | **DONE** deploy `2026-10-16T0908Z-aws-ssm`; probe SSM `6b98cb07-7279-46ab-b8e1-42878a8bcf27` |
| P0 | NSP | Wire `runDocParseOrchestrator` → hybrid + cache `nativeParse` | Pro |
| P1 | NSP | `AttachContextBundle` → orchestrate + draft prompt bundle | P2 |
| P1 | NSP | `NSP_DOC_PARSE_VISION_ASSIST=1` Lane B smoke | Pro env |
| P2 | NYV | `pageManifest` in `docparseIntelligence` | **DONE** `@nyv/docparse-sdk@1.0.0-alpha.7` |
| P2 | NYV | Textract FORMS/TABLES → candidate merge | **IN-PROGRESS** — `nv-textract-structure-parse.ts`; pipeline merge behind `NYV_F_TEXTRACT_STRUCTURE` (Phase 1) |
| P2 | Both | Joint smoke assets repo (non-PII fixtures) | Backlog |

Done (2026-10-15): identity/evidence packs, agent-recover extensions, evidence-depict, attach-understand, partner one-pager.
