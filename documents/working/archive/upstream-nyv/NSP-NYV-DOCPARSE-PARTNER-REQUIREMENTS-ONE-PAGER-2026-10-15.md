# NSP ↔ NYV Docparse — partner requirements one-pager (2026-10-15)

**Audience:** NSP BFF, NYV gateway ops, QA.  
**SSOT architecture (NSP):** Pro repo `docs/planning/NSP-DOCUMENT-INTELLIGENCE-GLOBAL-SOLUTION-2026-10-15.md`.

---

## Principle

**NSP local first** — `@nyv/docparse-sdk` `runComplete` on every upload via one orchestrator. **NYV only** for async bulk, gap recovery, vision depict, and attach-understand (partial parse).

---

## Packages (NYV ship)

| Package | Version |
|---------|---------|
| `@nyv/docparse-sdk` | 1.0.0-alpha.6 |
| `@nyayavigya/nsp-docparse` | 1.0.0-alpha.5 |
| `@nyayavigya/client-sdk` | 5.2.4+ |

Pack: `cd nyayavigya-platform-312 && npm run nsp:pack:docparse-local`

---

## Ingest roles → domain packs

| `ingestRole` | `domainPackId` | Bind objects |
|--------------|----------------|------------|
| `onboarding_kyc` | `legal-in-identity` | `userProfile` |
| `company_kyc`, `case_intake` | `legal-in-civil` | `companyProfile`, `caseCreate` |
| `case_evidence`, `chat_attachment`, `draft_attachment` | `legal-in-evidence` | `evidence` |

SDK helper: `domainPackIdForIngestRole(role)`.

---

## NYV gateway routes (NSP header `X-NYV-Platform: nsp`)

| Tier | Endpoint | When |
|------|----------|------|
| T3b | `POST /api/nv/v1/sdk/docparse/jobs` | Bytes/pages over policy |
| T3 | `POST /api/nv/v1/sdk/docparse/nsp/agent-recover` | Unparsed pages, zero resolved fields, human-review |
| Lane B | `POST /api/nv/v1/sdk/docparse/nsp/evidence-depict` | Photos, X-rays, exhibits — “what does this show?” |
| Draft/chat | `POST /api/nv/v1/sdk/docparse/nsp/attach-understand` | **Partial** parse — prompt + attach context only (no re-OCR) |
| Catalog | `GET /api/nv/v1/sdk/docparse/packs` | Pack list |

Client: `NyvClient.docparse.nspAgentRecover`, `.nspEvidenceDepict`, `.nspAttachUnderstand`.

---

## Feature flags (nysdev / NYV gateway)

| Env | Purpose |
|-----|---------|
| `NYV_F_DOCPARSE_SDK=1` | Docparse SDK routes + ingest adapter |
| `NYV_F_DOCPARSE_LLM_FALLBACK=1` | Partial LLM on agent-recover |
| `NYV_F_TEXTRACT=1` (or page alias) | Cloud OCR on weak pages |
| `NYV_F_DOCPARSE_EVIDENCE_DEPICT=1` | evidence-depict |
| `NYV_F_DOCPARSE_ATTACH_UNDERSTAND=1` | attach-understand |

**NSP Pro (local Lane B):** `NSP_DOC_PARSE_VISION_ASSIST=1` — not NYV; cache `visualIntel` on NSP.

---

## attach-understand (draft/chat)

**Request:**

```json
{
  "userPrompt": "Draft a rejoinder using the attached FIR excerpt",
  "attachContext": {
    "parseQuality": "partial",
    "docTypes": ["FIR"],
    "visibleText": "…",
    "visualSummary": "…",
    "fields": { "fir.number": "…" },
    "extractiveSummary": ["…"],
    "ingestRole": "draft_attachment"
  },
  "matterSummary": "optional one-line matter recall",
  "jurisdiction": "IN"
}
```

**Response:** `understanding`, `limitations`, `suggestedFields`, `followUpQuestions`, `promptVersion`.

Does **not** replace agent-recover (OCR gaps) or jobs (bulk).

---

## Visual intelligence cache (NSP)

Single cache key: `(contentSha256, promptVersion)` for depict + Lane B. Same object feeds case documents, case intel, chat, draft (`AttachContextBundle.visualSummary`).

---

## Joint smoke (minimum)

1. Synthetic PAN / registration PDF — local autofill + optional recover.  
2. Scanned 1-page company cert — agent-recover fills `companyProfile`.  
3. JPEG injury photo — local `evidence.needsDepiction` + evidence-depict 200 (flag on).  
4. Partial FIR text — attach-understand 200 (flag on), no second full parse.

Evidence: `npm run demo:probe:ec2` + NSP Pro orchestrator integration tests.

---

## NYV decisions log

| Decision | Status |
|----------|--------|
| NSP owns orchestrator + `nativeParse` persistence | Agreed |
| NYV owns gap/async/depict/attach-understand HTTP | Shipped in gateway |
| 58 doc types = classify plane, not product cap | SDK behavior |
| `pageManifest` v1 | NSP derives from extraction until NYV adds intelligence field |

Pending backlog: [`NSP-DOCPARSE-NYV-PENDING-TASKS-2026-10-15.md`](./NSP-DOCPARSE-NYV-PENDING-TASKS-2026-10-15.md).

**NSP handoff tickets (NYV-01 … NYV-12):** [`NYV-NSP-DOCPARSE-HANDOFF-TICKETS-2026-10-15.md`](./NYV-NSP-DOCPARSE-HANDOFF-TICKETS-2026-10-15.md).
