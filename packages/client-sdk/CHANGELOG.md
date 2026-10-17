# Changelog — `@jurexio/client-sdk`

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](./SEMVER.md).

---

## [5.2.4] — 2026-10-15T10:20:00Z

### Added

- **`DocparseApi.nspAttachUnderstand()`** — partial-parse draft/chat context (`POST /api/jrx/v1/sdk/docparse/nsp/attach-understand`).

## [5.2.3] — 2026-10-15T07:05:00Z

### Added

- **`DocparseApi.nspEvidenceDepict()`** — NSP vision caption for case photos/imaging (`POST /api/jrx/v1/sdk/docparse/nsp/evidence-depict`).

## [5.2.2] — 2026-10-06T18:30:00Z

### Added

- **`DocparseApi`** on `JrxClient` — `docparse.listPacks()`, `docparse.submitJob()`, `docparse.getJob()` for `/api/jrx/v1/sdk/docparse/*`.
- **`DocsPipelineApi.analyze()`** — NSP alias to `/documents/analyze` (court fields + `docparseMeta`).
- **`DocsPipelineApi.extract()`** / **`pipeline()`** — binary ingest helpers on the same router.

## [5.2.1] — 2026-10-06T12:50:00Z

### Added

- **`JrxLegalDocparse`** types — `LegalParseGuideV1`, `DocparseIntelligenceV1`, `DocparseMetaPartner` for NSP binding to gateway `docparseMeta.*` from `@jurexio/docparse-sdk`.
- **`nspAutofillAction()`** — maps `autofillHint` → UI action (`bind` / `suggest` / `chooser` / `empty` / `withheld`).

## [5.2.0] — 2026-09-25T08:30:00Z

### Added

- **`CnrResolveFieldKey`** — gap-closure fields (`NV-CASE-CORPUS-FIELD-GAP-CLOSURE-001`): `linkedMatters` (Group 12), `incidentDate` (Group 11 — honest null until upstream publishes it), `caseTypeDisplay`, `courtCode`, `complexCode`.
- **`CnrLinkedMatter`** — `{ cnr, caseNumber, title, relation, court, source }` for linked/connected/clubbed matters (mapped from upstream `linked_cases` / `linked` / `connected_cases`).
- **`NspParseContractEntry`** + **`CnrResolveData.nspParseGuide`** — machine-readable resolve parse contract (per key: `path`, `type`, `cardinality`, `nestedSchema`, `availabilityTier`, `parseHint`, `absentWhen`). Attached when **`CnrResolveOptions.includeParseGuide: true`**. Static export: `documents/working/NSP-RESOLVE-PARSE-CONTRACT.json`.
- **`CnrResolveOptions.includeParseGuide`** — opt-in flag for the parse guide.

### Notes

- DC numeric `caseStatus`/`disposalNature` are now decoded when a value is text; a **bare numeric eCourts code** keeps its raw value and carries an honest "decode pending NJDG master" note (no fabricated labels).

---

## [5.1.9] — 2026-09-24T12:05:00Z

### Added

- **`CnrResolveFieldKey`** — HC/SC docket richness on resolve: `benchComposition`, `judicialSection`, `coram`, `registrationNumber`, `registrationYear`, `hcCategoryDetails`, `lowerCourtReference`, `finalOrders`, `interimOrders`, `iaFilings`, `registryObjections`, `caseCategory`, `interlocutoryApplications`, `registryDefects`, `earlierCourtDetails` (populated when nysapi row hydrates them).

---

## [5.1.8] — 2026-09-23T15:35:00Z

### Changed

- **`CnrSearchQuery`** — align with live nysapi search surface: `cnr`, `year`, `case_type`, `advocate_name`, `court_complex`, `court_establishment`, `police_station`, `fir_number`; legacy `decision_date_*` / `filing_date_*` documented as mapping to `year` on the gateway.

---

## [5.1.7] — 2026-09-22T07:30:00Z

### Added

- **`CnrFieldManifest.corpusUnavailable`** / **`manualRequired`** — beta honesty for slots absent from judgment corpus.
- **`CnrResolveMeta.betaReadiness`** — tier-3 vs manual capture expectations + EDJ job path hint.

---

## [5.1.6] — 2026-09-19T17:30:00Z

### Added

- **`fields.summary`** — corpus summary on default resolve profile (not only `caseCreate.summary`).
- **`fields.registrationDate`** — ISO date distinct from `filingDate` when nysapi publishes both.
- **`fields.partyDetails[]`** — `CnrPartyEntry[]` with address/phone/email/fatherName on the flat `fields` path (display resolve; AI paths still redact).
- **`documents[].expiresIn`** — **900** seconds on inline judgment presigned PDFs (matches timeline orders).

---

## [5.1.5] — 2026-09-19T15:00:00Z

### Added

- **`CnrApi.documentBundle()`** — typed wrapper for `GET /api/jrx/v1/sdk/cnr/{cnr}/document-bundle` (judgment + timeline orders + metadata in one response).
- **`CnrDocumentBundle`** / **`CnrDocumentBundleResponse`** — P3 on-demand viewer bundle types.

---

## [5.1.4] — 2026-09-19T14:15:00Z

### Added

