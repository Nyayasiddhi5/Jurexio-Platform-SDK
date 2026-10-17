# Indian draft QA rubric + eval harness (2026-10)

> **NV-INDIAN-DRAFT-EVAL-001** — SME-facing quality model for NSP/NYV drafting.  
> **SSoT code:** `scripts/nv-indian-draft-eval-rubric.ts`, fixtures `scripts/fixtures/nv-indian-draft-sme-cases.json`.  
> **SME rubric v2 (workshop):** [`INDIAN-DRAFT-SME-RUBRIC-V2-WORKSHOP-BRIEF-2026-10.md`](./INDIAN-DRAFT-SME-RUBRIC-V2-WORKSHOP-BRIEF-2026-10.md) — v1 weights/fixtures are engineering baseline until sign-off.

## Rubric dimensions (0–100 each, weighted)

| Dimension | Weight | Source |
|-----------|--------|--------|
| **Structure markers** | 30% | `analyzeDraftStructureMarkers()` per `DraftDocumentType` (cause title, numbered paras, prayer/demand, verification, limitation) |
| **Completion** | 30% | `analyzeDraftCompletion()` — prayer/relief, verification/signature, no abrupt mid-para cut |
| **Length vs tier** | 15% | `validateDraftContentLength()` medium band for doc type |
| **Advocate voice** | 15% | Penalise chatbot openers; generic “India” forum when HC/district supplied |
| **Placeholders** | 10% | `[[PLACEHOLDER:…]]` count vs fact-rich prompt |

Total **pct** = weighted sum (reported in scoreboard).

## Ten SME fixtures

Covers: bail, written statement, legal notice, SLP/writ, counter-affidavit, IA, review, execution, MSA.

Edit only `scripts/fixtures/nv-indian-draft-sme-cases.json` — do not fork prompts in NSP.

## NSP routing audit (no LLM)

For each fixture, asserts NYV resolution for:

| Lane | Wire |
|------|------|
| Interactive | `taskType: legal-draft-fast`, `options.draftLength: medium`, `partnerSyncLean: true` |
| Counsel | `taskType: legal-draft`, `options.draftLength: comprehensive` |

Checks: registry token tier, `resolvePartnerMaxOutputTokens`, comprehensive > medium tokens, Queen path on counsel wire.

## Commands

```bash
cd nyayavigya-platform-312
set -a && source ../.local/secrets/runtime.env && set +a   # or EC2 key lens; never log values
npm run eval:draft:india          # routing + rubric self-test → docs/audit/eval/draft-scoreboard-*.json
npm run eval:draft:india:gate     # exit 1 on routing failures
npm run eval:draft:india:live     # A/B orchestrate (needs NYV_SDK_KEY_NSP); slow + LLM cost
tsx scripts/nv-indian-draft-eval.ts --live --case IN-BAIL-001
tsx scripts/nv-indian-draft-eval.ts --live --lane=fast      # fast-medium only (~6 min / 10 cases)
tsx scripts/nv-indian-draft-eval.ts --live --lane=counsel   # counsel only (~30–50 min; 480s timeout/case)
npx tsx scripts/nv-indian-draft-eval-merge-gate.ts \
  docs/audit/eval/draft-scoreboard-<fast>.json \
  docs/audit/eval/draft-scoreboard-*.json
```

Live gate (optional): `--gate` with `--live` requires counsel avg rubric ≥ fast + 5 points. If lanes are split, run `nv-indian-draft-eval-merge-gate.ts` instead (exit 1 on gate fail).

### Token policy — NV-DRAFT-FAST-SLA-002 (2026-10-08)

| Doc type (medium / `-fast`) | Before (global SLA) | After (registry-aware SLA cap) |
|-----------------------------|---------------------|--------------------------------|
| `bail_application`, `legal_notice`, `interlocutory_application` | min(registry, **8192**, env) | **6144** (= registry default) |
| `written_statement`, `simple_agreement`, `writ_petition`, … | **8192** flat | **8192** (= registry default) |
| `legal-draft` + comprehensive `simple_agreement` | registry **27648** | unchanged **27648** (no fleet 32k) |

