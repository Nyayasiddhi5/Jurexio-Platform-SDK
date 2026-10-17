# NSP Option B — 95% Release Program (SSoT)

> **Status:** **CLOSED (NYV program pack)** — 2026-10-13T12:15:00Z  
> **Deploy gate:** **BLOCKED** until **merge stage** PASS on live post-deploy eval (current live merge **FAIL**: fast 71% / counsel 72%).  
> **Audience:** NYV platform, NSP BFF/mobile, SME sign-off.

Cross-links: `INDIAN-DRAFT-QA-RUBRIC-2026-10.md` (§ NV-LEGAL-AI-95-OPERATING-MODEL-001), `NSP-NYV-AI-TASK-SURFACE-2026-09.md`, `NSP-NYV-AI-HANDSHAKE-2026-09.md`.  
**NSP beta crosscheck (minimal changes):** [`NSP-NYV-CONSTRUCT-CROSSCHECK-2026-10.md`](./NSP-NYV-CONSTRUCT-CROSSCHECK-2026-10.md).

---

## 1. Staged gates (Option B)

| Stage | When | Pass criteria | Command |
|-------|------|---------------|---------|
| **merge** | Before first nysdev deploy of this bundle | Counsel avg ≥ fast avg + **5**; 10/10 cases both lanes | `npm run eval:draft:india:merge-gate -- docs/audit/eval/<fast>.json docs/audit/eval/<counsel>.json` |
| **release95** | Before NSP “95% quality” product claim | Fast **and** counsel SME rubric avg ≥ **95%** on tier-appropriate 10-case set (+ per-class gates below) | Same merge script with `--stage=release95` |
| **offline pack** | Every PR / pre-live | Routing 10/10, counsel-grade self-test, task matrix offline | `npm run release:gate:option-b` |

**Latest merge artifact:** `docs/audit/eval/draft-scoreboard-merged-gate-2026-10-13T11-36-21-472Z.json` — **FAIL (merge)**.

---

## 2. Definition of 95% per task class

| Task class | Tier | Deliverable scored | Metric (NYV harness) | 95% floor |
|------------|------|-------------------|----------------------|-----------|
| Legal chat | `medium` / fast | Answer + citations when counsel | `eval:counsel-grade` + future citation-density | ≥95% assertions pass on IN fixture set |
| Legal draft | `medium` | Filing-ready instrument for doc type | `eval:draft:india` SME rubric | ≥95% avg on 10 IN fixtures |
| Legal draft | `comprehensive` | Counsel paper-book / long pleading | Same rubric, `draftLength: comprehensive` | ≥95% avg; counsel ≥ fast + 5 |
| Doc-grounded draft | medium+ | Draft + attachment fidelity | Rubric + RAG cases (matrix row) | ≥95% on grounded fixtures |
| Legal research | counsel | Memo + verified authorities | `eval:legal-accuracy` IN | ≥95% accuracy dimension |
| Web search | medium | Grounded summary + SERP meta | `nsp:ai:matrix:ec2` + stream meta | Functional PASS + SME spot |
| Caselaw / instant search | medium | Relevant hits / fallback | Knowledge hybrid + FTS fallback | Query-class thresholds in matrix |
| Templates | medium | Catalog-anchored draft | `templateId` overlay + rubric | ≥95% when templateId wired |
| CNR / matter | sync | Resolve + prompt injection | `demo:probe:ec2` + draft with `cnrFacts` | 100% positive control on pilot CNRs |
| Docparse / analyzeDocument | medium | Structured extraction | `docparse-sdk:gate:legal` | Corpus legal gate PASS |
| Compliance | all | Envelope + audit | Always-on; not a % | No counsel export when `attestationRequired` (NSP UX) |

**Rule:** Never score **medium** output against **comprehensive** char minima (Phase 1 rubric tier).

---

## 3. NYV Phases 1–4 — closure checklist

| Phase | Scope | NYV status |
|-------|--------|------------|
| **1** | Rubric tier, doc-type completion, token truth | **DONE (repo)** — deploy required for live |
| **2** | Depth hints, fast structure checker + query | **DONE (repo)** |
| **3** | CNR merge (orchestrate), matter recall, template overlay, SME fixtures | **DONE (repo)** — `formatMatterRecallBlock`, `formatTemplateDraftOverlay`, `mergeCnrFactsIntoOrchestrateBody`, fixture `cnrFacts` / `matterRecall` |
| **4** | Rubric in `src/`, expanded task matrix, GRPO observation log | **DONE (repo)** — `nv-nsp-ai-task-eval-matrix`, `nv-draft-rubric-grpo-bridge` (`NYV_DRAFT_RUBRIC_GRPO_LOG=1`) |