- **`CnrApi.search()`** — typed wrapper for `GET /api/jrx/v1/sdk/cnr/search` with full nysapi filter surface (`party_name`, `filing_number`, `fir_no`, `act`, date bounds, pagination).
- **`CnrSearchQuery`** / **`CnrSearchResponse`** — matter-discovery types for HC/DC/SC search-then-resolve flows.
- **`CnrApi.resolve()` input** — documents `diaryNumber`, `filingNumber`/`filingYear`, and `identifier` on the POST body (runtime already supported).

---

## [5.1.3] — 2026-09-19T07:50:00Z

### Added

- **`CnrAdvocateEntry`** — structured advocate with optional `side: 'petitioner' | 'respondent' | null` on `fields.advocates[]`.
- **`CnrResolveMeta.provenance.tableVersion`** — nysapi RDS/DuckDB watermark from `/health`.

### Changed

- CNR resolve may return additional scalar fields (`citation`, `firNo`, `firYear`, `jurisdiction`, `stateName`, `districtName`, `bench`, `complexName`, `filingNumber`, `filingNumberYear`, `currentPurpose`, `firstHearingDate`) and array fields (`petitioners`, `respondents`) — additive; existing scalar `petitioner`/`respondent` retained.

---

## [5.1.2] — 2026-09-18T01:25:00Z

### Added

- **`CnrResolveOptions.courtType`** — explicit `sc|hc|dc` hint for B9 duplicate CNR disambiguation.
- **`CnrResolveOptions.includeTimeline`** — opt-in timeline fetch (P0-C).
- **`CnrResolveMeta`** — typed `meta.fieldAvailability`, `meta.counts`, `meta.provenance`, `meta.extra`.
- **`CnrTimelineEntry.docUrl`** — presigned PDF URL from nysapi timeline events.
- **`CnrResolveData.cnrSynthetic`** — SC synthetic CNR flag from nysapi.

---

## [5.1.1] — 2026-08-20T16:00:00Z

### Added

- **`CnrApi.resolve` — `options.profile: "caseCreate"`** returns structured
  `data.caseCreate` (header, timeline, clients, opposing parties, summary,
  `fieldManifest`) for NSP New Case autofill.
- **Types:** `CnrCaseCreateProfile`, `CnrTimelineEntry`, `CnrPartyEntry`,
  `CnrFieldManifest`, `CnrExtractPreview`.

---

## [5.1.0] — 2026-08-19T18:35:00Z

### Added

- **`caselawTreatment({ citation, exact?, direction? })` — the negative-treatment check
  (`GET /api/jrx/knowledge/caselaw/treatment`) is now callable from the SDK.** It had shipped on the
  gateway on 2026-08-18 with no SDK method, so a partner could not reach the one endpoint that
  answers "has this authority been overruled?".

  Deliberately documented as **not a citator**. `goodLaw` is `overruled | doubted | unknown` and
  **`good` is unreachable by construction**: absence of adverse language in a bounded retrieval is
  not evidence that an authority is good law. `unknown` is the expected answer for most authorities
  and must be rendered as unknown — a silent omission becomes "good law" in any UI. Every response
  carries `coverage`, and every row carries `extractedBy` so inferred treatment is never presented
  as verified.

  Pass `exact: true` when you hold a reporter citation: the looser party-name token path once
  matched "Kesavananda Bharati v. State of Kerala" onto an unrelated 2018 Kerala High Court matter,
  and a caller trusting `authority.title` would have shown the wrong case. When identification
  fails, `title`/`court`/`year` come back `null` and `treatments` is withheld rather than
  attributed to the wrong authority.

  Additive only — no existing signature changed, so this stays inside the 5.1.0 MINOR.

### Fixed

- **`getArchiveDocument()` now works. It could not previously return anything but `400`.** It sent
  `?archiveId=…` / `?id=…`, but NYS `/athena/document` validates a required **`s3Path`** with zod and
  ignores both parameters — so every call returned `400 "Invalid s3Path parameter."` regardless of
  input. There is no opaque archive id anywhere in the NYS archive; the owned-bucket `s3://bucket/key`
  path *is* the identifier.

  ```diff
  - nyv.knowledge.getArchiveDocument({ archiveId })       // always 400
  + nyv.knowledge.getArchiveDocument({ s3Path })          // 200 + presigned URL
  ```

  Obtain the `s3Path` from `searchArchive()` (Athena `s3_path`) or from a caselaw row's `s3Path`
  field. The endpoint resolves the High Court sibling-bucket fallback server-side before signing, so
  the returned URL will not 404 on a document that exists in the sibling bucket — do not presign
  yourself from the raw path.

- **`archiveDocumentStatus()` takes no arguments.** `/athena/status` accepts none: it reports whether
  the Athena archive tables are configured on the server (`{configured, database, table, hcTable,
  workgroup, maxScanBytes}`), not the state of one document. The old `{ archiveId?, id? }` signature
  implied a per-document capability that does not exist, and the parameters were silently discarded.

### Changed

- **`JrxClient.VERSION`** → **5.1.0**.