`-fast` floors use `min(registryFloor, resolveDraftFastSlaTokenCap({ documentType, tier }))`; **`NYV_PARTNER_MAX_TOKENS_DRAFT_FAST` no longer participates in that min** (avoids EC2 env **4096** starving typed drafts). Attachment bump can raise medium SLA up to **8192** band ceiling. Routing hints use `isMediumTierTruncationLikely` (agreements/notices + long pleadings).

## Live baseline — nysdev (2026-10-11, post **`2026-10-09T1917Z-aws-ssm`** completion+stream meta)

| Metric | Value |
|--------|--------|
| API | `https://api.nyayasiddhi.online` |
| Deploy | **`2026-10-09T1917Z-aws-ssm`** (SSM `e7aaba50`) |
| Routing | 10/10 PASS |
| Fast-medium avg | **69%** |
| Counsel-comprehensive avg | **76%** |
| Merge gate (counsel ≥ fast + 5) | **PASS** (need ≥ **74%**; got **76%**) |

**Scoreboards:** fast `docs/audit/eval/draft-scoreboard-2026-10-11T06-25-51-609Z.json` · counsel `docs/audit/eval/draft-scoreboard-2026-10-11T09-01-19-867Z.json`  
**Merged SSoT:** `docs/audit/eval/draft-scoreboard-merged-gate-2026-10-11T09-10-45-361Z.json`

Prior reference (2026-10-09 morning): fast **69%**, counsel **74%** — `draft-scoreboard-2026-10-09T09-28-05-531Z.json`.

## Live baseline — nysdev (2026-10-08, post **`2026-10-08T0727Z-aws-ssm`** tokens+agree) — superseded by 2026-10-11 row above

| Metric | Value |
|--------|--------|
| API | `https://api.nyayasiddhi.online` |
| Deploy | **`2026-10-08T0727Z-aws-ssm`** SSM **`3c5c39ab`** (on git **`71a0bfaa1`** tree + NV-DRAFT-FAST-SLA-002) |
| Routing | 10/10 PASS |
| Fast-medium avg | **69%** |
| Counsel-comprehensive avg | **72%** |
| Gate (counsel ≥ fast + 5) | **FAIL** (need counsel ≥ **74%**; got **72%**) |

**Merged scoreboard:** `docs/audit/eval/draft-scoreboard-merged-gate-2026-10-08T08-48-25-306Z.json`  
**Fast lane board:** `draft-scoreboard-2026-10-08T07-46-23-729Z.json`  
**Counsel boards:** `07-49-00-664Z` (BAIL), `07-51-46-691Z` (WS), `08-19` … `08-47-33-408Z` (8 cases)  
**Logs:** `/tmp/draft-india-live-fast-2026-10-08-tokens.log`, `/tmp/draft-india-live-counsel-resume-2026-10-08.log`

Per-case (fast → counsel, Δ): IN-BAIL-001 62→75 (+13); IN-WS-001 69→70 (+1); IN-NOTICE-001 67→62 (−5); **IN-SLP-001 69→84 (+15)**; IN-WP-001 67→69 (+2); IN-CA-001 68→68 (0); IN-IA-001 70→79 (+9); IN-REVIEW-001 73→70 (−3); IN-EXEC-001 70→70 (0); **IN-AGREE-001 71→76 (+5)** (fast len **34882**, counsel len **31359**). All HTTP **200**.

**IN-AGREE-001:** counsel **76%** (Sonnet, **27648** tok ceiling); runaway soft trim via `trimTransactionalDraftRunaway` when above registry char band.

## Live baseline — nysdev (2026-10-08, post **`2026-10-08T0236Z-aws-ssm-fbe45dde`** + git **`97bc0cbb2`**) (superseded)

