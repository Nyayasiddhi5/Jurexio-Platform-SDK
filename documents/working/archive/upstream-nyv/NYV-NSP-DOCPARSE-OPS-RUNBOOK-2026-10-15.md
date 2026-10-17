# NSP Docparse — ops runbook (NYV-06 … NYV-12)

**Audience:** NSP SRE, NYV ops, partner support.  
**Cross-ref:** [`NYV-NSP-DOCPARSE-HANDOFF-TICKETS-2026-10-15.md`](./NYV-NSP-DOCPARSE-HANDOFF-TICKETS-2026-10-15.md)

---

## NYV-12 — Base URLs & SDK keys

| Environment | API base | Console (ops) |
|-------------|----------|----------------|
| **nysdev (NSP integration today)** | `https://api.nyayasiddhi.online` | Partner console per existing NSP contract |
| **Production** | Same host unless NYV announces a dedicated prod cutover — confirm with NYV PM before go-live |

**Authentication**

- Header: `X-API-Key: <NYV_SDK_KEY_NSP>` (issued in Postgres `sdk_app_api_keys`; mirrored on EC2 secrets only).
- NSP-only routes: **`X-NYV-Platform: nsp`** (or `nsp-pro`).

**Key rotation (NV-NO-KEY-ROTATION-DEV-001 / demo session)**

- **Do not** rotate `NYV_SDK_KEY_*` on nysdev or in git during demo/integration without explicit user **GO** naming the key.
- Rotation procedure when GO’d: update `/opt/Nyayavigya/secrets/.env.production` + DB hash sync (`nv-env-sdk-key-sync` on gateway boot); stamp `documents/working/NSP-API-KEYS-HANDOVER.md` (names only); notify NSP via secure channel — **never commit values**.
- Workstation mirror (optional): `bash scripts/nv-pull-ec2-sdk-keys.sh` → `.local/secrets/runtime.env` (chmod 600).

---

## NYV-11 — Partial vs gap vs bulk (one mental model)

| User need | Call | Re-OCR? | Returns |
|-----------|------|---------|---------|
| Large PDF / corpus | `POST …/docparse/jobs` + `GET …/jobs/{id}` | Yes (async) | Full `result` |
| Local parse failed / empty pages | `POST …/nsp/agent-recover` | **Yes** | `extraction` + bind objects + `partialRecoveryApplied` |
| Draft/chat with **already extracted** partial text | `POST …/nsp/attach-understand` | **No** | `understanding`, `limitations`, `suggestedFields` |
| “What does this photo show?” | `POST …/nsp/evidence-depict` | N/A (vision) | `depiction`, `contentSha256` |

**Not a public API:** `PartialFieldRecoveryProvider` inside SDK / agent-recover — NSP uses **`options.partialLlm`** on agent-recover, not a separate REST `/partial` endpoint.

---

## NYV-06 — Idempotency & cache keys (NSP-side)

NYV gateway is **stateless** for depict and attach-understand (no server-side dedupe cache today). **NSP must cache.**

| Operation | Dedupe key | Notes |
|-----------|------------|--------|
| **evidence-depict** | `(contentSha256, promptVersion)` | NYV returns `contentSha256` (SHA-256 of raw bytes) and `promptVersion` (`evidence-depict-v1`). Include optional `userQuestion` in cache key if you vary questions per same image. |
| **attach-understand** | `(hash(attachContext + userPrompt + matterSummary), promptVersion)` | `promptVersion` = `attach-understand-v1`. Same prompt + same context → reuse response. |
| **agent-recover** | `(contentSha256, domainPackId, localParse fingerprint)` | Expensive; cache successful recoveries per document upload id on NSP. |
| **jobs** | `jobId` | Poll until `done`/`failed`; do not resubmit same bytes without new job unless intentional. |

**Lane B (NSP Pro):** `NSP_DOC_PARSE_VISION_ASSIST=1` — cache `visualIntel` with the same `(contentSha256, promptVersion)` as depict.

---

## NYV-07 — PII & medical imaging disclaimers

