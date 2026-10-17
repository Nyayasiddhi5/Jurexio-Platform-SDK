# Joint smoke pack — NSP ↔ NYV (NYV-08)

Same four scenarios as partner one-pager § Joint smoke. **Fixtures:** NSP hosts non-PII PDFs/JPEGs in a private bucket or repo; NYV does not ship binaries in git (NV-SECRETS-001 / PII).

---

## Prerequisites

- NSP SDK key (length 64 on nysdev — verify via `npm run demo:probe:ec2`, no value printed).
- nysdev flags: `NYV_F_DOCPARSE_SDK=1`, `NYV_F_DOCPARSE_EVIDENCE_DEPICT=1`, `NYV_F_DOCPARSE_ATTACH_UNDERSTAND=1`, `NYV_F_DOCPARSE_LLM_FALLBACK=1` recommended.
- Deploy ≥ **`2026-10-16T0908Z-aws-ssm`** (depict/attach vision fix).

---

## Preferred API — onboarding extract (2026-10-16 GO)

NSP Pro should call (not generic parse + manual field bind):

```http
POST /api/nv/v1/sdk/docparse/nsp/onboarding-extract
X-NYV-Platform: nsp-pro
```

Body: `base64`, `fileName`, `mimeType`, **`documentHint`**: `panCard` | `barCert` | `firmCert`, optional **`ingestRole`**: `onboarding_kyc` | `company_kyc`.

Response `data`: `onboardingForm` (NSP Step-2 keys), `userProfile`, `companyProfile`, `extraction`, `classify` inside form.

**Firm certs:** **both** — `firmCert` uses **MCA + state registration** civil types; **Bar Council enrollment** uses `barCert` → `BAR_COUNCIL_CERT` (identity pack).

Golden harness (local): `npm run onboarding-extract:golden` · EC2: `npm run onboarding-extract:probe:ec2` (after deploy).

---

## Scenario 1 — Synthetic PAN (identity / onboarding)

| Step | Owner | Pass |
|------|--------|------|
| Local `runComplete` with `ingestRole: onboarding_kyc` | NSP | `userProfile.pan` or `withheld` consistent; no full Aadhaar |
| Optional agent-recover if `unparsedPageNos` non-empty | NSP → NYV | HTTP **200**, `userProfile` populated |

---

## Scenario 2 — Scanned 1-page company registration

| Step | Owner | Pass |
|------|--------|------|
| Local parse `company_kyc` / `legal-in-civil` | NSP | Some fields resolved or flagged low-confidence |
| `agent-recover` with `localParse` hints | NSP → NYV | **200**; `companyProfile` or `caseCreate` fields improved |

---

## Scenario 3 — JPEG injury / evidence photo

| Step | Owner | Pass |
|------|--------|------|
| Local parse `case_evidence` or image mime | NSP | `evidence.needsDepiction === true` |
| `POST …/nsp/evidence-depict` | NSP → NYV | **200**; `depiction.text` + `limitations` non-empty; store `contentSha256` |
| Second call same bytes | NSP cache | Should not hit NYV (NSP cache hit) |

---

## Scenario 4 — Partial FIR text (draft/chat)

| Step | Owner | Pass |
|------|--------|------|
| Local parse `draft_attachment` with incomplete OCR | NSP | `parseQuality: partial` in stored context |
| `POST …/nsp/attach-understand` with `userPrompt` + `attachContext` | NSP → NYV | **200**; `limitations` mentions partial context; **no** second full parse |
| Orchestrate / draft | NSP | Prompt includes `AttachContextBundle` only |

---

## Automated NYV checks (no fixtures)

```bash
cd nyayavigya-platform-312
npm run demo:probe:ec2          # partner matrix + key_len
npm run partner:smoke:ec2       # 0 failures
npm run docparse-sdk:test       # 399+ unit tests locally
```

Post-enable (NYV):

```bash
bash scripts/_ec2-docparse-legal-gate.sh   # after GO deploy + OCR corpus on host
```

---

## NSP Pro joint attestation (2026-10-16)

| Row | NYV nysdev (SSM probe) | Notes |
|-----|------------------------|-------|
| attach-understand | **200** (SSM **`6b98cb07-7279-46ab-b8e1-42878a8bcf27`**) | Was **422** / Pro “internal error”: strict Zod + sanitizer masking; relaxed schema + retry + stable `code` (`NV-DOCPARSE-ROUTE-ERRORS-001`) |
| evidence-depict | **200** (same probe) | Was **422**: orchestrator ignored `images` — fixed via `nv-vision-json-llm.ts` (Gemini/OpenAI vision JSON) |
| Pro PDF matrix | NSP **12/12 PASS** | `npm run smoke:pro-draft-pdf-matrix` (NSP repo); API export gate green |
| Laptop `smoke:docparse-joint` | **5/5** | SDK + draft upload; NYV rows depend on healthy depict/attach |

**Ops:** `npm run docparse:nsp:flags:ec2` (patch + `_ec2-docparse-nsp-flags-probe.sh` expects **200** on both routes).

---

## Sign-off template (NSP ticket)

| Scenario | Date | HTTP | Owner |
|----------|------|------|-------|
| 1 PAN | | | |
| 2 Company scan | | | |
| 3 JPEG depict | | | |
| 4 Attach-understand | | | |

Attach deploy id, git sha of `@nyv/docparse-sdk` tarball, and `promptVersion` values from responses.