| Metric | Value |
|--------|--------|
| API | `https://api.nyayasiddhi.online` |
| Deploy | **`2026-10-08T0236Z-aws-ssm-fbe45dde`** (R-DRAFT-NSP-QUALITY P0+P1+P2) |
| Routing | 10/10 PASS |
| Fast-medium avg | **74%** (unchanged vs pre-P2) |
| Counsel-comprehensive avg | **69%** (unchanged vs pre-P2) |
| Gate (counsel ≥ fast + 5) | **FAIL** (need counsel ≥ **79%**; release bar counsel ≥ **76%**) |

**Merged scoreboard:** `docs/audit/eval/draft-scoreboard-merged-gate-2026-10-08T05-18-39-280Z.json`  
**Fast lane board:** `draft-scoreboard-2026-10-08T03-17-45-381Z.json`  
**Counsel boards:** per-case `draft-scoreboard-2026-10-08T04-42-*` … `05-17-51-571Z.json`  
**Logs:** `/tmp/draft-india-live-fast-2026-10-08.log`, `/tmp/draft-india-live-counsel-by-case-2026-10-08.log`

Per-case (fast → counsel, Δ): IN-BAIL-001 67→75 (+8); **IN-WS-001 69→85 (+16)**; IN-NOTICE-001 77→69 (−8); **IN-SLP-001 69→56 (−13)**; IN-WP-001 76→67 (−9); IN-CA-001 68→68 (0); IN-IA-001 75→70 (−5); IN-REVIEW-001 73→70 (−3); IN-EXEC-001 85→70 (−15); **IN-AGREE-001 78→62 (−16)**. All counsel HTTP **200**; counsel lane run one case per invocation (480s timeout).

Compared to pre-P2 merged gate (`draft-scoreboard-merged-gate-2026-10-08T01-04-44-492Z.json`, same **74% / 69%** avgs): **IN-WS-001** counsel improved **67% → 85%**; **IN-SLP-001** **52% → 56%** (still regressed vs fast); **IN-AGREE-001** counsel **84% → 62%** (regression — investigate variance). Single-case spot on P2 deploy had **IN-SLP-001 85%** — full gate shows LLM variance on SLP.

Prior pre-P1 baseline (2026-10-07): fast **71%**, counsel **70%** — merge `draft-scoreboard-merged-gate-2026-10-07T17-57-03-223Z.json`.

**R-DRAFT-NSP-QUALITY:** P3 deployed **`2026-10-08T0655Z-aws-ssm`** (**`71a0bfaa1`**). Post-P3 counsel spots improved notice/SLP; **full 10-case merge gate still pending** to close roadmap.

### P3 status (2026-10-08)

**Shipped** ([P3 + notice](54c5affe-240b-4174-9158-1046c24b2f9f)): commit **`71a0bfaa1`**; deploy **`2026-10-08T0655Z-aws-ssm`**, SSM **`c3b298f7`**. Routing **10/10**; vitest **61** on touched modules.

**Post-P3 counsel spot (live):**

| Case | Counsel rubric | vs post-P2 gate counsel |
|------|----------------|-------------------------|
| IN-NOTICE-001 | **84%** | 69% |
| IN-SLP-001 | **84%** | 56% |
| IN-AGREE-001 | **67%** | 62% |
| IN-EXEC-001 | **70%** | 70% |

Next: **GO live draft eval** full merge after P3 to confirm suite avg ≥ fast + 5.

## NYV improvement backlog (NSP drafting — 2026-10-07)

Prioritized from live eval + code audit (**R-DRAFT-NSP-QUALITY**). Ship with `eval:draft:india:live` gate ≥ **76%** counsel avg and counsel ≥ fast + 5.