**Product copy (show in NSP UI near uploads / depict results):**

1. **Not medical advice:** Visual descriptions and attach-understanding are **factual assistance for legal workflows** only. They do **not** diagnose conditions, recommend treatment, or replace qualified medical opinion.
2. **Not legal conclusions:** Depictions must not be treated as proof of liability, guilt, or damages.
3. **PII:** Identity fields follow SDK **withhold** rules (e.g. full Aadhaar never in `userProfile`; use `withheld[]`). Do not log raw attachment bytes or API keys.
4. **User responsibility:** Practitioners must verify extracted fields against originals before filing or advising clients.

**Engine behavior (NYV):**

- evidence-depict system prompt: cautious language, no diagnosis, no invented identifiers.
- attach-understand: JSON-only; must state limitations when `parseQuality: partial`.
- `piiFlags[]` on depict is **advisory** — not a DLP guarantee.

---

## NYV-09 — SLA & limits (nysdev / partner tier)

Targets are **best-effort dev SLA** unless a signed enterprise SLA supersedes.

| Path | Sync/async | Payload limits | Pages | Cost guard (NYV) |
|------|------------|----------------|-------|------------------|
| Local `runComplete` | Sync (NSP) | NSP memory policy | `maxPagesPerDoc` run option | N/A |
| `POST /jobs` | Async **202** | ≤8 docs/request; base64 in JSON | `maxPagesPerDoc` ≤ **400** (API cap) | Queue + worker |
| `agent-recover` | Sync | Single doc base64 | Same as job | Partial LLM cap `NYV_DOCPARSE_LLM_FALLBACK_MAX_COST_USD` (default ~0.015) |
| `evidence-depict` | Sync | Image bytes in JSON | 1 image/doc | `NYV_DOCPARSE_EVIDENCE_DEPICT_MAX_COST_USD` (default **0.04**) |
| `attach-understand` | Sync | Text context only | N/A | `NYV_DOCPARSE_ATTACH_UNDERSTAND_MAX_COST_USD` (default **0.02**) |

**p95 (indicative, not contractual):** agent-recover **15–45s** on scanned PDF; depict **5–20s**; attach-understand **3–15s**; job poll interval NSP **2–5s**.

**Rate limits:** Standard partner SDK gateway limits apply (`config/rate-limits`); 429 → backoff.

---

## NYV-10 — Error matrix (support)

| HTTP | Code / symptom | Meaning | NSP action |
|------|----------------|---------|------------|
| **401** | Missing/invalid API key | Auth | Fix key; never retry with logged key |
| **403** | `NSP_*_PLATFORM` | Missing `X-NYV-Platform: nsp` | Set header on NSP HTTP client |
| **404** | Job not found | Bad `jobId` or expired job store | Resubmit job |
| **404** | Route 404 | Wrong path / old deploy | Confirm deploy id ≥ `2026-10-15T1026Z-aws-ssm` |
| **503** | `DOCPARSE_SDK_DISABLED` | `NYV_F_DOCPARSE_SDK=0` | NYV ops |
| **503** | `DOCPARSE_EVIDENCE_DEPICT_DISABLED` | Flag off | NYV ops set `NYV_F_DOCPARSE_EVIDENCE_DEPICT=1` |
| **503** | `DOCPARSE_ATTACH_UNDERSTAND_DISABLED` | Flag off | NYV ops set `NYV_F_DOCPARSE_ATTACH_UNDERSTAND=1` |
| **422** | Sanitized error | Recover/depict/understand failed | Retry once; else agent-recover or human review |
| **400** | Missing base64 / userPrompt | Client bug | Fix payload |

**Schema mismatch:** Compare response to [`NYV-NSP-DOCPARSE-SCHEMAS-2026-10-15.json`](./NYV-NSP-DOCPARSE-SCHEMAS-2026-10-15.json); client-sdk **5.2.4** types in `DocparseApi.ts`.

**Escalation evidence:** `X-Request-Id` / gateway trace if available; deploy id from `/api/nv/health`; never attach secrets.