- **The 20 MB extraction ceiling documented in 5.0.11 is gone (JRX-side `JRX-ARCHIVE-LARGE-PDF-001`).**
  The cap is now **96 MB**, chosen to cover the entire Supreme Court PDF estate (176,997 objects, max
  68.79 MB), and the returned-text ceiling rose from 500,000 to **4,000,000** characters because
  Kesavananda Bharati alone yields 3,200,322. Both landmark judgments that previously produced
  `TOO_LARGE` now extract in full: **Kesavananda Bharati 2,878,447 chars / 8,427 ms**, **Maneka Gandhi
  529,765 chars / 998 ms** (measured against the live S3 objects).

  Two consequences for callers of `judgmentFullText()`:

  - **A cold extraction of a landmark judgment can take up to ~21 s.** Reporter-volume PDFs run to
    1,006 pages and cost is driven by page count, not bytes. The result is cached per judgment
    (subsequent calls ~13 ms), so budget for one slow first call, not a slow endpoint.
  - **A `503` is retryable, not a failure.** Large extractions are admitted two at a time on the
    caselaw worker; a saturated gate returns `503` with `Retry-After: 30` rather than hanging. Retry
    once after the interval.

  The NYS response also carries a new `truncated` boolean, set when a page, time, or character budget
  stopped extraction short of the whole PDF (the text then contains an explicit `[Note: …]` marker).
  Treat `truncated: true` as a partial judgment and do not present it as complete. **This flag is not
  yet surfaced through `judgmentFullText()`** — that requires a gateway-side change tracked separately.

  These are live-measured numbers against the changed NYS code, but **NYS is not yet deployed**: until
  it is, both landmark judgments still return `TOO_LARGE` in production.

## [5.0.11] — 2026-08-19T17:20:00Z

### Added
- **`KnowledgeApi.judgmentFullText()`** → `POST /api/jrx/knowledge/judgments/full-text`
  (`NV-JRX-FULLTEXT-001`). Fetches the **full judgment body** on demand in one call: resolves the
  case through the NYS Athena archive, then extracts the owned-bucket S3 PDF. Previously the SDK
  exposed the two hops separately (`documentSearch` → `extractArchive`) with nothing joining them, so
  a caller holding a case **name** rather than an `s3Path` had no route to the text.

  `{ s3Path? | query?, archive?: 'sc' | 'hc', year?, court?, title?, maxChars? }` — one of `s3Path`
  or `query` is required. Pass `s3Path` when known (no Athena scan at all). `archive` defaults to
  `'sc'`; **`'hc'` scans ~1.3 GB of Athena per query (~800× the SC cost)**, so request it
  deliberately. Verified live: SC 33,644 chars in 1,761 ms, HC 1,697 chars in 773 ms.

  Two caveats worth knowing before you call it: judgment bodies are large and are **never** included
  in search/RAG responses, so this is an explicit call only; and NYS caps extraction at 20 MB, which
  currently rejects some landmark Supreme Court judgments whose PDFs are whole reporter-volume
  extracts (Kesavananda 35.8 MB, Maneka Gandhi 60.9 MB → `TOO_LARGE`). **The cap was raised to 96 MB
  in 5.1.0; both now extract in full.**

### Known issues
- **`getArchiveDocument()` and `archiveDocumentStatus()` are non-functional.** Both send
  `archiveId` / `id`, but NYS `/athena/document` requires **`s3Path`** and `/athena/status` takes no
  parameters, so `getArchiveDocument()` can only return `400`. Use `judgmentFullText()` for text, or
  `documentSearch()` to obtain an `s3Path` first. **Fixed in 5.1.0.**

### Changed
- **`JrxClient.VERSION`** → **5.0.11**.

## [5.0.10] — 2026-08-12T18:00:00Z

### Added
- **`PatraMitraApi` on `nyv.patraMitra`** — `health` / `listSessions` / `createSession` / `getSession` / `chat` / `runTool` → `/api/jrx/v1/sdk/patra-mitra/*`.

### Changed
- **`JrxClient.VERSION`** → **5.0.10**.

## [5.0.9] — 2026-08-09T17:30:00Z

### Added
- **`CnrApi` on `nyv.cnr`** — `resolve` / `get` / `listDocuments` / `enrich` / `health` → `/api/jrx/v1/sdk/cnr/*`.
- Corpus-only CNR autofill for NSP (judgment / Open Data). Always `claimEcourts: false`.

### Changed
- **`JrxClient.VERSION`** → **5.0.9**.

## [5.0.8] — 2026-08-06T10:00:00Z

### Added
- **`LegalWorkApi.evaluate` / `chat`** — sync evaluate + chat aliases for Wave-C NSP.
- **`NyayaToolsApi.listNyayaWatchRules` / `createNyayaWatchRule` / `deleteNyayaWatchRule`**.
- **`ComplianceApi.getEvidencePack` / `createEvidencePack`**.
- **`MatterVaultApi.listPacks` / `createPack` / `getPack` / `attachPackDocuments`**.

### Changed
- Agent registry constitutions stamp **SDK v5.0.8**; preferredModels lean Bedrock + Gemini 2.5 for partner best-outcome (gateway routing: free-last quality cascade).

### Fixed
- Partner surfaces for NyayaWatch / Legal Work / Matter Vault / evidence-pack no longer require ad-hoc raw HTTP.

## [5.0.7] — 2026-08-02T16:00:00Z

### Added
- **`InstantSearchApi`** on `nyv.instantSearch` — `statutes`, `caselaw` (mode fts|hybrid), `acts`, `search` (parallel), `retrieve`.
- **`IntelligenceApi` Legal Feed** — `getLegalFeed`, `getLegalFeedHistory`, `generateLegalFeed` → `/api/jrx/v1/sdk/legal-intelligence/feed*`.
- **`KnowledgeApi.compareOldToNew` / `compareNewToOld`** helpers; caselaw `mode` query param.