| P | Item | Primary paths |
|---|------|----------------|
| **P0** ✅ | Doc-type counsel prompts — no pleading “paper-book” / IRAC on `legal_notice` / agreements | `nv-legal-drafting-prompt.ts`, `nv-legal-intelligence-overlay.ts`, `nv-legal-structure-attach.ts` — **DONE 2026-10-07** |
| **P0** ✅ | LLM routing by `DraftDocumentType` — Opus/Queen for litigation; Sonnet + firm clauses for agreements; lean notices | `nv-llm-routing-policy.ts`, `nv-client.ts` / `real-llm-service.ts` (`draftDocumentType`) — **DONE 2026-10-07** |
| **P1** ✅ | Bounded structure checker on counsel exit (notice + agreement + pleadings) | `nv-draft-structure-checker.ts`, `nv-orchestration-content-enforcers.ts`, Queen/specialist orchestrate — **DONE 2026-10-07** |
| **P1** ✅ | NSP comprehensive → `legal-draft-agentic` + NI §138 deterministic blocks in prompt | `applyPartnerComprehensiveAgenticUpgradeTaskType`, `nv-adaptive-router.ts`, `resolveNi138StatutoryNoticeContext`, INTENT `draft_agentic` — **DONE 2026-10-07** |
| **P1** ✅ | Release gate: merge-gate script on 10 SME fixtures before draft prompt/routing changes | Full live merge run **2026-10-08** — gate **FAIL** (see live baseline §) |
| **P2** ✅ | Litigation counsel regressions (SLP/review/exec/IA): single-shot `legal-draft` for SLP/review/exec/IA; counsel structure pass (2048 tok, abrupt-end + SLP overlay) | `shouldUpgradeComprehensiveDraftToAgentic`, `nv-draft-structure-checker.ts`, routing audit — **DONE 2026-10-08** |
| **P2** ✅ | Notice lane: skip Queen on transactional counsel; NI §138 + transactional user/system prompts | `shouldSkipQueenForTransactionalCounselDraft`, `nv-legal-drafting-prompt.ts`, `resolveNi138StatutoryNoticeContext` — **DONE 2026-10-08** |
| **P3** ✅ | Counsel exit deterministic closure + structure checker (SLP truncated, placeholder overflow); agreement transactional prompts | `applyOrchestrationCounselDraftExitPolish`, `nv-draft-completion.ts`, `nv-draft-structure-checker.ts` — **DONE 2026-10-08** (live gate pending post-deploy) |

**Avoid:** global `-fast` token bumps, parallel draft pipelines, direct LLM outside router (**NV-LLM-001**).

### P0 status (2026-10-07)

**Shipped in repo** ([R-DRAFT-NSP-QUALITY P0](659ea936-297c-4894-8690-9f929eda2ff7)): transactional counsel prompts + Sonnet-first routing for notice/agreement `draftDocumentType`. Routing audit **10/10** offline.

**Live regression on nysdev (post-deploy 2026-10-07T21:30Z):** counsel **IN-AGREE-001 82%** (was largest regression pre-P0); **IN-NOTICE-001 71%**. Full 10-case merge gate (counsel avg ≥ **76%**, counsel ≥ fast + 5) **not re-run** this session — spot checks only.

### P1 status (2026-10-07)

**Shipped in repo** ([P1 draft quality + deploy attempt](0df2637e-494f-4db7-abf8-a4c4d7701069)): counsel exit structure checker; comprehensive litigation → `legal-draft-agentic`; NI §138 blocks in profile + user prompt. Routing **10/10** offline; vitest **44/44** on touched suites.

**Deployed nysdev (2026-10-07):** **`2026-10-07T2100Z-aws-ssm-fbe45dde`**, SSM **`360f26a3`** Success. Use `source scripts/nv-source-dev-deploy-env.sh` (not empty root `env.production` placeholders).

**Post-deploy live QA — DONE (2026-10-08):** full 10-case split-lane eval after **`2026-10-07T2100Z-aws-ssm-fbe45dde`**; merge gate **FAIL** (fast **74%**, counsel **69%**). See live baseline § above. Earlier spot checks (2026-10-07): agree **82%**, notice **71%** on single-case counsel runs.

### P2 status (2026-10-08)

