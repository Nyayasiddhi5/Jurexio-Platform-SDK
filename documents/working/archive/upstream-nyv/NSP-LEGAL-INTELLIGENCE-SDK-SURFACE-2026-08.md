# NSP — Legal Intelligence SDK surface (2026-08)

> Partner-facing map for Instant Search, statutes/caselaw, amendments, Live Legal Feed, and **SME-grade legal drafting**.  
> **SDK:** `@nyayavigya/client-sdk@5.0.10+` · **No Tavily** for regulatory ingest (own RSS → S3 + RDS + RAG).  
> **Entry doc:** [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) · **Playbook:** [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md).  
> **Updated:** 2026-08-12 — Patra Mitra SDK (`nyv.patraMitra`), orchestrate partner trust (`riskBadge`/`auditHash`/`trust`), HC drafting + **NV-LEGAL-INTEL-FORCE-001**.  
> **Partner live stamp (2026-09-22):** nysdev **`5417fb15`** · deploy **`2026-09-22T1034Z-aws-ssm-5417fb15`** SSM **`9fd0430f`** · filing book **`FB-468.2026-09-22.waveD`** (**43** `nvTemplateKey`s) · SSE **`NSP_PROBE_REQUIRE_NYV_VALIDATION=1 npm run probe:nyv` PASS** (8+6 checks, root mirror); demo probe SSM **`3e8c4553`**. SSoT: [`PLATFORM-STATUS.md`](./PLATFORM-STATUS.md). Older “GAP / deploy pending” rows below are historical unless this stamp says otherwise.

## Surfaces

| Capability | SDK | Gateway / SSoT | Posture |
|---|---|---|---|
| Instant Search | `nyv.instantSearch.*` | Knowledge Plane proxies (no `/instant-search` route) | **Live** |
| Statutes / acts | `nyv.knowledge.searchStatutes` / `instantSearch.statutes` | `/api/nv/knowledge/statutes/search`, `/acts` | **Live** |
| Caselaw FTS/hybrid | `nyv.instantSearch.caselaw({ mode })` | `/api/nv/knowledge/caselaw/search?mode=fts\|hybrid` | **Live** (semantic embed = ops backfill) |
| Code compare | `nyv.knowledge.compareOldToNew` / `compareNewToOld` | knowledge compare routes | **Live** |
| Live Legal Feed | `nyv.intelligence.getLegalFeed` / `generateLegalFeed` | `/api/nv/v1/sdk/legal-intelligence/feed*` | **Live** (own ingest) |
| Regulatory digest | `nyv.intelligence.getRegulatoryFeed` | `/api/nv/intelligence/regulatory-feed` → own RDS + digests | **Live** (empty = honest `no_data`) |
| India legal drafting (SME) | `nyv.draftDocument` / orchestrate `document-drafting` | `/api/nv/gateway/documents/draft` | **Live** — HC pattern, humanized, no bail sureties pre-grant, forum fields |
| Document Companion (Patra) | `nyv.patraMitra.*` | `/api/nv/v1/sdk/patra-mitra/*` | **Live** — SDK 5.0.10 |
| Orchestrate trust envelope | `nyv.orchestrate` outcome | QualityEnvelope + `riskBadge` / `auditHash` / `trust` | **Live** (sanitize-safe) |
| BNSS 25 court apps | `nyv.templates.*` (`nys-in-bnss-*`) | templates catalog + drafting overlay | **Live** |
| Amendment impact | Queen / intelligence routes | NyayaAmend DB via `nv-amendment-impact-service` | **Live** (adapter) |
| NyayaWatch rules | nyaya-tools / Queen leaf | RDS `nv_schema.nv_nyayawatch_rules` | **Live** (persisted) |
| Matter notify on gazette | — | Phase C | **Deferred** |

## Drafting (SME)

```ts
await nyv.draftDocument('anticipatory_bail', {
  instruction: '…facts…',
  highCourt: 'High Court of Karnataka',
  district: 'Bengaluru Urban',
  courtName: 'Sessions Judge, Bengaluru Urban',
  state: 'Karnataka',
}, 'IN');
```

Console reference UI: `https://console.nyayasiddhi.online/legal-drafting` (mic + district/court). NSP Word should expose the same mic + forum fields.

## Instant Search (preferred)

```ts
const nyv = new NyvClient({ apiKey, baseUrl: 'https://api.nyayasiddhi.online' });

await nyv.instantSearch.statutes('BNS 103', { jurisdiction: 'IN', limit: 8 });
await nyv.instantSearch.caselaw('anticipatory bail', { mode: 'fts', limit: 10 });
await nyv.instantSearch.search('BNS murder', { jurisdiction: 'IN', mode: 'fts' });
```

Detail: [`NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md`](./NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md).

## Legal Feed (own pipeline)

1. Collect candidates from allowlisted RSS / own web search (not Tavily).
2. Archive full documents to S3 (`nyvDocumentStorage`) + upsert `nv_regulatory_feeds` + KM RAG rows.
3. Serve digests via Legal Intelligence + regulatory-feed routes.

```ts
await nyv.intelligence.getLegalFeed({ jurisdiction: 'IN' });
await nyv.intelligence.generateLegalFeed({ jurisdiction: 'IN', topN: 10 });
await nyv.intelligence.getRegulatoryFeed('IN', 50);
```

Ops escape hatch only: `NYV_ENABLE_TAVILY_REG_SWEEP=1` (default **off**).

## Queen mesh + ecosystem orchestrate depth

INTENT leaves: `instant_search`, `legal_feed`, amend/watch/impact factories bound to LIVE services (not empty stubs).

**NSP / NYM / NSI / NSA / NSM / NSPM** orchestrate always runs **NV-ECOSYSTEM-BEST-OUTCOME-001**: Queen (or grounded specialist for short statute FAQs) + RAG + citation + hallucination + memory + doc-pipeline when documents are involved. Do not rely on client flags to “turn on” quality — the gateway forces it.

### NV-LEGAL-INTEL-FORCE-001 (anti-generic — live `2026-08-03T1528Z`)

Why partners previously saw “basic chatbot” answers despite a rich agent registry:

1. Queen prompt compiler / length-prefer could **strip** SME legal overlays.
2. `/agents/run` forced **single-agent lean** for partners.
3. Research used thin “be concise” system prompts.

**Fix (gateway-enforced):**

| Path | Behaviour |
|---|---|
| Queen leaves / specialist | Universal counsel overlay (`nv-legal-intelligence-overlay`) always merged; re-appended after compiler |
| `/agents/run` | Ecosystem → Queen/`auto` depth (lean only if `NYV_ALLOW_NSP_NYM_LEAN=1`) |
| Research SDK | Counsel-grade prompt + overlay + higher token budget when partnerBest |
| Agent resolve (IN) | Registry prompts baked with legal-intel marker |

Marker in prompts/logs: `NV-LEGAL-INTEL-FORCE-001`. Expect practising-advocate register, BNS/BNSS/BSA post–Jul 2024, no invented citations, no bail surety schedules pre-grant.

### NV-AGENT-PROMPT-SESSION-001 (load-once constitution)

| Layer | Content | When |
|---|---|---|
| L0 | Full 23-section registry prompt | Session Turn 1 only |
| L1 | §1 identity + §2 mandate + short §0 binding | Every turn / single-shot |
| L2 | Legal-intel / task overlay | Every turn |
| L3 | Safety ring / RAG / citation middleware | Every request (code) |

Ecosystem partners get an auto-minted `sessionId` (`nv-sess-{platform}-…`) when omitted so Turn 1/2+ works without client changes. Prefer sending a stable `sessionId` from NSP/NYM for true multi-turn load-once.

## Indian filing & drafting intelligence (book crosswalk)

> **Added 2026-09-21** · Tracker `NV-BOOK-FILING-DRAFTING-CROSSWALK-001` · design-only (no new code shipped in this pass).
> **Source:** practitioner manual *"Book of Filing, Drafting and Legal Notices"* (96pp, scanned/OCR — Tamil Nadu / Madras High Court practice orientation; CPC + Civil Rules of Practice + Limitation Act 1963 + Court Fees Act 1870 + legal-notice specimens). PDF not committed; OCR text held locally only.
> **Purpose:** map the book's procedural knowledge onto NYV's existing drafting/validation SSoT and define the NSP structured-output surface (`draftProfile` / `validationResults[]`) for every filing/drafting type.

### What the book actually covers (extracted)