### Changed
- **`JrxClient.VERSION`** → **5.0.7**.

---

## [5.0.6] — 2026-07-30T18:30:00Z

### Added
- **Queen provisional → gated replace contract** on `JrxTextDeltaEvent` (`provisional`, `gated`) and `onTextDelta` optional `meta`.
- `JrxStreamReader` resets accumulated text on first gated/post-provisional delta (no double-paint).
- README section documenting the SSE contract + `JRX_QUEEN_SUPPRESS_PROVISIONAL`.

### Changed
- **`JrxClient.VERSION`** → **5.0.6**.

---

## [5.0.5] — 2026-07-29T07:55:00Z

### Added
- **`TemplatesApi` SME review pipeline** — `approved()`, `reviewStats()`, `reviewQueue()`, `listReviews()`, `bootstrapReviews()`, `submitReview(id, { status, rubric })`.
- Template items may include `approval_status` / `partner_approved` (`platform_curated` | `sme_approved` | …).
- Partner catalog defaults to approved-only (`approvedOnly=true`).

### Changed
- **`JrxClient.VERSION`** → **5.0.5**.

---

## [5.0.4] — 2026-07-29

### Added
- **`KnowledgeApi`** — caselaw/statutes embedding coverage, Athena archive status/document/extract, SSO launch.
- Partner templates catalog is India-only comprehensive (medium+); see gateway `GET /api/jrx/templates`.

### Changed
- **`JrxClient.VERSION`** → **5.0.4**.

---

## [5.0.3] — 2026-07-29

### Added
- **`TemplatesApi`** (`nyv.templates`) — canonical NSP catalog:
  - `list()` → `GET /api/jrx/templates`
  - `catalog()` → `GET /api/jrx/templates/catalog`
  - `listViaGateway()` → `GET /api/jrx/gateway/templates`
  - `get(id)`, `generate(id, variables)`
- Response shape matches NSP MVP: `{ data: { templates: [{ id, name, content, ... }] } }`.

### Changed
- **`JrxClient.VERSION`** → **5.0.3**.

---

## [5.0.0] — Production line (locked until production cutover)

> **Policy (2026-07-14):** Package semver and `JrxClient.VERSION` remain **5.0.0** until
> explicit production cutover. Feature work below ships **inside** 5.0.0 (additive).
> *(Superseded for templates surface by 5.0.3 above.)*

### Added (folded into 5.0.0 — was staged as 5.1.x)
- **`MatterVaultApi`** (`nyv.matterVault`) — `health`, `listMatters`, `createMatter`, `getMatter`, `uploadBatch`, `runPlaybook` → `/api/jrx/matter-vault/*`. Supports `defaultDepth` / per-doc `depth`: `concise` \| `detailed` \| `comprehensive`.
- **`GatewayApi.draftDocument`** — accepts optional `depth` + `documentType` on `GatewayDraftRequest`.
- **`KnowledgeApi`** — NYS Knowledge Plane: `retrieve`, `searchCaselaw`, `searchStatutes`, `listStatuteActs`, `compareCodes`, `verifyCitation`, `extractCitations`, `searchArchive` (`query`→NYS `q`), `listTemplates`, `getTemplate`, `planeHealth`.
- **`LegalWorkApi`** (`nyv.legalWork`) — tasks, async runs, evaluate, legal chat.
- **`SwarmApi`** / **`LegalSdkApi`** — topologies + partner case analysis.
- Gateway / EDJ / NSP shared-doc extensions (prior 5.1.0 gap closure).

### Changed
- **`JrxClient.VERSION`** locked to **5.0.0** for ecosystem pack + partner docs alignment.

---

## Historical notes (superseded version labels — do not republish)

The following section headers document work that was briefly labeled 5.1.x / 5.2.x
in-repo and is now carried as **5.0.0** surface. Kept for audit trail only.

## [5.1.2] — 2026-07-13 — Athena archive body alignment (→ folded into 5.0.0)

### Changed
- **`KnowledgeApi.searchArchive`** — accepts SDK-friendly `{ query, archive: 'all'|'sc'|'hc' }`, normalizes to NYS OpenAPI `{ q, archive?: 'sc'|'hc' }` before POST.

## [5.1.1] — 2026-07-13 — NYS Knowledge Plane SDK surface

### Added
- **`KnowledgeApi`** extensions — `retrieve`, `searchCaselaw`, `searchStatutes`, `listStatuteActs`, `compareCodes`, `verifyCitation`, `extractCitations`, `searchArchive`, `listTemplates`, `getTemplate`, `planeHealth` → `/api/jrx/knowledge/*`.
- **`LegalWorkApi`** (`nyv.legalWork`) — tasks, async runs, evaluate, legal chat → `/api/jrx/legal-work/*`.

### Changed
- **`JrxClient.VERSION`** and package semver → **5.1.1**.

## [5.1.0] — 2026-07-09 — NSP partner SDK gap closure

Additive release closing P0/P1 gaps vs `jrx-sdk-production-config.ts` and NSP execution docs.

