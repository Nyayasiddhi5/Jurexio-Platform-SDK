# NYV → NSP Docparse handoff tickets (NYV-01 … NYV-12)

**Purpose:** NSP integration / production enable — **handoff artifacts only** (no further NYV engine work for first prod).  
**NYV confirmation date:** 2026-10-15  
**Live deploy (nysdev):** `2026-10-15T1026Z-aws-ssm` · git `aeab32ff` · SSM `4003b1ab-6858-43e1-8afc-cd996e275f56`

Once **NYV-01–05** are in NSP’s hands and NSP completes **D1–D4** (orchestrator, cache, AttachContextBundle, joint smoke), first production enable needs **nothing else from NYV**.

---

## Ticket status matrix

| ID | NSP ask | NYV status | Deliverable path |
|----|---------|------------|------------------|
| **NYV-01** | Signed OpenAPI / contract (jobs, poll, NSP routes) | **DONE** | [`NYV-NSP-DOCPARSE-OPENAPI-2026-10-15.yaml`](./NYV-NSP-DOCPARSE-OPENAPI-2026-10-15.yaml) |
| **NYV-02** | npm tarballs alpha.6 + alpha.5 + changelog | **DONE** (tarball via pack script) | See § Packages below |
| **NYV-03** | Final `NSP-UNIFIED-DOCUMENT-INTELLIGENCE-2026-10.md` | **DONE** | [`NSP-UNIFIED-DOCUMENT-INTELLIGENCE-2026-10.md`](../../../documents/working/NSP-UNIFIED-DOCUMENT-INTELLIGENCE-2026-10.md) (repo root) + mirror in this folder |
| **NYV-04** | JSON Schema `userProfile`, `evidence`, attach-understand | **DONE** | [`NYV-NSP-DOCPARSE-SCHEMAS-2026-10-15.json`](./NYV-NSP-DOCPARSE-SCHEMAS-2026-10-15.json) |
| **NYV-05** | nysdev: routes live + depict + partial enabled | **DONE** | Flags **1** in gateway container (SSM patch `381b7439`, probe `8987b1c3` **PASS** — not 503; depict/attach **422** on 1×1 PNG smoke = route enabled, use real fixtures for **200**) |
| **NYV-06** | Idempotency / cache keys | **DONE** | [`NYV-NSP-DOCPARSE-OPS-RUNBOOK-2026-10-15.md`](./NYV-NSP-DOCPARSE-OPS-RUNBOOK-2026-10-15.md) § Cache |
| **NYV-07** | PII / medical imaging disclaimer | **DONE** | Same runbook § PII & medical |
| **NYV-08** | Hosted joint smoke pack | **DONE** (spec + commands; binaries NSP-hosted) | [`NYV-NSP-DOCPARSE-JOINT-SMOKE-2026-10-15.md`](./NYV-NSP-DOCPARSE-JOINT-SMOKE-2026-10-15.md) |
| **NYV-09** | SLA & limits sheet | **DONE** | Runbook § SLA & limits |
| **NYV-10** | Support runbook (404 / 503 / schema) | **DONE** | Runbook § Error matrix |
| **NYV-11** | One partial API — no duplicate shapes | **DONE** | Runbook § Partial vs gap vs bulk |
| **NYV-12** | Prod base URL + key rotation (no keys in git) | **DONE** | Runbook § URLs & keys |

---

## NYV-01 note: no `/docparse/partial` HTTP route

There is **no** public `POST /api/nv/v1/sdk/docparse/partial` endpoint.

| Concept | HTTP surface |
|---------|----------------|
| **OCR / field gaps (bytes re-processed on NYV)** | `POST …/nsp/agent-recover` |
| **Draft/chat partial *context* (no re-OCR)** | `POST …/nsp/attach-understand` |
| **Partial LLM inside SDK** | Internal to `agent-recover` when `options.partialLlm: true` — not a separate REST shape |

NSP should **not** implement a second “partial” client against a fictional `/partial` path.

---

## NYV-02 — Packages

| Package | Version | Changelog |
|---------|---------|-----------|
| `@nyv/docparse-sdk` | **1.0.0-alpha.6** | `packages/docparse-sdk/CHANGELOG.md` |
| `@nyayavigya/nsp-docparse` | **1.0.0-alpha.5** | `packages/nsp-docparse/CHANGELOG.md` |
| `@nyayavigya/client-sdk` | **5.2.4+** | `packages/client-sdk/CHANGELOG.md` (`DocparseApi`) |