| # | Chapter/topic | Nature |
|---|---|---|
| 1 | Important **Sections of CPC** (s.10 res judicata, 11, 21 jurisdiction, 24/25 transfer, 34 interest, 35/35-A/35-B costs, 47 execution, 80 Govt notice, 89 Lok Adalat, 96/100 appeals, 114 review, 115 revision, 148/148-A caveat, 151 inherent, 152/153 corrections) | Procedural statute index |
| 2 | Important **Orders & Rules of CPC** (O.1 parties, O.6 pleadings/amendment, O.7 plaint + O.7 R.14 documents, O.8 written statement/set-off/counter-claim, O.9 ex-parte, O.11 discovery, O.13 documents, O.18–19 evidence/affidavit, O.20 decree, O.21 execution, O.22 LRs, O.23 withdrawal/compromise, O.26 commissioner, O.32 minor, O.33 indigent, O.37 summary suit, O.38 attachment-before-judgment, O.39 injunction, O.40 receiver, O.41–47 appeals/review, O.52 caveat) | Action → Order/Rule map |
| 3 | **Civil Rules of Practice** (vakalat form + consent to change vakalat, service of notice, leave to sue, framing of issues, inspection, return of documents, certified copies, transmission of decrees, cash deposits) | Court-practice rules |
| 4 | **Limitation points — ready reference** (appeal 30/90d, cross-objection 30d from service, revision 90d, **caveat life 90d**, restoration, set-aside ex-parte order/decree, set-aside sale, review 30d) | *Procedural* limitation (days) |
| 5 | **Court fees payable for suits** (per-suit-type fees; decree-copy stamp Rs.5; process/notice fees) | Fee tables (TN, dated) |
| 6 | **Legal notices** — definition, who may issue, statutory requirements, contents (date, sender/recipient name+address, brief facts, cause of action, relief, signature), service modes (personal / RPAD / affixation), notice register columns, postal rates, **model forms** | Format + validation + specimens |
| 7 | **Filing procedure** — mandatory enclosures per filing (original plaint in duplicate, **Verification Affidavit u/s 26(2) & O.6 R.15(4)**, proof affidavit, court-fee, vakalatnama, copies for each defendant), urgent petitions, **model forms** of plaint, suit for injunction, suit for defamation, verification affidavit, plaint by indigent person (O.33), summary suit (O.37), written statement, set-off (O.8 R.6), counter-claim (O.8 R.6-A), **First Appeal** (memorandum + grounds of appeal + enclosures), and the **list of appealable orders** (O.43 R.1) | Enclosure checklist + specimens + appeal pack |

### Crosswalk: book topic → existing NYV asset → proposed capability → NSP SDK surface

| Book topic | Existing NYV asset (SSoT) | Status | Proposed capability (`nv-` / extension) | NSP SDK surface |
|---|---|---|---|---|
| Per-doctype drafting structure (cause title, MOST RESPECTFULLY SHOWETH, numbered paras, PRAYER, VERIFICATION, advocate block) | `nv-indian-draft-structure-registry.ts` (20-key `INDIAN_DRAFT_STRUCTURE_CHECKLIST`), `nv-draft-completion.ts` (`DraftStructureMarkers`), `nv-draft-structure-checker.ts` | **LIVE** | none (already complete) — reuse | `qualityEnvelope.structureMarkers` |
| Doc-type detection + length/token strategy | `nv-draft-length-registry.ts` (21 keys, tier bands, inference) | **LIVE** | Add `first_appeal` / `memorandum_of_appeal`, `set_off`, `counter_claim` variants (currently fold into `petition_application` / `written_statement`) | `qualityEnvelope.inferredDocumentType` |
| Model forms / specimens (plaint, injunction, defamation, indigent, summary suit, WS, set-off, counter-claim, first appeal, notices) | `nv-templates-catalog-service.ts` (204+ IN seeds), `nv-template-doctype-map.ts`, BNSS 25-app pack | **LIVE** | **P1:** ingest book specimens as SME-reviewed IN template seeds (practice-pattern, not certified forms) | `nyv.templates.*` |
| *Procedural* limitation (appeal 30/90d, cross-obj, revision 90d, caveat 90d, restoration, set-aside, review 30d) | `nv-nyayatimeline-service.ts` `LIMITATION_PERIODS` (**substantive** causes only — contract/tort/property in *years*); mesh leaf `nyaya-tools.timeline`; `nv-phase4-services` limitation calc | **PARTIAL — GAP** | **P0:** extend `LIMITATION_PERIODS` with a `procedural` sub-table keyed by doc-type/step (days + Limitation Act Article / CPC step) — *extend, do not fork* | `draftProfile.limitation{ article, days, deadlineDate, condonationRequired }` |
| Court fees (per suit-type table; decree-copy Rs.5 stamp) | `nv-phase4-services.ts` court-fee calculator (ad-valorem, Court Fees Act 1870) | **PARTIAL** | **P2:** enrich with per-suit-type + per-state fixed-fee table (SME-sourced) | `draftProfile.courtFee{ basis, amount, breakdown[] }` |
| Legal-notice requirements + service modes + register | `nv-indian-draft-structure-registry.ts` `legal_notice`/`reply_legal_notice`, `nv-agent-draft-overlay.ts` (NI Act s.138 30-day clock), `nv-court-document-fields.ts` | **LIVE (thin on service mode)** | **P0:** add `serviceMode[]` (personal/RPAD/affixation) + statutory-basis check to notice validation | `draftProfile.serviceModes[]`, `validationResults[]` |
| Filing enclosure manifest (plaint-in-duplicate, verification affidavit u/s 26(2)/O.6 R.15(4), proof affidavit, court-fee, vakalatnama, copies-per-defendant) | *none as structured data* — only draft-content checklist exists | **GAP** | **P0/P1:** new `nv-filing-checklist-registry.ts` — per-doctype enclosure manifest (data-only config, consumed by draft/response contract) | `draftProfile.filingChecklist[]` |
| CPC section / Order-Rule "which provision for which action" index | `nv-system-prompt-engine.ts` procedural rules (partial), NYS statute corpus/RAG | **PARTIAL** | **P2:** curated procedural-map data pack (action → section/O.R) feeding RAG grounding + validation hints | grounding only (no new endpoint) |
| Appealable-orders list (O.43 R.1) | *none* | **GAP** | **P2:** data pack behind appeal drafting/validation ("is this order appealable?") | `validationResults[]` (appeal-maintainability check) |
| e-Filing / court submission | `e-filing/e-filing-service.ts` mesh leaves `efiling.steps` + `e-filing.submit` (bound to `filing`/`court`/`submit` intents) | **WIRED (flagged)** | **P3:** live eCourts filing only behind explicit user **GO** — no claim of live filing today | `nyv.orchestrate` intent `filing` |

### Layered design (no parallel stub pipelines — extend existing factories)

- **DB / config templates:** book specimens → SME-reviewed rows in the existing legal-templates seeds (`nv-legal-templates/seed-templates*.json`) surfaced via `nv-templates-catalog-service`; enclosure manifests + procedural-limitation + court-fee tables as **data-only** registries (`nv-filing-checklist-registry.ts`, extension of `LIMITATION_PERIODS`, extension of phase-4 fee table). No new service tier.
- **RAG corpus:** CPC section index, Order/Rule map, Civil Rules of Practice, appealable-orders list ingested as an **IN procedural corpus** (NYS/GraphRAG ingest as source) — grounds `nv-legal-intelligence-overlay` and drafting prompt; *not* a new retrieval microservice.
- **Validation rules engine:** derive `validationResults[]` from the existing `DraftStructureMarkers` + new filing-checklist + limitation + court-fee registries — one assembler on the response contract, no second scoring pass.
- **Agentic mesh (Queen/intent):** reuse live leaves — `nyaya-tools.timeline` (limitation), draft/orchestrate (`document-drafting`), `efiling.steps`/`e-filing.submit` (filing). New capability is **data + one response-contract field**, not new INTENT leaves (avoids NV-MESH-001 re-plumbing).
- **Cache:** limitation/court-fee/checklist lookups are deterministic → semantic/deterministic-resolver tier (`resolution: deterministic-resolver`), no LLM spend.

### Validation model → NSP `validationResults[]`

Per doc-type checklist mapped to a structured array for the NSP UI. Proposed item shape:

```ts
interface DraftValidationResult {
  id: string;                 // 'court' | 'jurisdiction' | 'cause_title' | 'verification'
                              // | 'limitation' | 'court_fee_stamp' | 'annexures' | 'service_mode'
  label: string;             // human-readable
  status: 'pass' | 'warn' | 'fail' | 'na';
  detail?: string;           // e.g. "Appeal limitation 30 days (Art. 116); 12 days elapsed"
  source: 'structureMarkers' | 'filingChecklist' | 'limitation' | 'courtFee' | 'service';
}
```

Baseline checks per instrument: **court** (exact forum in cause title), **jurisdiction** (territorial + pecuniary), **cause title**, **verification** (present + knowledge/belief split), **limitation** (article + days + condonation flag), **court-fee / stamp** (computed vs supplied), **annexures** (list present + numbered A-1/R-1), **service mode** (notice/summons — personal/RPAD/affixation).

### Formatting model (template slots, not free-form LLM)

Indian court typography expressed as template slots so structure is deterministic and only *facts* come from the LLM:

- **Margins / paper-book:** A4, wide left margin for binding, right-aligned cause-title block, para-numbered body.
- **Cause title block:** court name (ALL CAPS), case type + number + year, `Petitioner(s)` v. `Respondent(s)` with status.
- **Body:** `MOST RESPECTFULLY SHOWETH` → numbered facts → grounds (lettered) → `PRAYER` (itemised) → `VERIFICATION` → `Place/Date` + advocate enrolment block.
- **Vakalatnama block** and **verification affidavit** (u/s 26(2) & O.6 R.15(4)) as separate slotted enclosures.
- Slots map 1:1 to `INDIAN_DRAFT_STRUCTURE_CHECKLIST` entries; the LLM fills facts only, `[[PLACEHOLDER: …]]` for unknowns.

### Phased roadmap