---

## 4. Phase 5 — CI / release commands

```bash
cd nyayavigya-platform-312
npm run release:gate:option-b              # offline pack
npm run eval:nsp:task-matrix               # per-class offline probes
npm run eval:counsel-grade:gate            # regression vs prior counsel-grade run
npm run eval:quality-trend:gate            # when live scoreboards exist
npm run nsp:ai:matrix:ec2                  # post-deploy integration (EC2)
```

Add to release checklist after deploy: live fast + counsel lanes → merge → update `NYV_OPTION_B_MERGE_JSON` → `npm run release:gate:option-b:merge`.

---

## 5. NSP product wire (mandatory — no bypass)

Every draft/chat AI call from NSP MUST use **`POST /api/nv/orchestrate`** or **`/stream`** (not `POST /api/nv/gateway/documents/draft`).

| Field | Required | Notes |
|-------|----------|-------|
| `taskType` | Yes | `legal-draft-fast` / `legal-chat-fast` for interactive; `legal-draft` + worker for comprehensive |
| `parameters.documentType` | Strongly recommended | NYV infers if omitted — quality drops |
| `options.draftLength` | Yes for drafts | `low` / `medium` / `comprehensive` |
| `parameters.templateId` | When using catalog | Pins BNSS / SME template anchor in prompt |
| `parameters.cnrFacts` or resolve merge | Matter-linked | From `cnr/resolve` → `mergeCnrFactsIntoOrchestrateBody` |
| `parameters.matterRecall` | Matter-linked | Summary, impugned order, stage |
| `ragDocumentIds` | Doc-grounded | Never paste full PDF when ids available |
| Headers | Yes | `X-API-Key`, `X-NYV-Platform: nsp`, `X-NYV-User-Id` |

Reference implementation: NSP `buildNyvOrchestrateWire` (handshake §3).

---

## 6. Human SME sign-off (before 95% claim)

**Workshop intake (v1 → v2):** [`INDIAN-DRAFT-SME-RUBRIC-V2-WORKSHOP-BRIEF-2026-10.md`](./INDIAN-DRAFT-SME-RUBRIC-V2-WORKSHOP-BRIEF-2026-10.md) — lawyer questions on weights, must-haves, gold samples; no mandatory NSP wire for beta.

Automated gates do **not** replace SME review. Sign-off template:

1. **Sample set:** 3 matters × (chat, medium draft, one comprehensive) — real (redacted) or approved synthetic.
2. **Rubric export:** attach latest `draft-scoreboard-merged-gate-*.json` + per-case notes.
3. **Attestation:** SME name, date, “tier-appropriate deliverable acceptable for NSP release” per doc type.
4. **Blockers:** list any task class below 95% with owner (NYV vs NSP vs NYS data).
5. **Storage:** `documents/working/` sign-off stamp in tracker row only (no PII in git).

---

## 7. Post-close execution order (GO sequence)

1. **GO deploy nysdev** — ship Phases 1–3 runtime (no key rotation).
2. Re-run live `eval:draft:india:live` both lanes → **merge PASS**.
3. `npm run release:gate:option-b:merge` with fresh JSON.
4. Quality sprint to **release95** (prompt/checker/regression cases: IN-REVIEW, IN-WS, IN-WP).
5. Per-class live matrix + SME sign-off §6.
6. **GO prod** only after release95 + NSP wire audit on Pro BFF.

---

## 8. Evidence pointers

| Artifact | Path |
|----------|------|
| Task matrix fixture | `scripts/fixtures/nv-nsp-ai-task-eval-matrix.v1.json` |
| SME draft cases | `scripts/fixtures/nv-indian-draft-sme-cases.json` |
| Merge gate script | `scripts/nv-indian-draft-eval-merge-gate.ts` (`--stage=merge\|release95`) |
| Release gate runner | `scripts/nv-nsp-option-b-release-gate.ts` |

**Tracker:** `Project-Tracker.md` row 2026-10-13T12:15:00Z.