**Shipped in repo (GO R-DRAFT-NSP-QUALITY P2):** SLP (Art. 136 on `writ_petition`), `review_petition`, `execution_petition`, `interlocutory_application` stay on single-shot comprehensive `legal-draft` (no `legal-draft-agentic` Queen swarm). Counsel exit structure checker: review/exec/IA eligible types, abrupt/truncated completion trigger, SLP paper-book overlay in checker prompt, counsel max **2048** tokens (env `NYV_DRAFT_STRUCTURE_CHECKER_COUNSEL_MAX_TOKENS`). Routing audit applies agentic upgrade — **10/10** offline; vitest **38/38** on touched suites. **Live merge gate re-run DONE (2026-10-08T05:20Z):** fast **74%**, counsel **69%**, **FAIL** — see live baseline § above; git **`97bc0cbb2`**.

## NV-LEGAL-AI-95-OPERATING-MODEL-001 (planning SSoT — 2026-10-13)

**Goal:** Tier-appropriate **≥95%** on **defined deliverables** (not “paper-book comprehensive” scored on `-fast` medium). One platform, one orchestrate wire, many **task classes** — each with its own rubric + harness + required feature bundle.

### Definition of 95% (counsel-grade, measurable)

| Principle | Rule |
|-----------|------|
| **Deliverable-first** | Score the **artifact** (notice, bail app, research memo, CNR-enriched draft) for the **tier the user selected** (`low` / `medium` / `comprehensive`). |
| **No self-inflicted fail** | Do not measure medium outputs against comprehensive char minima; do not cap tokens below depth hints; do not skip RAG/memory when matter/CNR exists and policy allows. |
| **Full flow** | NSP BFF → NYV orchestrate (or dedicated SDK route) → overlay + memory + RAG + structure checker + completion loop → trust envelope → optional GRPO write-back. |
| **Evidence** | Every ≥95% claim requires **live or CI harness** with positive control (NV-VALIDATE-THE-PROBE-001). |

### NSP legal task classes — audit matrix (NYV responsibility)

| Task class | Interactive wire | Quality stack (must all apply) | Measured today | Path to 95% |
|------------|------------------|--------------------------------|----------------|-------------|
| **Legal chat (FAQ / strategy)** | `legal-chat-fast` + stream | Intel overlay, statute prefetch, optional memory/RAG, citation verify on counsel | Smoke PASS; citation density **not** CI-gated | Citation-density probe in CI; forum + matter context mandatory |
| **Drafts (20 doc types)** | `legal-draft-fast` + `draftLength` | `nv-legal-drafting-prompt`, length registry, structure checker, completion loop, CNR merge, templates/BNSS overlay | SME rubric **~71% fast / ~76% counsel** (10 cases) | Phase 1–4 + templates `/:id/generate` on orchestrate path; matter block; GRPO on rubric |
| **Comprehensive counsel** | NSP worker → `legal-draft` comprehensive | Queen or transactional single-shot, exit polish, structure checker counsel | Counsel-grade 15/0/0 (different harness) | Align worker wire + Continue; same rubric tier `comprehensive` |
| **Doc-grounded draft** | `doc-draft-fast` + attachments | RAG bump, docparse, Patra, matter vault refs | PASS smoke; eval sparse | Attachment bump + EDJ; rubric cases with `ragDocumentIds` |
| **Research / caselaw** | `legal_research`, knowledge APIs | NYS hybrid/FTS, leading-SC boost, intel overlay | Query-dependent (YELLOW on generic bail) | Query planner + mandatory authority block in response contract |
| **CNR / matter** | SDK CNR resolve + parameters | Unified cascade, field gap closure, **prompt injection** | Resolve PASS | Already wired — **utilization**: NSP must pass `cnrFacts` on every matter-linked draft |
| **Templates / BNSS pack** | `/api/nv/templates` + orchestrate | SME-approved catalog, generate endpoint, Queen overlay | WIRED (registry) | NSP: route drafts through template id + forum fields, not ad-hoc prompts only |
| **Compliance / trust** | All orchestrate | QualityEnvelope, `riskBadge`, audit hash, DPDP overlay | LIVE | Fail closed on unverified citations for counsel tier |
| **Docparse / intelligence** | docparse-sdk, analyzeDocument | 58-type engine, legal gate | Legal gate PASS | Use for every upload path (no raw LLM on PDF) |