**Tarball (NSP local embed):**

```bash
cd nyayavigya-platform-312
npm run docparse-sdk:build && npm run nsp-docparse:build
npm run nsp:pack:docparse-local
# Output: .local/nsp-docparse-bundle/nsp-docparse-local-<UTC>.tar.gz + MANIFEST-*.txt (SHA-256)
```

This bundle includes SDK + hybrid client + integration docs (not npm registry publish — **UNLICENSED / private** until legal GO).

---

## NYV-05 — Ops confirmation (nysdev)

| Check | Evidence (2026-10-15) |
|-------|------------------------|
| Gateway code shipped | Deploy `2026-10-15T1026Z-aws-ssm` |
| Public health | `https://api.nyayasiddhi.online/api/nv/health` → **200** |
| Route wired (no key) | `POST …/nsp/attach-understand` → **401** (not 404) |
| Partner matrix | `npm run partner:smoke:ec2` → **0 failures** |
| `NYV_F_DOCPARSE_EVIDENCE_DEPICT=1` | **DONE** — container lens **1** (user GO 2026-10-15) |
| `NYV_F_DOCPARSE_ATTACH_UNDERSTAND=1` | **DONE** — container lens **1** |
| `NYV_F_DOCPARSE_SDK=1` / `NYV_F_DOCPARSE_LLM_FALLBACK=1` | **DONE** — container lens **1** |
| Flag probe (no 503) | SSM **`8987b1c3-e498-48e1-bc95-9d74eb0654cb`** `PROBE_RESULT=PASS`; script `bash scripts/nv-docparse-nsp-flags-ec2.sh` |

**Note:** Minimal 1×1 PNG probe may return **422** (vision/JSON parse) — that still proves flags are on; joint smoke uses real JPEG/PDF for **200**.

**NSP verification (with NSP SDK key, never log key):**

```bash
# Expect 503 if flag off; 200/422 with valid image if flag on
curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/nv/v1/sdk/docparse/nsp/evidence-depict" \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d '{"base64":"…","fileName":"smoke.jpg","mimeType":"image/jpeg"}'
```

---

## Related NYV docs (already published)

- [`NSP-NYV-DOCPARSE-PARTNER-REQUIREMENTS-ONE-PAGER-2026-10-15.md`](./NSP-NYV-DOCPARSE-PARTNER-REQUIREMENTS-ONE-PAGER-2026-10-15.md)
- [`NSP-DOCPARSE-NYV-AGENT-RECOVER-API-2026-10.md`](./NSP-DOCPARSE-NYV-AGENT-RECOVER-API-2026-10.md)
- [`NSP-DOCPARSE-NYV-PENDING-TASKS-2026-10-15.md`](./NSP-DOCPARSE-NYV-PENDING-TASKS-2026-10-15.md)

---

## Updated practical order (NYV + NSP + both)

| Phase | Owner | Action |
|-------|--------|--------|
| **1** | NYV ops | Set `NYV_F_DOCPARSE_EVIDENCE_DEPICT=1`, `NYV_F_DOCPARSE_ATTACH_UNDERSTAND=1`, confirm `NYV_F_DOCPARSE_SDK=1` + `NYV_F_DOCPARSE_LLM_FALLBACK=1` on nysdev secrets → gateway recreate (**flag-only GO**, no SDK key rotation). |
| **2** | NSP | Wire `runDocParseOrchestrator` → hybrid + persist `nativeParse`; build `AttachContextBundle` for chat / draft / case intake. |
| **3** | Both | Run [`NYV-NSP-DOCPARSE-JOINT-SMOKE-2026-10-15.md`](./NYV-NSP-DOCPARSE-JOINT-SMOKE-2026-10-15.md) four scenarios; then NYV `bash scripts/_ec2-docparse-legal-gate.sh` on nysdev. |
| **4** | NYV (post-enable backlog) | `pageManifest` in `docparseIntelligence`; Textract FORMS/TABLES merge — **not** blocking first NSP prod enable. |

**NSP-only after phase 2:** `NSP_DOC_PARSE_VISION_ASSIST=1` Lane B + cache `visualIntel` (Pro env).