### Added
- **`SwarmApi`** (`nyv.swarm`) — `listTopologies()`, `getTopology()`, `getStats()`.
- **`LegalSdkApi`** (`nyv.legalSdk`) — `caseAnalysis()` → `POST /api/jrx/sdk/legal/case-analysis`.
- **`GatewayApi`** extensions — `translateDetect`, `translateBatch`, `transliterate`, `ocrProcess`, `classifyClauses`, `getUsageTokens`.
- **`EcosystemDocumentsApi.processNspSharedDoc()`** — `POST /api/jrx/shared-docs/process` with `X-NSP-Client`.
- **`EcosystemDocumentsApi.getNspSharedDocStatus()`** — poll shared-doc EDJ jobs.
- **`JrxClientConfig.interServiceSecret`** → `X-NSP-Inter-Secret` header.
- **Flat facade:** `caseAnalysis()`, `processNspSharedDoc()`.
- **Tooling:** `npm run sdk:smoke:nsp` — typed SDK smoke for NSP P0 paths.
- **Tests:** `tests/unit/nsp-apis.test.ts` — mock HTTP coverage for all NSP API modules.

### Changed
- **`JrxClient.VERSION`** and package semver aligned to **5.1.0**.
- Integration guide §5 matrix — all P0 rows show typed SDK methods (no raw HTTP).

## [5.0.0] — 2026-07-05 — Production GA + NSP partner SDK surface

Production-aligned semver for partner GA (canonical line stays **5.0.0**). Includes EDJ, CoT, MCP connector, ecosystem document APIs, and NSP partner surface.

### Added
- **`OrchestrateApi`** (`nyv.orchestrateApi` / `nyv.queen`) — typed `POST /api/jrx/orchestrate` with 600s default timeout.
- **`GatewayApi`** — research, draft, translate, practice-areas, usage, **`verifyCitations`**, **`checkHallucination`** (`/api/jrx/gateway/*`).
- **`PartnerIntelligenceApi`** — E1–E10 + D7 (`/api/jrx/v1/sdk/intelligence/*`).
- **`DocsPipelineApi`** — parse, summarize, clauses, compliance-check (`/api/jrx/sdk/docs-pipeline/*`).
- **`LlmRouterApi`** — catalog, providers, router health/explain.
- **`CamApi`** — partner CAM dashboard.
- **NSP flat facade** on `JrxClient`: `orchestrate`, `callAgent`, `legalResearch`, `mentorChat`, `draftDocument`, `verifyCitations`, `checkHallucination`, `findPrecedents`, `evaluateWithJudge`, `getUsage`, etc.
- **`NvSdkClient` export alias** for legacy `jrx-sdk-client` import compatibility.
- **`patterns.rolePlay()`**, **`documents.uploadBuffer()`** aliases.
- **`getFields(jobId)`** — fieldManifest extraction only.
- **`getContent` / `getContentText` / `processAndGetContent`** — raw parsed text + fields after EDJ.
- **`EcosystemDocumentsApi`** — full durable document job lifecycle.
- **`CotApi`**, **`ConnectorsApi`** — chain-of-thought and MCP connector SDK surfaces.

### Changed
- Auth header: canonical **`X-API-Key`** (Bearer retained as fallback).
- **`platformClient`** config → sets `X-NSP-Client` header.
- **`JrxClient.VERSION`** aligned to package semver **5.0.0**.

## [5.2.3] — 2026-07-03 — Raw Document Content API

### Added
- **`getContent(jobId)`** — fetch the full raw parsed document text after EDJ completes (OCR/parsed output).
- **`getContentText(jobId)`** — convenience method returning raw text string directly.
- **`processAndGetContent(req, opts)`** — submit + wait + fetch intelligence result AND raw content in one call.
- `GET /api/jrx/v1/sdk/ecosystem-documents/jobs/:jobId/content` — new endpoint; supports `?format=text` for plain text response.
- `EdjRawContent` interface in result envelope: `preview` (first 2000 chars), `charCount`, `wordCount`, `pageCount`, `contentUrl`.
- Raw text persisted to object storage during processing for reliable retrieval regardless of result size.

## [5.2.2] — 2026-07-03 — Ecosystem Document Jobs (EDJ)

### Added
- **`EcosystemDocumentsApi`** (`nyv.ecosystemDocuments`): durable large/shared document jobs — `createJob()`, `getJob()`, `getResult()`, `waitForJob()`, `processAndWait()`, legacy `processSharedDoc()` shim.
- Canonical API: `POST/GET /api/jrx/v1/sdk/ecosystem-documents/jobs` with `fieldManifest`, `outputProfile`, `storageRef`, poll + webhook delivery.

## [5.2.1] — 2026-07-03 — MCP connectors + CoT SDK

### Added
- **`CotApi`** (`nyv.cot`): `listStrategies()`, `execute({ prompt, strategy?, context? })` → `POST /api/jrx/v1/sdk/sampling/chain-of-thought`.
- **`ConnectorsApi`** (`nyv.connectors`): `list()`, `get()`, `connect()`, `disconnect()`, `health()`, `invoke()` → `/api/jrx/mcp/connectors/*`.
- Orchestrate consumers may pass `enableCoT` / `cotStrategy` in request body; response includes `chainOfThought` in orchestration envelope when enabled.

## [5.2.0] — 2026-06-30 — Session 26–32 endpoint coverage