### Self-inflicted harm register (fix in NYV, not “model blame”)

1. **Scoring comprehensive minima on medium-fast** → Phase 1 rubric tier (in repo; deploy + merge pending).
2. **Token SLA below beta/registry intent** → R-DRAFT-TOKEN-TRUTH-001 (in repo; needs deploy).
3. **`-fast` doc-less RAG skip** → correct for SLA; **harm when** matter has CNR/docs but NSP omits ids → fix wire + policy flag `enableRAG` / attachments.
4. **`gateway/documents/draft`** → bypasses `-fast` policy — **forbidden** for NSP product.
5. **Depth hint empty on medium pleadings** → Phase 2 registry alignment.
6. **Fast structure checker without prompt** → fixed (`nv-fast-delivery-polish.ts` passes `query`).
7. **GRPO offline-only for drafts** → Phase 4 bridge Legal Chat / orchestration persistence.
8. **Console admin API drift** → breaks ops tuning (org/platform) — Lane 4 fixes in progress.

### Full-stack utilization (architecture — “better than ad-hoc Claude”)

```
NSP UX (matter, forum, template id, tier, attachments)
  → buildNyvOrchestrateWire (taskType, draftLength, parameters, options)
  → NYV: partner policy (tokens, Queen vs specialist)
  → prompt: legal-drafting + template overlay + CNR + matter recall + BNSS pack
  → LLM (routed tier) + RAG/memory fan-in
  → post: structure checker + completion loop + trust envelope
  → response: draftQuality, completion*, validationResults, intentResolution
  → optional: SME rubric score → GRPO EMA → router nudge
```

**Templates:** Use `nv-templates-catalog` + `POST /:id/generate` to pin structure before LLM free-form. **Intel:** `nv-legal-intelligence-overlay` on every partner orchestrate (NV-LEGAL-INTEL-FORCE-001). **Compliance:** block or badge unverified citations on counsel paths.

### Program phases (multi-sprint — not one sprint; cumulative)

| Phase | Outcome for 95% planning |
|-------|---------------------------|
| **1** | Honest measurement + token truth + doc-type completion |
| **2** | Hints ↔ caps ↔ fast checker aligned |
| **3** | CNR + matter + template id on every grounded flow |
| **4** | Rubric in `src/` + GRPO write-back + expanded eval matrix (chat, draft, research rows) |
| **5** | Per-task-class CI gates at 95% floor on tier-appropriate fixtures |
| **NSP** | Continue + worker + template/matter pickers (external repo) |

### Option B program pack — CLOSED (NYV) 2026-10-13

- **SSoT:** `documents/working/NSP-OPTION-B-95-RELEASE-PROGRAM-2026-10.md`
- **Commands:** `npm run release:gate:option-b`, `release:gate:option-b:merge`, `release:gate:option-b:95`, `eval:nsp:task-matrix`
- **Merge stages:** `--stage=merge` (counsel ≥ fast+5) then `--stage=release95` (both lanes ≥95%)
- **Live merge (pre-deploy API):** **FAIL** — `draft-scoreboard-merged-gate-2026-10-13T11-36-21-472Z.json`
- **Deploy:** blocked under Option B until **merge PASS** after nysdev deploy + live re-eval

## Prompt SSoT (unchanged by this harness)

System/user prompts: `src/services/nv-legal-drafting-prompt.ts` (`buildLegalDraftSystemPrompt`, `buildLegalDraftUserPrompt`).

## Related

- `documents/working/NSP-NYV-DRAFT-HANDSHAKE-2026-09.md`
- `documents/working/NSP-DRAFT-STREAM-AUDIT-2026-09-09.md`
- Unit tests: `tests/unit/nv-indian-draft-eval-rubric.test.ts`