- **P0 (quick wins):** (a) extend `caseCreate` / add `draftProfile` to the draft + orchestrate response contract; (b) extend `LIMITATION_PERIODS` with the procedural-step table; (c) wire existing court-fee calc + a first `nv-filing-checklist-registry.ts` into `draftProfile`; (d) add notice `serviceMode[]`. All data/assembler — reuses live services.
- **P1:** template registry enrichment (ingest book specimens as SME-reviewed IN seeds); add `first_appeal` / `set_off` / `counter_claim` doc-type keys; per-doctype filing-checklist config.
- **P2:** court-specific **rule packs** (CPC section/O-R index, Civil Rules of Practice, appealable-orders, per-state court-fee) — Madras/TN pack first (matches book origin), as RAG + validation data.
- **P3:** live eCourts filing via already-wired `efiling.*` leaves — **flagged, no GO** in this pass.

### Honesty (book-specific)

- The book is a **scanned** (OCR) **Tamil Nadu / Madras** practitioner manual — court-fee amounts and some Rules of Practice are **state-specific and dated**; ship per-state fee/limitation tables only after SME sign-off.
- It teaches **procedure and format** authoritatively; **substantive statute currency** (BNS/BNSS/BSA post–1 Jul 2024 vs the book's CPC/IPC-era references) must come from the NYS corpus + SME, not the book.
- Model forms are **practice-pattern specimens**, not sealed/certified court forms (consistent with the doc's existing Honesty note).
- **No live e-filing** is claimed or enabled here; `efiling.*` stays flagged pending explicit user **GO**.

---

## NYV + NSP joint implementation plan (drafting · validation · templates)

> **Added 2026-09-21** · Tracker `NV-NYV-NSP-DRAFTING-JOINT-PLAN-001` · **design + doc only** (no code shipped this pass).
> **Goal:** one implementation plan spanning **NYV** (platform brain) and **NSP** (partner product/UI) to make Indian legal drafting, validation, templates, checklists, formatting, and forms a **global-best Indian legal platform** — building strictly on the SSoT and gaps identified in the book crosswalk above. No parallel pipelines, no stubs, no e-filing claims without explicit user **GO**.

### 1. Vision & principles

- **Single NYV brain, one pipeline.** All drafting intelligence (structure, length, doc-type inference, limitation, court-fee, checklists, validation) lives in NYV `src/` SSoT and is emitted once on the orchestration/draft response contract. NSP never re-derives legal logic — it *renders* what NYV returns. This honours **NV-NO-DUPLICATE-001** / **NV-MESH-001** (no second scoring pass, no parallel factories).
- **NSP is the presentation & workflow layer.** Forms, manual-fill slots, preview, DOCX/PDF export, checklist ticks, mic capture, and matter→draft UX are NSP's domain. NSP consumes `draftProfile` / `validationResults[]` / `structureMarkers` and turns them into an advocate-grade editing surface.
- **Honesty first.** Templates are **practice-pattern** aids (not sealed/certified court forms); court-fee & procedural-limitation tables are **state-specific and dated** (SME sign-off before selling per-state numbers); empty data returns `na`/`no_data`, never invented. Every filing-readiness marker is a *probe*, not a guarantee.
- **SME-in-the-loop.** Model forms and rule packs enter the catalog only via the existing `nv-templates-sme-review` rubric gate (≥0.75 for `sme_approved`). No auto-published forms.
- **No e-filing without GO.** `efiling.steps` / `e-filing.submit` mesh leaves stay flagged; NSP shows filing *guidance/checklists*, not live court submission, until the user issues an explicit GO naming the court system.

### 2. Architecture (single brain → presentation layer)

```mermaid
flowchart LR
  subgraph NSP["NSP product (presentation + workflow)"]
    UI["Draft workspace UI\n(mic · forum fields · manual slots)"]
    CHK["Checklist / validation panel"]
    EXP["Export DOCX / PDF · preview"]
  end

  subgraph MATTER["Matter / CNR context"]
    CNR["CNR resolve → caseCreate fields\n(court · parties · case type · filing)"]
  end

  subgraph NYV["NYV gateway (single brain)"]
    ORCH["draft / orchestrate\n(document-drafting)"]
    DT["doc-type + length\n(nv-draft-length-registry)"]
    STR["structure checklist\n(nv-indian-draft-structure-registry)"]
    SLOT["template slots\n(nv-templates-catalog-service · nv-template-doctype-map)"]
    ASM["validation assembler\n(structureMarkers + checklist + limitation + court-fee + service)"]
    REG[("data registries\nfiling-checklist · procedural-limitation · court-fee · rule packs")]
  end

  CNR -->|caseCreate slots| ORCH
  UI -->|instruction + forum fields| ORCH
  ORCH --> DT --> STR --> SLOT
  STR --> ASM
  SLOT --> ASM
  REG --> ASM
  ASM -->|draftProfile · validationResults[] · structureMarkers · formattedBlocks[]| UI
  ASM --> CHK
  UI --> EXP
```

### 3. NSP-facing contract table (owner: NYV emits vs NSP renders)

All fields ride the existing `qualityEnvelope` / draft response contract (`nv-orchestration-response-contract.ts`). NYV **owns the values**; NSP **owns the rendering & manual edits**.

| Field | Shape (proposed) | Owner (produces) | NSP responsibility | Status |
|---|---|---|---|---|
| `qualityEnvelope.inferredDocumentType` | `DraftDocumentType` + resolution source | **NYV** (`resolveDraftDocumentTypeWithMeta`) | Show detected type; allow override | **LIVE** |
| `qualityEnvelope.structureMarkers` | `{ prayer, verification, causeTitle, numberedParas, limitationChecked }` | **NYV** (`analyzeDraftStructureMarkers`) | Render pass/fail chips | **LIVE** |
| `draftProfile` | container object (below) | **NYV** (new assembler) | Render profile panel | **GAP (P0)** |
| `draftProfile.filingChecklist[]` | `[{ id, label, mandatory, status, basis }]` | **NYV** (`nv-filing-checklist-registry` — new) | Tickable enclosure list; manual attach | **GAP (P0/P1)** |
| `draftProfile.limitation` | `{ article, days, deadlineDate, condonationRequired, basis }` | **NYV** (extend `LIMITATION_PERIODS` procedural sub-table) | Deadline banner + condonation warning | **PARTIAL (P0)** |
| `draftProfile.courtFee` | `{ basis, amount, currency, breakdown[], state, dated }` | **NYV** (`nv-phase4-services` fee calc + per-suit/state table) | Fee estimate w/ "dated/SME" caveat | **PARTIAL (P2)** |
| `draftProfile.serviceModes[]` | `['personal'\|'rpad'\|'affixation'\|'email'…]` | **NYV** (notice validation extension) | Service-mode picker for notices/summons | **PARTIAL (P0)** |
| `validationResults[]` | `DraftValidationResult[]` (see §Validation model above) | **NYV** (one assembler) | Validation panel; jump-to-section | **GAP (P0)** |
| `templateId` / `templateSlug` | catalog id + `documentTypeKey` | **NYV** (`nv-templates-catalog-service`) | Template picker; slot binding | **LIVE** |
| `formattedBlocks[]` | `[{ slot, heading, body, editable, placeholder }]` | **NYV** (slot mapper over `INDIAN_DRAFT_STRUCTURE_CHECKLIST`) | Slot editor + preview + export | **GAP (P1)** |

Proposed container:

```ts
interface DraftProfile {
  documentType: DraftDocumentType;
  filingChecklist: FilingChecklistItem[];   // enclosure manifest (data-only registry)
  limitation?: { article: string; days: number; deadlineDate?: string; condonationRequired: boolean; basis: string };
  courtFee?: { basis: string; amount: number; currency: 'INR'; breakdown: Array<{ head: string; amount: number }>; state?: string; dated?: string };
  serviceModes?: Array<'personal' | 'rpad' | 'affixation' | 'email' | 'publication'>;
}
```

### 4. Phased roadmap (P0–P4)

> Timeline bands are **targets, not promises**. P0 is data + one assembler over live services (no new INTENT leaves). Nothing below implies live e-filing.

| Phase | Band | NYV work items (extend, no stubs) | NSP work items | Dependencies | Acceptance criteria | Probe / smoke |
|---|---|---|---|---|---|---|
| **P0** — profile + procedural limitation + notice service mode | ~30d | (a) Add `draftProfile` to draft + orchestrate response contract (`nv-orchestration-response-contract.ts`); (b) new **data-only** `nv-filing-checklist-registry.ts` (per-doctype enclosure manifest); (c) extend `LIMITATION_PERIODS` with a `procedural` sub-table (days + Article/CPC step); (d) add notice `serviceModes[]` + statutory-basis check; (e) one `validationResults[]` assembler over `structureMarkers` + registries | Draft workspace consumes `draftProfile`; render checklist + limitation banner + validation panel; service-mode picker for `legal_notice`/`reply_legal_notice` | Book crosswalk (done); response-contract field add | `draftProfile` present on `document-drafting` orchestrate; `validationResults[]` non-empty for plaint/WS/notice; limitation shows Article+days for appeal/revision | `npm run guardrail`; `npm run guardrail:no-new-orphans`; `partner:smoke:ec2` (draft path); vitest contract snapshot |
| **P1** — template enrichment + new doc-types + slots | ~60d | Ingest book specimens as **SME-reviewed IN seeds** (`nv-legal-templates/seed-templates*.json` → `nv-templates-catalog-service`); add doc-type keys `first_appeal`/`memorandum_of_appeal`, `set_off`, `counter_claim` to `nv-draft-length-registry` + `nv-indian-draft-structure-registry` + `nv-template-doctype-map`; emit `formattedBlocks[]` (slot mapper) | Template picker w/ new types; slot-based editor + manual-fill `[[PLACEHOLDER]]` UX; DOCX/PDF export from `formattedBlocks[]`; preview | P0; SME review queue (`nv-templates-sme-review` ≥0.75) | New doc-types resolve (no fold into `petition_application`/`written_statement`); specimens `sme_approved`; export renders all mandatory sections | `npm run guardrail:no-placeholder`; template catalog probe; `eval:quality-trend` no regression |
| **P2** — rule packs (TN/Madras first) + per-suit/state court-fee | ~90d | CPC section index, Order/Rule action-map, Civil Rules of Practice, **appealable-orders (O.43 R.1)**, per-state court-fee table as **RAG + validation data packs** (Madras/TN first); enrich `nv-phase4-services` fee calc; appeal-maintainability check → `validationResults[]` | State-pack selector; "is this order appealable?" hint; fee breakdown w/ state + dated caveat | P1; NYS/GraphRAG ingest of procedural corpus; SME sign-off on TN numbers | TN pack grounds overlay; appeal check returns pass/warn/fail; fee matches SME table within caveat | `guardrail:intent-mesh`; RAG grounding probe; SME rubric log |
| **P3** — matter-driven drafting + limitation deadlines in matter | ~180d | Wire CNR `caseCreate` fields (court/parties/case type/filing) into draft slots; surface `nyaya-tools.timeline` procedural deadlines on the matter; deterministic-resolver cache for limitation/fee/checklist | Matter→draft "start from case" flow; deadline calendar; prefilled cause title | P0–P2; CNR resolve (Appendices K/L) | Draft prefilled from CNR; deadline risk shown on matter; cache hit for repeat lookups | matter-flow smoke; cache-hit probe; `partner:smoke:ec2` |
| **P4** — live e-filing (flagged) | GO-gated | Live eCourts filing behind already-wired `efiling.steps`/`e-filing.submit` — **only on explicit user GO naming the court system** | Filing submission UX (behind GO flag) | P0–P3; explicit GO; deploy approval | No live-filing claim/UX until GO; flag default off | e-filing dry-run probe (flag off by default) |

### 5. Per doc-type matrix (template source · mandatory sections · enclosures · validation · formatting)

Mandatory sections are the SSoT `INDIAN_DRAFT_STRUCTURE_CHECKLIST` entries (condensed). Enclosures/validation additions come from P0/P1 registries.

| Doc-type (`DraftDocumentType`) | Template source | Mandatory sections (SSoT) | Enclosure checklist (P0/P1) | Validation rules | Formatting |
|---|---|---|---|---|---|
| `civil_suit_plaint` (plaint) | catalog seed + book specimen (P1) | Cause title, jurisdiction/valuation, cause of action, numbered facts, grounds/relief, list of docs (O.7 R.14), PRAYER, verification | Plaint in duplicate, verification affidavit (u/s 26(2) & O.6 R.15(4)), court-fee, vakalatnama, copies per defendant, list of documents | court, jurisdiction (territorial+pecuniary), cause_title, verification, court_fee_stamp, annexures, limitation | A4 paper-book, cause-title block, numbered paras, itemised PRAYER |
| `written_statement` (WS) | catalog seed | Cause title, filing limitation (O.8 30/90/120d), preliminary objections, para-wise reply, own version, set-off/counter-claim, PRAYER, verification | WS copy per party, set-off/counter-claim schedule, court-fee on counter-claim, vakalatnama | limitation (service→filing days), cause_title, verification, para-wise completeness | numbered objections first, para-wise reply blocks |
| `legal_notice` | catalog + book model forms (P1) | Letterhead, date/addressee, statutory subject, parties, facts, legal basis, demand + cure period, consequence, deadline, signature | Proof of dispatch (RPAD), copy retained, notice-register entry | statutory_basis, demand+cure-period present, **serviceMode** (personal/RPAD/affixation), limitation clock (e.g. NI s.138 30d) | advocate letterhead slot, without-prejudice reservation |
| `interlocutory_application` (I.A.) | catalog seed | Cause title (main + IA no.), stage reference, urgency, grounds (prima facie/balance/irreparable), PRAYER, affidavit in support | Affidavit in support, copy of main matter reference, court-fee (fixed) | cause_title, urgency present, three-limb grounds, verification | IA number in cause title, verbatim-reproducible PRAYER |
| `bail_application` | catalog + BNSS 25-app pack | Cause title, FIR synopsis (BNS post-Jul-2024), SHOWETH facts, grounds, PRAYER (**no surety schedule pre-grant**), advocate block, verification | FIR copy, custody/remand order, vakalatnama | court, cause_title, **no bail-surety pre-grant**, FIR particulars, verification | Sessions/HC pattern, no surety names/amounts |
| `writ_petition` / SLP | catalog seed | Cause title (Art. 226/32), synopsis/index of dates, memo of parties, SHOWETH (maintainability), lettered grounds, affidavit-in-support, PRAYER, verification | Affidavit in support, annexures (numbered), court-fee, vakalatnama, index/synopsis | maintainability, cause_title, annexures numbered, verification, limitation (where applicable) | paper-book, synopsis + index of dates, lettered grounds |
| `first_appeal` / `memorandum_of_appeal` **(new P1)** | book appeal pack (P1) | Memorandum of appeal, grounds of appeal, cause title, valuation, PRAYER | Certified copy of decree/judgment, court-fee on memo, vakalatnama, appealable-orders check (O.43 R.1) | appeal limitation (30/90d), appealability (O.43 R.1 — P2), court_fee, cause_title | grounds numbered, memorandum format |
| `affidavit_case` / `affidavit_simple` | catalog seed | Cause title/matter ref, deponent block, numbered averments, annexure list (A-1…), verification (knowledge vs belief), oath/affirmation | Annexures A-1…, notary/oath commissioner attestation | verification split, deponent authority, annexures numbered | first-person averments, oath clause |
| vakalatnama **(enclosure)** | Civil Rules of Practice form (P1) | Advocate authority + consent-to-change block | — (itself an enclosure of other filings) | signatory present, court match | standalone slotted enclosure |
| `execution_petition` (summary/darkhast) | catalog seed | Cause title (parent decree), decree particulars (O.21 R.11), amount due, mode of execution, PRAYER, verification | Certified copy of decree, computation sheet, court-fee | decree particulars, arithmetic, limitation (12y Art. 136), verification | O.21 R.11 heads |
| summary suit (O.37) **(P1 specimen)** | book model form (P1) | Cause title, O.37 declaration, facts, debt particulars, PRAYER | Documents relied upon, court-fee, affidavit | O.37 maintainability, liquidated-demand check, court_fee | O.37 endorsement |

### 6. Template & forms strategy

- **SME review gate.** Every book model form / state-rule form enters via `nv-templates-sme-review` (`POST /:id/review`, rubric ≥0.75 → `sme_approved`). No form is partner-visible as `sme_approved` without a passing rubric row. Practice-pattern specimens are labelled as such (not certified/sealed forms).
- **`nyv.templates.*` surface.** Catalog stays the single source (`nv-templates-catalog-service`, 204+ IN seeds + BNSS 25-app pack). New seeds get a `documentTypeKey` via `nv-template-doctype-map` so drafting and templates share one doc-type vocabulary.
- **Book model-forms ingest (P1).** Plaint, injunction suit, defamation suit, indigent (O.33), summary suit (O.37), WS, set-off (O.8 R.6), counter-claim (O.8 R.6-A), first appeal pack, verification affidavit, and notice specimens → SME-reviewed IN seeds. OCR text held locally; **no PDF committed**.
- **State rule packs (P2, TN/Madras first).** Civil Rules of Practice forms, per-state court-fee, and appealable-orders as data packs — TN/Madras first (matches book origin), then extend. State-specific numbers ship **only after SME sign-off**, flagged `dated`.

### 7. Validation layers

1. **Structural** — mandatory sections present: `analyzeDraftStructureMarkers` → `structureMarkers` (`prayer`, `verification`, `causeTitle`, `numberedParas`, `limitationChecked`) + `nv-draft-structure-checker` + `INDIAN_DRAFT_STRUCTURE_CHECKLIST` completeness. **LIVE.**
2. **Substantive** — limitation (procedural sub-table: Article + days + condonation) and court-fee (computed vs supplied). **PARTIAL → P0/P2.**
3. **Procedural** — enclosures (`filingChecklist[]`) + service modes (notice/summons personal/RPAD/affixation) + appealability (O.43 R.1, P2). **GAP → P0/P1/P2.**
4. **SME rubric (optional)** — existing `nv-templates-sme-review` rubric can score a draft for counsel review; not on the hot path, opt-in.

All four layers converge into **one** `validationResults[]` assembler on the response contract (no second scoring pass) — each item `{ id, label, status: pass|warn|fail|na, detail, source }`.

### 8. Formatting engine (slot-based, not free LLM)

- **Slots, not free-form.** Structure is deterministic template slots mapped 1:1 to `INDIAN_DRAFT_STRUCTURE_CHECKLIST`; the LLM fills **facts only**, emitting `[[PLACEHOLDER: …]]` for unknowns. Emitted as `formattedBlocks[]` (P1).
- **Indian court typography.** A4, wide left binding margin, right-aligned cause-title block (court name ALL CAPS, case type/number/year, `Petitioner(s)` v. `Respondent(s)` with status), `MOST RESPECTFULLY SHOWETH` → numbered facts → lettered grounds → itemised `PRAYER` → `VERIFICATION` → place/date + advocate enrolment block. Vakalatnama and verification affidavit (u/s 26(2) & O.6 R.15(4)) as separate slotted enclosures.
- **NSP renders.** NSP owns preview + DOCX/PDF export from `formattedBlocks[]`; NYV never emits binary documents (no PDF commit). NSP applies the typography; NYV supplies structure + facts.

### 9. Integration with matter creation (CNR → draft slots)

- On CNR resolve, `caseCreate` fields (court, case type/number/year, parties with status, filing date, jurisdiction — see Appendices K/L) feed draft slots so the cause-title block and forum fields are prefilled (P3).
- Procedural deadlines from `nyaya-tools.timeline` surface on the matter (limitation banner), reusing the P0 procedural sub-table — no separate deadline engine.
- Deterministic lookups (limitation/court-fee/checklist) resolve via the `deterministic-resolver` cache tier — no LLM spend.

### 10. Quality & guardrails

- **CI on every change:** `npm run guardrail` (includes `guardrail:no-new-orphans` orphan-budget 0, `guardrail:no-placeholder`, `guardrail:intent-mesh`), `npm run eval:quality-trend` (no regression), vitest contract snapshots.
- **NV-EXECUTE-BEFORE-CLAIM-001:** every phase's acceptance is earned by a probe/smoke run (above), not by reading code. Validate the probe (positive control) before believing it.
- **No e-filing claims** and **no per-state court-fee/limitation numbers sold** without SME sign-off / explicit GO. Empty data → `na`/`no_data`.
- **Tracking:** each phase appends `Project-Tracker.md` + `CHANGELOG.md [Unreleased]`; SDK-surface changes bump the client SDK + package CHANGELOG.

### 11. RACI-style split (NYV platform · NSP product · NYS corpus ops)

| Workstream | NYV platform (`nyayavigya-platform-312/`) | NSP product (partner) | NYS corpus ops (`NYS-Agentic-AI/`) |
|---|---|---|---|
| Doc-type + length + structure SSoT | **R/A** | I | — |
| `draftProfile` / `validationResults[]` assembler | **R/A** | C (schema review) | — |
| Filing-checklist / procedural-limitation / court-fee registries | **R/A** | I | C (source verification) |
| Template catalog + SME review | **R** | C (surface + workflow) | **A** (SME sign-off) |
| Rule packs (CPC index, O/R map, appealable-orders, state fee) | **A** (validation data) | I | **R** (corpus ingest / GraphRAG) |
| UI, manual slots, DOCX/PDF export, preview | I | **R/A** | — |
| Matter→draft (CNR `caseCreate`) | **R** | **C** (UX) | C (CNR corpus) |
| e-Filing (flagged, GO-gated) | **R** | C | I |
| Honesty / no-invention posture | **R/A** | **R/A** | **R/A** |

*(R = Responsible, A = Accountable, C = Consulted, I = Informed.)*

### Honesty (joint-plan-specific)

- `draftProfile`, `validationResults[]`, `filingChecklist[]`, `serviceModes[]`, `formattedBlocks[]`, procedural-limitation sub-table, and per-state court-fee are **proposed** (design) — only `inferredDocumentType`, `structureMarkers`, and `templates.*` are LIVE today. `nv-filing-checklist-registry.ts` does not yet exist.
- P0 was **not** auto-implemented in this pass: it requires a new registry + a response-contract field + an assembler (well beyond trivial <20-line wiring), so it is **planned, not shipped**.
- Timeline bands (30/60/90/180d) are planning targets, not commitments.

---

## NSP FB-468 reconciliation (2026-09-21)

> **Added 2026-09-21** · Tracker `NV-NSP-FB468-RECONCILE-001` · **doc-only** (no code shipped this pass).
> **Input:** NSP team's delivered FB-468 plan (filing-book manifest 28 rows + `filing-book-registry.ts` + Filing Book UX + `NYV-FILING-BOOK-PARTNER-CONTRACT-2026.md`) verified against this doc's **joint plan** and the **live NYV SSoT** (`nv-draft-length-registry.ts` 22 `DraftDocumentType` keys, `nv-indian-draft-structure-registry.ts`, `nv-template-doctype-map.ts`, `nv-orchestration-response-contract.ts`).
> **NSP repo not in this workspace** (separate tree) — verified from the NYV side + the user's paste. NSP-side file existence (`packages/nsp-config/**`, `filing-book-manifest.ts`) is taken on the paste, not re-read here.

### A. Headline finding — ownership inversion (the one thing to resolve first)

The NSP FB-468 **inbound** contract (`documentType=nvTemplateKey`, plus `legalBasis`, `mandatorySections`, `requiredAnnexures`, `limitationRuleKey/Hint`, `feeScheduleKey`, `noticeComplianceDays`, `exportProfile`) **pushes filing/drafting intelligence INTO NYV**. The NYV joint plan (§1, §3 above) makes NYV the **single brain** that **derives and emits** exactly these as **outbound** (`draftProfile.filingChecklist[]` / `.limitation` / `.courtFee` / `.serviceModes[]`, `validationResults[]`, `structureMarkers`). Left unreconciled this is a **dual-SSoT / NV-NO-DUPLICATE-001** risk: two systems own the annexure list, the section list, and the limitation number, and they *will* drift.

**Constructive read:** NSP has actually **built the registry NYV planned but never shipped** (`nv-filing-checklist-registry.ts` is still ABSENT on the NYV side). So FB-468 is **convergence, not pure conflict** — but the SSoT must be assigned, not duplicated.

**Resolution (adopted recommendation):**
- **NSP filing-book manifest = the enclosure/section/limitation reference data SSoT** (it is the digitised "Book of Filing"). NYV should **ingest** it (SME-gated) into `nv-filing-checklist-registry.ts` rather than re-author a parallel list.
- **NYV = the runtime authority** that resolves + emits `draftProfile`/`validationResults[]` on the response contract. NSP **renders**; it does not re-derive at request time.
- On the wire NSP sends filing-book keys as **advisory hints** (`filingContext`, see §D), never as authority that overrides NYV structure/validation.

### B. Verdict table (NSP FB-468 item → NYV status)

| NSP FB-468 item | NYV status | Note |
|---|---|---|
| Phase 0 seed manifest (28 rows) + manifest doc | **NYV action (ingest)** | Becomes the source for the still-absent `nv-filing-checklist-registry.ts`; ingest via `nv-templates-sme-review` ≥0.75, don't fork |
| Phase 1 `filing-book-registry.ts` (sections/annexures/limitation hints) | **Partial / convergent** | Mirrors NYV joint-plan `filingChecklist[]` + procedural-limitation sub-table (both GAP on NYV). Assign SSoT (§A) before both ship |
| `buildDraftQualityEnvelope` / `buildPrefilingChecklist` (NSP-side) | **Conflict (naming + layer)** | NYV already emits `draftQuality` (`DraftQualityEnvelope`) from `nv-orchestration-response-contract.ts`. An NSP-side envelope of the same name will collide — rename NSP's to `filingReadiness` and have it *consume* NYV `draftQuality`, not replace it |
| Notice statutory-basis + annexure attestation in Filing Readiness | **Aligned (partial)** | NYV `legal_notice` structure checklist already carries statutory-basis; `attestationRequired` already emitted. NSP adds the UX gate — correct split |
| Phase 3 Wave A skeletons (O1 notices, verification affidavit, legal-draft-format) | **Partial** | Fold onto existing coarse doctypes today (§C); NYV needs granular keys before these resolve as first-class |
| Phase 4 UX (`#/filing-book`, `GET /ns/v1/drafts/filing-book`, Drafts 09.1) | **Aligned (NSP-owned)** | Pure presentation/BFF — NYV has no `/ns/*` route; correct that this is NSP's own BFF surface |
| Phase 5 test harness (`test:filing-book`, 3194/0, registry FB-468) | **Aligned (NSP-owned)** | NSP-side; NYV equivalent is `npm run guardrail` + vitest contract snapshot |
| Phase 6 firm layer (documented, not migrated) | **Aligned** | Consistent with NYV honesty posture |
| Follow-on: court-fee UI, Wave B civil-IA, partition/mesne, Pro deploy | **Partial → NYV P2** | Court-fee is NYV joint-plan **P2** (per-suit/state table, SME-gated) — NSP UI must show `dated`/SME caveat |

### C. Per-P0 `nvTemplateKey` → NYV `DraftDocumentType` map (EXISTS / GAP)

NYV has **no `nvTemplateKey` wire field** — it consumes `parameters.documentType` and resolves to a **coarse 22-key `DraftDocumentType`** via `resolveDraftDocumentTypeWithMeta`. NSP's fine-grained keys therefore **fold or fall through** today. `reconcileStatus: new` on the NSP side is the right signal; the table below is what each key resolves to **right now** and what NYV must add.

| # | NSP `nvTemplateKey` | Resolves today → NYV `DraftDocumentType` | Status | NYV action |
|---|---|---|---|---|
| 1 | `ni_138_statutory_notice` | `legal_notice` (alias `section 138` in template-doctype-map) | **Partial (fold)** | Keep fold; add `serviceModes[]` + `noticeComplianceDays` (30d clock) to outbound |
| 2 | `breach_notice` | `legal_notice` | **Partial (fold)** | ⚠️ Naming collision: NYV `nv-breach-notice-service.ts` is **US data-breach** (unrelated). Do not wire NSP contract-breach to it |
| 3 | `termination_notice` | `legal_notice` | **Partial (fold)** | Fold OK; optional granular key P1 |
| 4 | `consumer_pre_litigation_notice` | `legal_notice` | **Partial (fold)** | Fold OK; CPA 2019 basis hint |
| 5 | `verification_affidavit_plaint` | `affidavit_case` (loose) | **Partial (fold)** | Really an *enclosure* of `civil_suit_plaint` (u/s 26(2) & O.6 R.15(4)); model as `filingChecklist[]` item, not a doctype |
| 6 | `civil_injunction_vacate` | `interlocutory_application` | **Partial (fold)** | O.39 R.4 — fold OK |
| 7 | `civil_receiver_appointment` | `interlocutory_application` | **Partial (fold)** | O.40 — fold OK |
| 8 | `civil_restore_suit` | `interlocutory_application` / `petition_application` | **Partial (fold)** | O.9 R.9 restoration |
| 9 | `civil_setaside_exparte_decree` | `petition_application` | **Partial (fold)** | O.9 R.13 |
| 10 | `civil_amend_pleading` | `interlocutory_application` | **Partial (fold)** | O.6 R.17 |
| 11 | `civil_revision_petition` | ⚠️ **`general_legal_document`** (no `revision` pattern in map) | **GAP** | Add `revision_petition` key (s.115 CPC) — distinct from existing `review_petition` |
| 12 | `civil_section_47_application` | `execution_petition` (loose) | **Partial (fold)** | s.47 execution objection |
| 13 | `civil_cross_objection` | ⚠️ `petition_application`/`general` | **GAP** | Add `cross_objection` key (O.41 R.22) — appeal-adjacent, like the planned `first_appeal` |
| 14 | `civil_review_petition` | **`review_petition`** ✅ | **Aligned** | Direct map — the one clean hit |
| 15 | `civil_caveat` | ⚠️ `general_legal_document` | **GAP** | Add `caveat` key (s.148-A CPC, 90-day life) |
| 16 | `indigent_suit_petition` | `civil_suit_plaint` (loose) | **Partial (fold)** | O.33 variant; fold OK, granular P1 |

**Score:** 1 aligned · 12 partial-fold · **3 hard GAPs** (`civil_revision_petition`, `civil_cross_objection`, `civil_caveat` — all fall to `general_legal_document`, i.e. no structure checklist match). These three plus the already-planned `first_appeal`/`memorandum_of_appeal`/`set_off`/`counter_claim` complete the appeal/execution family.

### D. Merged wire shape (avoid duplicate/conflicting names)

Single reconciled inbound + outbound so NSP fine-grained keys and NYV coarse doctypes coexist without two systems owning the same value:

```ts
// INBOUND (NSP → NYV) — advisory, never overrides NYV authority
parameters: {
  documentType: DraftDocumentType;      // REQUIRED — coarse NYV key (NSP maps nvTemplateKey→this via crosswalk §C)
  filingContext?: {                     // OPTIONAL hint block (was: loose top-level fields)
    nvTemplateKey?: string;             // fine-grained NSP key, echoed back
    filingBookRowId?: string;           // manifest provenance
    filingBookVersion?: string;
    legalBasisHint?: string;            // advisory only — NYS corpus is authority
    limitationRuleKey?: string;         // NYV resolves → draftProfile.limitation
    feeScheduleKey?: string;            // NYV resolves → draftProfile.courtFee
    noticeComplianceDays?: number;      // for notices → draftProfile.serviceModes/limitation clock
    exportProfile?: string;             // NSP render hint (NYV ignores)
  };
  cnrFacts?: unknown; options?: { draftLength }; // unchanged
}
```

**Do NOT** send `mandatorySections` / `requiredAnnexures` as authority — they conflict with NYV `structureMarkers` / `draftProfile.filingChecklist[]`. If sent, NYV treats them as `filingContext.expectedSections[]` (advisory) and reconciles against its own registry, flagging drift in `validationResults[]`.

```ts
// OUTBOUND (NYV → NSP) — NYV owns values; NSP renders + manual-edits
draftQuality: DraftQualityEnvelope;   // LIVE (do NOT shadow with an NSP envelope of the same name)
draftProfile?: {                      // GAP (P0) — NYV emits, echoes filingContext.nvTemplateKey + filingBookRowId
  documentType; templateKey?; filingBookRowId?;
  filingChecklist[]; limitation?; courtFee?; serviceModes?;
};
validationResults?: DraftValidationResult[]; // GAP (P0)
structureMarkers;                     // LIVE (inside draftQuality)
formattedBlocks?[];                   // GAP (P1)
```

**Name-collision resolutions:** NSP `buildDraftQualityEnvelope` → rename **`buildFilingReadiness`** (consumes NYV `draftQuality`); NSP `mandatorySections`/`requiredAnnexures` (inbound authority) → **dropped** in favour of NYV outbound `structureMarkers`/`filingChecklist[]`; loose top-level filing fields → nested **`parameters.filingContext`**.

### E. Required NYV modifications (ordered)

1. **P0 — add 3 GAP doc-type keys** to `src/config/nv-draft-length-registry.ts` (`DraftDocumentType` union + `DRAFT_LENGTH_REGISTRY` + aliases): `revision_petition`, `cross_objection`, `caveat`; add matching checklists to `src/services/nv-indian-draft-structure-registry.ts`; add patterns to `src/config/nv-template-doctype-map.ts` (`\brevision\b`, `\bcross[\s-]?objection\b`, `\bcaveat\b`). *(These are >20-line coordinated edits across the exhaustive `Record<DraftDocumentType,…>` maps — plan, not shipped this pass.)*
2. **P0 — `filingContext` inbound** parsing in `src/routes/nv-orchestration-routes.ts` (advisory-only, echo `nvTemplateKey`/`filingBookRowId`).
3. **P0 — `nv-filing-checklist-registry.ts`** (data-only) seeded from the NSP FB-468 28-row manifest via SME gate; emit `draftProfile.filingChecklist[]`.
4. **P0 — `draftProfile` + `validationResults[]`** on `src/orchestration/nv-orchestration-response-contract.ts` (one assembler over `structureMarkers` + registries) — as already specified in the joint plan §3.
5. **P2 — court-fee** per-suit/state table (`nv-phase4-services`) with `dated`/SME caveat for the NSP court-fee UI follow-on.

### F. Required NSP modifications (contract + frontend patterns)

1. **Crosswalk on the NSP side:** map every `nvTemplateKey` → coarse NYV `documentType` (§C) and send **both** (`documentType` required, `nvTemplateKey` in `filingContext`). Never send `nvTemplateKey` alone as `documentType` — 12 fold + 3 GAP keys would degrade to `general_legal_document`.
2. **Nest advisory fields** under `parameters.filingContext` (§D); stop sending `mandatorySections`/`requiredAnnexures` as authority.
3. **Rename** `buildDraftQualityEnvelope` → `buildFilingReadiness` and consume NYV `draftQuality` rather than re-computing it (avoid the same-name collision).
4. **Render, don't re-derive:** filing checklist ticks, limitation banner, court-fee estimate all come from NYV `draftProfile` when it ships; until then, NSP's `filing-book-registry.ts` is a **local fallback** clearly labelled provisional.
5. **Handle the 3 GAP keys gracefully now** (§ NSP frontend best practices) — NYV returns `inferredDocumentType: general_legal_document` + `documentTypeSource` for them until the P0 keys land.

### G. NSP frontend best practices (Filing Book UX)

- **Placeholder handling:** render `[[PLACEHOLDER: …]]` as **click-to-fill manual slots** (highlighted, tab-navigable); block export while `draftQuality.placeholdersRemaining > 0` and show the count. Never silently strip placeholders.
- **Manual slots vs LLM facts:** structure/section headings are deterministic (from `structureMarkers` / future `formattedBlocks[]`) — make them non-editable scaffold; only the fact bodies are editable. This mirrors the NYV "slots, not free-form LLM" model (§8).
- **Honesty badges:** surface `riskBadge` (GREEN/YELLOW/RED), `trust.authoritiesDelivered` ("3 authorities"), and a **"practice-pattern, not certified form"** label on every filing-book template. Court-fee/limitation numbers show a **`dated` / SME caveat** chip.
- **Attestation gate:** when `attestationRequired: true`, block DOCX/PDF export behind an advocate attestation checkbox (NYV signals; NSP enforces). Do **not** treat HITL/`requestPhase` in-flight as failure.
- **Export:** generate DOCX/PDF **on the NSP side** from `formattedBlocks[]` / content (NYV never emits binaries). Apply Indian court typography (A4, wide binding margin, ALL-CAPS cause title, numbered paras). Persist `requestId`/`auditHash` with the exported file.
- **Error state when NYV lacks the templateKey:** if `draftQuality.inferredDocumentType === 'general_legal_document'` **and** a specific `nvTemplateKey` was requested (the 3 GAP keys), show a non-blocking banner — *"Drafting as a general legal document; specialised {caveat/cross-objection/revision} structure is rolling out"* — still render the draft; do not hard-fail. Log the mismatch for the NYV crosswalk backlog.
- **Comprehensive routing:** honour `draftQuality.routingHint` with a "Upgrade to counsel-grade" CTA (async worker), per the draft handshake — never block the interactive stream waiting on it.

### NYV FB-468 P0 local ship (2026-09-21) — B1–B7

> Tracker **`NV-FB468-P0-001`** (superseded by Wave C deploy) · **LIVE on nysdev** deploy **`2026-09-21T2321Z-aws-ssm`** sha **`2df6ccc1`** (stacks P0 + Wave B/C + D1 + SSE mirror **`650ea32e1`**).

| Block | Path | Outbound |
|---|---|---|
| B1 doc types | `src/config/nv-draft-length-registry.ts`, `nv-indian-draft-structure-registry.ts`, `nv-template-doctype-map.ts`, `nv-document-type-agent-pin.ts` | `revision_petition` / `cross_objection` / `caveat` resolve + structure checklists |
| B2 crosswalk | `src/config/nv-filing-book-crosswalk.ts` | 16 P0 `nvTemplateKey` → coarse type |
| B3 filingContext | `src/services/nv-filing-context-hint.ts` | Advisory parse; echo on `draftProfile` |
| B4 checklist | `src/config/nv-filing-checklist-registry.ts` | `draftProfile.filingChecklist[]` |
| B5 assembler | `src/orchestration/nv-draft-profile-assembler.ts` | `draftProfile` + `validationResults[]` |
| B6 contract | `src/orchestration/nv-orchestration-response-contract.ts` | Emitted on partner draft task types |
| B7 stream | `src/orchestration/nv-stream-terminal-polish.ts` | Stream `run_completed` parity |
| B7b SSE mirror | `src/orchestration/nv-partner-run-completed-sse.ts` | Root mirror of filing fields on `run_completed` (NSP BFF compat) |

**Probes:** `npm run probe:fb468:draft-profile` (C3, no secrets); **`NSP_PROBE_REQUIRE_NYV_VALIDATION=1 npm run probe:nyv`** (live stream, keys from `.local/secrets/runtime.env`); vitest `tests/unit/nv-filing-book-fb468.test.ts`.

#### SSE handshake — filing checklist (`validationResults[]`, `draftProfile`)

Partner draft streams (`legal-draft-fast`, `doc-draft-fast`, `legal-draft`, …) emit filing intelligence on the **`run_completed`** event:

| Location | Fields | Notes |
|---|---|---|
| **`run_completed.result`** (canonical) | `validationResults[]`, `draftProfile`, `formattedBlocks[]`, `draftQuality` | Same shape as sync `POST /api/nv/orchestrate` → `data` |
| **`run_completed` event root** (mirror) | Same four keys when present on `result` | **NV-NSP-SSE-FILING-MIRROR-001** — for BFF parsers that read the event object, not `result` |

NSP **Filing Readiness / prefiling checklist** must parse **`validationResults[]`** from at least one of the rows above (prefer `result` for forward compatibility). Do **not** expect filing fields on provisional `text_delta` events — only on terminal `run_completed`.

Minimal TypeScript (no secrets):

```typescript
if (evt.type === 'run_completed') {
  const envelope = (evt.result ?? evt) as Record<string, unknown>;
  const checklist = envelope.validationResults as Array<{ id: string; status: string }> | undefined;
  const profile = envelope.draftProfile as Record<string, unknown> | undefined;
  // drive Filing Readiness from checklist + profile.filingChecklist
}
```

### Honesty (FB-468-specific)

- **Live (2026-09-22):** B1–B7 + Wave B/C on nysdev (**`2df6ccc1`**); `draftProfile` / `validationResults[]` / `filingChecklist[]` / **`formattedBlocks[]`** / **`draftProfile.limitation`** on partner draft + stream **`run_completed`** (canonical + root mirror).
- **Still GAP (honest):** **`draftProfile.courtFee`** / per-state court-fee tables (P2 SME); keys outside the **40**-key crosswalk; full SME certified-form PDFs ≠ FB-468 checklist.
- Reconciliation pass (2026-09-21 morning) was **doc-only**; P0 code landed same day (**NV-FB468-P0-001**).
- NSP-side file existence (manifest 28 rows, `filing-book-registry.ts`, `test:filing-book` 3194/0) is **reported from the user paste** — the NSP repo is not in this workspace and was not re-read.
- The `nv-breach-notice-service.ts` naming collision is real: it is a **US state data-breach** service, unrelated to the Indian contract-`breach_notice` legal notice.

---

## NSP FB-468 delivery status (2026-09-21)

> **Added 2026-09-21T10:00:00Z** · Tracker `NV-NSP-FB468-DELIVERY-001` · **doc-only** (grep + read of live NYV routes; no code shipped).
> **Input:** NSP team paste — main commit **`ccecd65d`** (FB-468) end-to-end wire shipped on the NSP side; contract `docs/planning/NYV-FILING-BOOK-PARTNER-CONTRACT-2026.md` in the NSP repo (not in this workspace).

### What NSP delivered (`ccecd65d`)

| Item | Status (NSP) |
|---|---|
| Filing Book row → conversational draft → `POST /ns/v1/ai/doc-draft/stream` | **Live (NSP BFF)** |
| `buildNyvFilingBookWireExtension` merged into orchestrate **`parameters`** (incl. `filingBookRowId` provenance) | **Live (NSP)** |
| UX layers table (Filing Book · O1 catalog · Filing Readiness · NYV engine) | **Documented (NSP)** |
| `test:filing-book` harness | **Pass** — assert **3194/0** |
| Partner contract doc | **`NYV-FILING-BOOK-PARTNER-CONTRACT-2026.md`** (NSP repo) |

**Still open (NSP-reported):** Pro deploy; NYV-side register of `nvTemplateKey`s; 96pp OCR manifest handoff; court-fee UI; Wave B civil IA.

### NYV live wire audit — what the gateway accepts **today**

NSP's BFF stream proxies to NYV **`POST /api/nv/orchestrate/stream`** (same body shape as **`POST /api/nv/orchestrate`**) via `src/routes/nv-orchestration-routes.ts`.

| Wire field | NYV today | Handler / SSoT |
|---|---|---|
| `prompt` | **Required** | Route guard (~L381 stream path analogous) |
| `taskType` (`doc-draft`, `doc-draft-fast`, `legal-draft`, `document-drafting`, …) | **Accepted** | Partner aliases in `src/utils/nv-partner-platform.ts` |
| `parameters.documentType` (+ `draftType`, `template`, `docType`) | **Accepted** — normalized to coarse **`DraftDocumentType`** | `applyPartnerDraftDocumentTypeInference` → `resolveDraftDocumentTypeWithMeta` in `src/config/nv-draft-length-registry.ts` |
| `parameters.instruction` / body `prompt` | **Accepted** | Draft overlays + inference blob |
| `parameters.cnrFacts` / `caseContext` / `cnrResolve` (+ top-level CNR ids) | **Accepted** — merged to `parameters.cnrFacts` | `mergeCnrFactsIntoOrchestrateBody` in `src/services/nv-cnr-orchestrate-merge.ts` |
| `options.draftLength` | **Accepted** | `resolveDraftLengthTier` |
| `parameters.filingContext` (`nvTemplateKey`, `filingBookRowId`, …) | **Local ship (2026-09-21)** | Parsed in `nv-filing-context-hint.ts`; resolution also via `resolveDraftDocumentTypeWithMeta`; echoed on **`draftProfile`** in `nv-orchestration-response-contract.ts` (not yet on EC2 until deploy) |
| Top-level / `parameters.mandatorySections`, `requiredAnnexures` as authority | **Advisory only (local)** | Mapped to `expectedSections` / `expectedAnnexures`; drift → `validationResults[]` (`na`), not authority |
| Outbound `draftProfile` / `validationResults[]` / `filingChecklist[]` | **Local ship (2026-09-21)** | `nv-draft-profile-assembler.ts` + response contract; stream parity via `nv-stream-terminal-polish.ts` |
| Fine-grained keys `revision_petition` / `cross_objection` / `caveat` | **Local ship (2026-09-21)** | First-class `DraftDocumentType` keys + crosswalk from `civil_*` template keys |

**Wire alignment verdict (updated 2026-09-21T12:20:00Z):** NSP wire shape matches §D; NYV P0 **B1–B7 shipped locally**. **Deploy GO still required** for nysdev/partner smoke on live host.

### NYV still-open P0 checklist (ordered)

1. **Register 3 GAP doc-types** — `revision_petition`, `cross_objection`, `caveat`: `src/config/nv-draft-length-registry.ts`, `src/services/nv-indian-draft-structure-registry.ts`, `src/config/nv-template-doctype-map.ts`.
2. **Register remaining Wave A / filing-book `nvTemplateKey` crosswalk** — extend `nv-template-doctype-map.ts` + alias table (NSP paste: "NYV register nvTemplateKeys"); keep coarse `parameters.documentType` required per §C.
3. **Parse advisory `parameters.filingContext`** — `src/routes/nv-orchestration-routes.ts` (+ optional `src/services/nv-filing-context-hint.ts` if split); echo keys on outbound when `draftProfile` exists.
4. **Seed `src/config/nv-filing-checklist-registry.ts`** (new) from NSP FB-468 28-row manifest + SME gate (`nv-templates-sme-review`); ingest path for **96pp OCR manifest** when handoff lands.
5. **Emit `draftProfile` + `validationResults[]`** — `src/orchestration/nv-orchestration-response-contract.ts` + one assembler over `structureMarkers` + registries (joint plan §3).
6. **Deploy + smoke** — user **GO** for nysdev; `npm run partner:smoke:ec2` / vitest orchestration contract after code lands.
7. **P2 court-fee table** — `src/services/nv-phase4-services.ts` (SME-gated) for NSP court-fee UI follow-on.
8. **Wave B civil IA** — structure checklist + template keys (joint plan P1 band).

### Merged contract (reiterated — hints vs authority)

Unchanged from **§NSP FB-468 reconciliation §A + §D**:

- **NSP filing-book manifest** = reference-data SSoT (enclosure/section/limitation rows); NYV **ingests**, does not re-author in parallel.
- **NYV** = runtime authority for structure, validation, limitation/court-fee resolution, and **`draftQuality` / future `draftProfile` / `validationResults[]`**.
- **Inbound:** `parameters.documentType` (coarse NYV key) **required**; fine-grained **`parameters.filingContext.nvTemplateKey`** + **`filingBookRowId`** = **advisory hints only** — never override NYV `structureMarkers` or checklist.
- **Do not** send `mandatorySections` / `requiredAnnexures` as authority; if sent during transition, treat as advisory `filingContext.expectedSections[]` / annexure hints and reconcile in `validationResults[]` when the assembler ships.
- **Outbound:** NSP **`buildFilingReadiness`** (renamed from `buildDraftQualityEnvelope`) **consumes** LIVE NYV **`draftQuality`** — no duplicate envelope name.

### Honesty (delivery-status-specific)

- NSP **`ccecd65d`** capabilities verified from **user paste only** — NSP repo not re-read in this workspace.
- NYV wire audit earned by **grep/read** of `nv-orchestration-routes.ts`, `nv-partner-platform.ts`, `nv-draft-length-registry.ts`, `nv-orchestration-response-contract.ts` — **no runtime probe** this pass (no code change).
- Until P0 lands, NSP Filing Readiness may use **local `filing-book-registry.ts` fallback** (provisional); NYV stream still returns **`draftQuality`** without `filingBookRowId` echo.

### NYV P0 shipped locally — NV-NSP-FB468-P0-001 (2026-09-21, commit `f8443f298`)

> **Status: P0 LIVE on nysdev** (deploy **`2b9f4f6e`**, 2026-09-21). Verified pre-ship: vitest 21/21 + C3 probe PASS + `npm run guardrail`; post-ship: `/api/nv/health` **200**, `partner:smoke:ec2` **0 failures**.

The NYV-side GAPs from the delivery-status wire audit are now **closed in code (local)**:

| Prior GAP | Now (local) | Where |
|---|---|---|
| `revision_petition` / `cross_objection` / `caveat` absent | **Registered** across every exhaustive `DraftDocumentType` map | `nv-draft-length-registry.ts`, `nv-indian-draft-structure-registry.ts`, `nv-document-type-agent-pin.ts`, `nv-template-doctype-map.ts` |
| No `nvTemplateKey` crosswalk (NSP sends `documentType=nvTemplateKey`) | **16 P0 keys crosswalked** → coarse type; resolution source `nv_template_key`, non-inferred; also reads nested `filingContext.nvTemplateKey` | `nv-filing-book-crosswalk.ts`, `resolveDraftDocumentTypeWithMeta` |
| `parameters.filingContext` not parsed/echoed | **Parsed (advisory), `advisoryOnly` honoured**, `nvTemplateKey`/`filingBookRowId` echoed; transitional `mandatorySections`/`requiredAnnexures` demoted to advisory `expectedSections[]` | `nv-filing-context-hint.ts` |
| No filing-checklist registry | **`nv-filing-checklist-registry.ts`** — 16 P0 manifest entries + coarse fallbacks; `FILING_BOOK_MANIFEST_VERSION`; never invents rows | `nv-filing-checklist-registry.ts` |
| `draftProfile` / `validationResults[]` not emitted | **Emitted** on partner draft task types (sync + stream `run_completed`) via one deterministic assembler over `structureMarkers` + checklist + hints | `nv-draft-profile-assembler.ts`, `nv-orchestration-response-contract.ts`, `nv-orchestration-routes.ts` |

**What NSP can rely on now (post-deploy):** send `parameters.documentType = nvTemplateKey` (+ optional `parameters.filingContext`); consume outbound `draftProfile.{documentType, templateKey, filingBookRowId, filingBookVersion, manifestVersion, filingChecklist[], serviceModes?}` and `validationResults[]`, and continue consuming LIVE `draftQuality` / `structureMarkers`.
**Still deferred (honest):** `draftProfile.limitation` (procedural-limitation sub-table — P0 follow-on) and `draftProfile.courtFee` (per-suit/state table — P2) are **omitted, not faked** — they appear only once real data exists. Post-deploy smoke: **`partner:smoke:ec2` 0 failures** (2026-09-21).

---

## NSP fail-open intent (NYV-side) — NV-DRAFT-INTENT-PROMPT-001 (2026-09-21, local)

> **Status: LIVE on nysdev** (deploy **`2b9f4f6e`**, 2026-09-21). Verified: vitest + C3 probe + `partner:smoke:ec2` **0 failures**.

**Problem it closes:** FB-468 P0 emitted the full `draftProfile` / `validationResults[]` only on the Filing-Book wire (explicit `documentType`/`filingContext`). When NSP omits `documentType`, `filingContext`, and `filingBookRowId` and sends **only a prompt** (Describe-&-Generate, voice, one-line prayer), NYV now decodes intent and still applies the best Indian structure — never a broken/empty envelope.

### Behaviour when NSP params are omitted

1. **Decode intent from the prompt** — `inferDraftIntentFromPrompt()` (`src/config/nv-draft-intent-from-prompt.ts`) is the single heuristic SSoT (the coarse resolver `resolveDraftDocumentTypeWithMeta` delegates to it — no second rule list). It returns `{ docType, nvTemplateKey?, confidence, rationale[], source: 'prompt_heuristic' | 'default' }`.
2. **Fine-grained key where unambiguous** — a statutory/order-rule trigger (e.g. S.138 → `ni_138_statutory_notice`, s.148-A → `civil_caveat`, Order XLI Rule 22 → `civil_cross_objection`) yields an `nvTemplateKey`, so the **fine-grained enclosure checklist** applies even with zero NSP filing context.
3. **Fail-open, never empty** — no match → `general_legal_document` at low confidence (< 0.5) with the DEFAULT Indian counsel structure checklist. The resolver never throws.
4. **Default structure envelope** — even with no `filingContext`, the response still carries `draftProfile` + `validationResults[]` (structureMarkers + coarse/fine checklist), plus:
   - `draftProfile.intentResolution` — `{ docType, nvTemplateKey?, confidence, rationale[], source, wasInferred, partnerDocumentTypeRaw? }`.
   - `draftProfile.fallbackReason` — why NYV emitted a DEFAULT/inferred envelope (no filingContext, unrecognised type, or low-confidence coarse fallback). Absent on the clean, fully-specified path.

### Ownership split (A1 intent = NSP-owned; NYV is the backup)

- **NSP-owned (A1):** the primary intent classifier / Filing-Book selection in the NSP BFF. When NSP sends `parameters.documentType` (or `nvTemplateKey`) and/or `filingContext`, that **wins** (resolution `confidence: 1`, non-inferred) — NYV does not override it.
- **NYV backup:** the prompt resolver only runs when NSP sent **no usable explicit type**, or the explicit type is unrecognised. NSP can show `intentResolution.wasInferred` as a "NYV inferred this — confirm" affordance and correct it on the next turn.

### Logging (metadata only, NV-SECRETS-001 — no prompt body)

- **Durable DB row** (`sdk_usage_metering`, `period='request'`, `metadata.partnerAi`) via the usage-metering middleware: `taskType`, `resolvedDocType`, `intentSource`, `intentConfidence`, `wasInferred`, `nvTemplateKey?`, `filingBookRowId`, `partnerPlatformCode`, `mode` (`stream|sync`); relational `statusCode` / `latencyMs` already present. Helper: `buildPartnerAiRequestMeta()` in `nv-partner-platform.ts`.
- **Structured log line** `NV-PARTNER-AI-LOG-001 draft-outcome` (default on; `NYV_PARTNER_AI_LOG=0` to disable) emitted at the response seam with `requestId`, `taskType`, `resolvedDocType`, `templateKey`, `intentSource`/`intentConfidence`, `fallbackReason`, `filingBookRowId`, `filingChecklistCount`, a **structureMarkers summary**, and a PASS/WARN/FAIL `validation` rollup.

## Honesty

- Do **not** claim a dedicated Instant Search microservice URL.
- Caselaw **semantic** embed coverage is ops-backfill; FTS/hybrid are sellable today.
- Empty regulatory digest returns structured empty / `no_data` — not fake items.
- Templates = High Court / Sessions **practice-pattern** aids — not sealed HC certified forms.
- Gazette → matter notify is Phase C (not sold).