### Added
- **`DocumentsApi`**: `redline(a, b, opts)`, `merge(docs, opts)`, `highlight(text, opts)`
  wrapping the real `POST /api/jrx/documents/{redline,merge,highlight}`
  (NV-DOCPIPE-MRH-001) with typed `RedlineResult` / `MergeResult` / `HighlightResult`.
- **`AgentsApi`**: `execute(req)` and `orchestrate(req)` for the real Queen-backed
  `POST /api/jrx/agents/{execute,orchestrate}` (NV-AGENT-EXEC-REAL-001), returning
  actual synthesized output + real token/cost metrics.
- **`RagApi`** (`nyv.rag`): `query()` (unified tier-aware Auto-RAG, `raw` escape
  hatch) + `autoRetrieve()` (NV-AUTO-RAG-001).
- **`ModelsApi`** (`nyv.models`): `getProviders()` per-provider readiness matrix
  (NV-PROVIDER-READINESS-001; env-key **names** only, never values) + `getStats()`.
- **`McpApi`** (`nyv.mcp`): `listTools()`, `invoke()`, `execute()` for the canonical
  MCP SSoT executor (NV-MCP-SSOT-EXEC-001; `developer`+ role required).
- **`UsageApi`** (`nyv.usage`): `getSummary()` + `getTokens()` token/cost ledger.

### Changed
- `JrxClient` now exposes 25 API classes (was 21). `JrxClient.VERSION` → `5.2.0`;
  `JrxClientConfig.version` widened to `string` and defaults to `JrxClient.VERSION`.
- README refreshed: removed stale **v6 / 6.0.0 / 1,043-agents** claims → **5.2.0 /
  164 agents**, added the four new API-class rows + quickstart snippets.
- Rebuilt `dist/` (the committed `JrxClient.d.ts` was still reporting `6.0.0`).

### Notes
- Purely additive surface — consumers on `^5.1.0` remain compatible.

## [5.1.1] — 2026-06-03 — Version-string reconciliation

### Fixed
- Unified the SDK's self-reported version. `package.json` was `5.1.0` but
  `JrxClient.VERSION` still reported `6.0.0`, the package `description` said
  `v6.1.0`, and the `index.ts` banner said `3.1.2` — all stale leftovers from
  the short-lived 6.x line that was rolled back to the 5.1.x registry-aligned
  line on 2026-05-28. All four now read `5.1.1` (next patch in the live 5.1.x
  line), so the `X-JRX-SDK-Version` request header, runtime banner, and package
  metadata agree. No API surface change; consumers on `^5.1.0` remain compatible.

---

## [5.1.0] — 2026-05-28 — Registry alignment patch

### Changed
- Bumped package version to `5.1.0` to align semver with the gateway v5.1.0
  runtime registry (164 active agents; archived v5.0.0 flat backup 1042 is
  forensic-only via `NV_REGISTRY_FORENSIC_MODE`).
- No breaking API surface changes; consumers on `^5.0.0` remain compatible.

---

## [6.1.0] — 2026-05-13 — Additive minor (typed `/api/nv5/*` wrappers)

### Added
- Seven new typed API classes wrapping the additive `/api/nv5/*` admin
  surface (Sessions 10–12 Batches A–J), so consumers no longer need to
  hand-roll `nyv.http.get/post` calls:
  - `OrchApi` (`nyv.orch.{kb,context,multimodalRag,plugins,roma,agentSelect,protocols}`)
    — Batch A `/api/nv5/orch/*`
  - `WorkflowsApi` (`nyv.workflows.{start,get,cancel,autonomous,continuous}`)
    — Batch C `/api/nv5/workflows/*`
  - `DocAiApi` (`nyv.docAi.{health,supported,submitJob,getJob,getResult}`)
    — Batch C `/api/nv5/doc-ai/*`
  - `GovApi` (`nyv.gov.{makerChecker,securityMonitor,costOptimizer,concurrency,orgRateLimit}`)
    — Batch D `/api/nv5/gov/*`
  - `LegalPipelineApi` (`nyv.legalPipeline.{chunker,embedding,reranker,summarizer,readability}`)
    — Batch E `/api/nv5/legal-pipeline/*`
  - `ComplianceNv5Api` (`nyv.complianceNv5.{euAiAct,pqc,federatedPrivacy}`)
    — Batch F `/api/nv5/compliance/*` (the pre-existing `nyv.compliance` for
    the canonical DPDP/GDPR `/api/jrx/compliance/*` surface is unchanged)
  - `InternalApi` (`nyv.internal.{capabilities,modelCascade,slmRouter,…}`)
    — Batches G+H+I+J `/api/nv5/internal/*` (17 introspection endpoints)
- README "API surface" table grew from 14 → 21 classes; `/api/nv5/*`
  reachability note added explaining the per-batch `JRX_F_*` flag gate
  (every namespace defaults OFF → 404 until enabled gateway-side).

### Changed
- Bumped `package.json` `version` from `5.0.0` (stale) to `6.1.0`. The
  `JrxClient.VERSION` constant remains `6.0.0` for the on-wire SDK header
  until the next major.
- README "Additive `/api/nv5/*` admin surface" section no longer claims
  consumers must call `nyv.http` directly — typed wrappers are the
  documented path now.

### Notes
- **Naming reconciliation (`nyv.complianceNv5` vs `nyv.compliance`)**: the
  task brief asked for `nyv.compliance.*` for the new `/api/nv5/compliance/*`
  surface, but `nyv.compliance` is already the documented canonical path
  to the existing `ComplianceApi` (`/api/jrx/compliance/*` — DPDP/GDPR
  consent, audit, retention). Reusing it would have been a silent
  breaking change for current consumers, violating "additive only / no
  major bumps before prod". We chose `nyv.complianceNv5` to keep both
  surfaces typed and side-by-side; a future major (`7.0.0`) may unify
  them under a single namespace with sub-paths.
- **Server-contract types** (post-review fix, 2026-05-13): every wrapper
  whose request/response shape was out of step with the live gateway has
  been re-aligned against its route handler:
  - `DocAiApi.submitJob()` posts the required `sourceFormat`/`targetFormat`
    form fields; added `submitJobBase64()` for the JSON path. `supported()`
    returns `{ success, supported }`, `getJob()` returns `{ success, job }`,
    and `getResult()` is now a binary download via the new
    `JrxHttpClient.getBytes()` helper.
  - `WorkflowsApi` root surface returns
    `{ success, started: { autonomous?, continuous? } }`,
    `{ success, task }`, and `{ success, taskId, cancelled, ... }` per
    `src/routes/nv5/workflows/index.ts`. Engine-specific lifecycle
    (start/stop, submitTask, agents, etc.) lives under
    `nyv.workflows.{autonomous,continuous}`.
  - `GovApi.makerChecker.getReview()` returns `{ success, review }`
    (full pending-review record), and `GovApi.orgRateLimit.invalidateCache()`
    returns `{ success, orgId, cacheInvalidated }` (server's actual field
    name, was incorrectly typed as `invalidated`).
  - `InternalApi.capabilities()` returns
    `{ success, namespace: 'nv5-internal', services: [{ id, category,
    hasHttp, hasLlm, note? }] }` (was incorrectly typed with
    `service/llmEmits/httpEmits`). `InternalApi.esign.session()` returns
    `{ success, session }`.
  - `LegalPipelineApi.chunker.preview()` returns
    `{ success, mimeType, docType, chunkCount, chunks (first 20),
    truncated }` — was incorrectly typed with `totalChunks`.
  - `ComplianceNv5Api.federatedPrivacy.dpNoise()` request shape changed
    from `{ values, epsilon, sensitivity? }` (vector) to
    `{ queryResult, sensitivity, epsilon }` (single numeric query result),
    and the response is `{ success, original, sensitivity, epsilon, noised }`
    — matching `nvFederatedPrivacyService.addDifferentialPrivacyNoise`.
    `getSession()` and `listSessions()` now return their `{ success, session }`
    / `{ success, sessions }` envelopes.
  - `ComplianceNv5Api` Batch F (EU AI Act + PQC) re-aligned against
    `src/routes/nv5/compliance/{eu-ai-act,pqc}-routes.ts`:
    - `eu-ai-act/capabilities` returns `{ success, service: 'jrx-eu-ai-act',
      articles, documents }` (string lists, not generator records).
    - `eu-ai-act/report` returns `{ success, report }` — full report payload
      is wrapped, not spread at the top level.
    - `eu-ai-act/agent/:id/risk-management` returns `{ success, document }`
      (was incorrectly typed as `{ article, agentId, document }`).
    - `eu-ai-act/agent/:id/bias-audit` returns `{ success, report }`
      (intentional server naming — different field name from
      risk-management; this is preserved in the typed contract).
    - `pqc/capabilities` returns `{ success, service: 'jrx-pqc',
      primitives, operations, note? }`.
    - `pqc/ready` returns just `{ success, ready }` — it's a liveness
      probe; the previously-typed `mode` field does not exist server-side.
    - `pqc/{kem,dsa}-keygen` returns `{ success, publicKeyB64,
      secretKeyB64, publicKeyBytes, secretKeyBytes }` (was incorrectly
      typed with `{ algorithm, publicKey, secretKeyHandle, generatedAt }`).
      The methods no longer accept an `algorithm` argument because the
      server ignores the request body; algorithm choice is service-config.
  - `OrchApi` Batch A re-aligned against `src/routes/nv5-orch-{kb,agent-select,roma}.ts`:
    - `kb.create()` request now correctly requires `{ name, ownerId, ... }`
      (server returns `400 "name and ownerId required"` otherwise) and the
      response type is `{ success, knowledgeBase }` (raw payload from
      `KnowledgeBaseSystem.createKnowledgeBase()`), not the previously-typed
      `{ kbId, createdAt }`.
    - `agentSelect.load()` request changed from `{ jurisdiction, agentIds }`
      to `{ agents: AgentDescriptor[] }` (mirrors
      `services/bm25-agent-selector.ts`); response is
      `{ success, loaded }`. `agentSelect.select()` response is
      `{ success, selected, count }`, not `{ agents, totalScored }`.
    - `roma.trackOutcome()` request requires `{ agentId, outcome }`
      (NOT `patternId`); response is just `{ success }`.
    - `roma.auditTrail()` returns `{ success, auditTrail, count }`.
    - `roma.performanceStore()` returns `{ success, performanceStore }`.
    - Removed unused `multimodalRag.createKb()` and `plugins.{statusReport,
      auditLog,globalStats}()` typed methods — the server-side routes for
      those don't exist in the current Batch A surface (only `/health`
      lives there). Will be re-added in a future minor when the routes
      actually mount, so the SDK doesn't lie about reachability.
  - **`JrxHttpClient` error-message fallback**: NV-5 routes use
    `safeError()` which emits `{ success: false, error: msg }`, not the
    `{ message }` shape the canonical NV-1 envelope used. The client now
    falls back from `errBody.message` to `errBody.error` so `JrxError.message`
    surfaces the real failure (e.g. `relation "knowledge_bases" does not
    exist`) instead of just `HTTP 500 Internal Server Error`. Applies to
    both `request()` and `getBytes()`.
  - Smoke runner classifies `5xx` failures whose message matches a
    "relation/column/table … does not exist" pattern as `REACHED_DB_GAP`
    rather than `FAIL` — the SDK contract is provably correct (the route
    handler entered and accepted the body) but the dev DB is missing the
    `knowledge_bases` table. This is a pre-existing migration gap unrelated
    to the SDK and tracked separately.
  - Smoke test (`scripts/smoke-nv5-typed.mjs`) extended with one MUTATING
    POST per typed namespace so request-body / response-envelope drift
    surfaces here, not in production. Live result against dev gateway:
    **6 OK + 7 FLAG_OFF_404 + 1 REACHED_DB_GAP, 0 FAIL across 14 probes**.
    `docAi.submitJobBase64` end-to-end-confirms the new envelope shape
    (`{ success, jobId, status, bytesIn, mode, ledger }`);
    `orch.kb.create` reaches the route handler with the new
    `{ name, ownerId }` payload but surfaces `REACHED_DB_GAP` because
    the dev DB is missing the `knowledge_bases` table (pre-existing
    migration gap, not an SDK contract issue).
- All seven new classes share the existing `JrxHttpClient` instance, so
  the canonical `X-API-Key` header (NV-AUTH-HEADER-001), 30 s timeout,
  and `JrxError` envelope unwrap behaviour are identical to the v6
  surface. Bearer-as-JWT on `/api/nv5/gov/*` is rejected gateway-side
  with `401 BEARER_NOT_SDK_KEY` — surface this to users via `JrxError.code`.
- Multimodal + voice are intentionally NOT re-wrapped — the canonical
  `nyv.voice` and existing multimodal helpers already cover the heavy
  paths the `/api/nv5/multimodal/*` + `/api/nv5/voice/*` routers
  delegate to.

---

## [6.0.0] — 2026-04-25 — GA

The first **General Availability** release of the v6 SDK line.

### Added
- New companion package `@jurexio/client-sdk-react-native` for first-class
  React Native + Expo support (native fetch + AbortController, EncryptedStorage
  adapter, `react-native-sse` polyfill, camera/mic permission helpers, push-
  notification HITL handler).
- New companion package `@jurexio/jurexio-citizen-sdk` exposing the citizen
  Jurexio Citizen agent surface (`mitra-conversational`, `clause-classifier`,
  `case-brief-generator`) plus 9-language Indic helpers and offline draft
  serialization.
- Webhook delivery on `orchestration.completed` is now wired end-to-end and
  HMAC-signed (header `X-JRX-Signature: sha256=…` over `${ts}.${body}`).
- `CONTRIBUTING.md`, `SEMVER.md`, and this `CHANGELOG.md`.
- `examples/nsp-web-quickstart` (Next.js 14), `examples/nsp-mobile` (Expo),
  `examples/jurexio-citizen-mobile` (Expo) — copy-paste-ready quickstarts.

### Changed
- Bumped `JrxClient.VERSION` from `5.0.0` to `6.0.0`.
- README updated to v6 GA quickstart.
- The streaming helper exposed by `nyv.stream.streamPattern(...)` is now the
  documented, supported entry point for all 22 patterns. The legacy
  `JrxStreamReader` constructor still works but is no longer the recommended
  call site.

### Deprecated
- v5 alpha exports (`@jurexio/client-sdk@5.0.0-alpha.*`) — see
  [`docs/v3.1.2/superseded/JRX-SDK-v5-DEPRECATION-POLICY.md`](../../docs/v3.1.2/superseded/JRX-SDK-v5-DEPRECATION-POLICY.md).
  The v5 line continues to receive **security patches only** until 2026-10-25
  (6 months) and will then be unpublished from npm `latest`.

### Removed
- Nothing — v5 → v6 is additive, not subtractive.

### Fixed
- Tree-shakeability for ESM consumers — `package.json#exports` now points to
  `.mjs` for `import`, `.js` for `require`, and `.d.ts` for `types` for every
  subpath.

### Security
- Webhook payloads are signed with HMAC-SHA-256 over `${timestamp}.${body}`
  with a per-app secret. Receivers must verify both the signature and that the
  timestamp is within ±5 minutes to defend against replay.

---

## [3.1.2] — 2026-03-12

Internal Release Candidate aligned with Platform 312. Not GA. No public npm tag.

---

## [Unreleased]

(no entries yet)

### Verification (2026-04-25)
- `tsc --noEmit` against `packages/client-sdk-react-native` and
  `packages/jurexio-citizen-sdk` (which both depend on this package's published
  `dist/` types) — **PASS** (0 errors).
- `npm pack --dry-run` for both companion packages — **PASS**.
- Webhook delivery on `orchestration.completed` is wired in
  `src/index.ts` via `startSdkWebhookListener()` and fanned out from
  `src/middleware/jrx-sdk-gateway.ts`.
