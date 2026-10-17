# NSP / NYM / Ecosystem — Integration Playbook (2026-08)

> **Audience:** NSP, NYM, NSI, NSA, NSM, NSPM engineering leads integrating Nyayavigya.  
> **Live API:** `https://api.nyayasiddhi.online` · **SDK:** `@nyayavigya/client-sdk@5.0.10+`  
> **Canonical entry:** [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md)  
> **NSP API handoff (draft SLA, 2026-08-17):** [`NSP-API-HANDOFF-2026-08-17.md`](./NSP-API-HANDOFF-2026-08-17.md)  
> **Endpoint + timeout + tracking matrix for all AI tasks:** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)  
> **NSP API handoff (Patra/CNR/trust, 2026-08-12):** [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md)  
> **Updated:** 2026-08-17 — `legal-draft-fast` honoured; Queen CoT capture miss no longer 500s a completed answer.

This playbook gives **request / response shapes**, **use cases**, and **step-by-step** wiring for partner platforms.

---

## 0a. Patra Mitra — parse · fields · summary · document Q&A (NSP / NYM)

**Live:** `https://api.nyayasiddhi.online/api/nv/v1/sdk/patra-mitra`  
**Full contract:** [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md)  
**Typed SDK (5.0.10+):** `nyv.patraMitra.health|listSessions|createSession|getSession|chat|runTool`

Use for Word selection / short uploads (PDF, DOCX, images, scanned OCR). For large DMS ingest, use EDJ instead.

```ts
const open = await nyv.patraMitra.createSession({
  fileBase64: base64,
  filename: 'nda.pdf',
  mimeType: 'application/pdf',
  jurisdiction: 'IN',
});
const ask = await nyv.patraMitra.chat(sessionId, {
  message: 'Who are the parties and what is the term?',
  answerLanguage: 'en',
});
```

```http
POST /api/nv/v1/sdk/patra-mitra/sessions
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
Content-Type: application/json

{ "base64": "<file>", "fileName": "nda.pdf", "mimeType": "application/pdf", "jurisdiction": "IN" }
```

```http
POST /api/nv/v1/sdk/patra-mitra/sessions/<sessionId>/chat
{ "message": "Who are the parties and what is the term?" }
```

**NYM SDK:** `nym.openPatraMitra` / `nym.askPatraMitra` (`@nyayavigya/nyayamitra-sdk@5.1.2+`).

---

## 0b. Orchestrate trust envelope (NSP UI)

Every `nyv.orchestrate` / `POST /api/nv/orchestrate` outcome (live `2026-08-12T1734Z`) includes:

| Field | Use in NSP |
|---|---|
| `riskBadge` | `GREEN` / `YELLOW` / `RED` chip on Legal Chat |
| `auditHash` | Persist with matter turn for audit trail UX |
| `trust.grounded` / `citationsPresent` / `qualityOk` / `compliancePassed` | Secondary badges |

Queen topology remains sanitized for partners.

---

## 0. Auth (all platforms)

```http
POST /api/nv/... HTTP/1.1
Host: api.nyayasiddhi.online
X-API-Key: <NYV_SDK_KEY_NSP|NYM|NSI|…>
Content-Type: application/json
X-NYV-SDK-Version: 5.0.10
X-NYV-Platform: nsp
```

| Platform | Env var |
|---|---|
| NSP | `NYV_SDK_KEY_NSP` |
| NYM | `NYV_SDK_KEY_NYM` |
| NSI / NSA / NSM / NSPM | `NYV_SDK_KEY_*` |
| JRX | `NYV_SDK_KEY_JRX` (selective depth — not full ecosystem mandate) |

---

## 1. SME legal drafting rules (live)

| # | SME ask | Platform behaviour |
|---|---|---|
| 1 | High Court patterns | Drafts use HC / Sessions paper-book structure (cause title, MOST RESPECTFULLY SHOWETH, grounds, Prayer, Verification) |
| 2 | No sureties in bail application | Bail / anticipatory / default bail drafts **must not** schedule surety names/amounts; sureties only **after grant** |
| 3 | HC-style templates | Catalog templates are **High Court / Sessions practice-pattern** practitioner aids — **not** sealed HC certified forms (honest sell) |
| 4 | Mic → text | Console `/legal-drafting` + Doc Pipeline fields: Web Speech mic (`en-IN`) |
| 5 | District / court | Pass `highCourt`, `courtName`, `district`, `state`, `seat`, `policeStation` in draft `parameters` (or top-level body) |
| 6 | Humanized counsel voice | System prompts forbid chatbot filler; require practising-advocate register |

---

## 2. Use case A — Draft anticipatory bail (NSP / NYM)

### Request

```http
POST /api/nv/gateway/documents/draft
```

```json
{
  "template": "anticipatory_bail",
  "jurisdiction": "IN",
  "documentType": "bail",
  "depth": "detailed",
  "instruction": "Applicant apprehends arrest in FIR 123/2026 PS Cubbon Park under BNS 318. Roots in Bengaluru; no antecedents.",
  "parameters": {
    "highCourt": "High Court of Karnataka",
    "courtName": "Court of the Sessions Judge, Bengaluru Urban",
    "district": "Bengaluru Urban",
    "state": "Karnataka",
    "seat": "Bengaluru",
    "policeStation": "Cubbon Park",
    "firNumber": "123/2026"
  }
}
```

### SDK

```ts
await nyv.draftDocument('anticipatory_bail', {
  instruction: '…',
  highCourt: 'High Court of Karnataka',
  district: 'Bengaluru Urban',
  courtName: 'Sessions Judge, Bengaluru Urban',
  state: 'Karnataka',
}, 'IN');
```

### Expected response (shape)

```json
{
  "success": true,
  "data": {
    "content": "IN THE HIGH COURT OF KARNATAKA / COURT OF THE SESSIONS JUDGE…\nMOST RESPECTFULLY SHOWETH:\n…\nPRAYER: … on such terms and conditions as this Hon'ble Court may deem fit…\n…\nDisclaimer: AI-assisted draft following High Court / Sessions practice patterns…"
  }
}
```

**Assert:** body has cause title with named forum; Prayer has **no** surety schedule; advocate disclaimer present.

### Alternate — freeform Queen draft

```json
{
  "prompt": "Draft anticipatory bail under BNSS 482 for FIR 123/2026, Sessions Court Bengaluru Urban",
  "jurisdiction": "IN",
  "taskType": "document-drafting",
  "enableRAG": true,
  "enableCitationVerification": true
}
```

`POST /api/nv/orchestrate` — ecosystem platforms get Queen + drafting overlay automatically.

---

## 3. Use case B — Instant Search typeahead (NSP)

```ts
const hits = await nyv.instantSearch.search('BNS 103', {
  jurisdiction: 'IN',
  mode: 'fts',
  limit: 8,
});
```

| UX rule | Value |
|---|---|
| Debounce | 250–300 ms |
| Min chars | ≥ 2 |
| Mode for keystrokes | `fts` |
| Detail pane | `knowledge.searchCaselaw({ mode: 'hybrid' })` |

There is **no** `/api/nv/instant-search` microservice route.

---

## 4. Use case C — Live Legal Feed

```ts
const feed = await nyv.intelligence.getLegalFeed({ jurisdiction: 'IN' });
const reg = await nyv.intelligence.getRegulatoryFeed('IN', 50);
```

Empty digest → honest empty / `no_data` (not fabricated cards). Tavily off by default.

---

## 5. Use case D — BNSS court application template

```ts
const list = await nyv.templates.list({ jurisdiction: 'IN' });
const bail = list.data.templates.find((t) =>
  String(t.id).includes('bnss-anticipatory-bail') || String(t.slug).includes('anticipatory-bail')
);
const filled = await nyv.templates.generate(bail.id, {
  COURT_NAME: 'Sessions Judge, Bengaluru Urban',
  DISTRICT: 'Bengaluru Urban',
  FIR_NO: '123/2026',
});
```

Template IDs follow `nys-in-bnss-*` (25 essential applications + checklist).

---

## 6. Use case E — Statute FAQ (grounded)

```json
{
  "prompt": "What is BNS section 103?",
  "jurisdiction": "IN"
}
```

Short FAQs use grounded specialist (correct title — e.g. murder for §103) — not ungrounded Queen waffle.

---

## 7. Integration steps (checklist)

### NSP

1. Install `@nyayavigya/client-sdk@5.0.7`.
2. Set `NYV_SDK_KEY_NSP` on BFF only (never browser).
3. Wire Instant Search + Legal Feed UI to `instantSearch.*` / `intelligence.getLegalFeed*`.
4. Drafting: prefer `draftDocument` with `district` / `courtName` / `highCourt`; Word add-in should expose mic via Web Speech or native.
5. Do **not** send lean headers; quality gates are forced ON. Gateway injects **NV-LEGAL-INTEL-FORCE-001** counsel overlay on Queen / agents-run / research (anti-generic).
6. Smoke: `npm run partner:smoke:ec2` from NYV repo (ops).

### NYM

1. Keep `@nyayavigya/nyayamitra-sdk` for chat/voice.
2. For legal depth: call gateway with `NYV_SDK_KEY_NYM` (orchestrate / draft) — same best-outcome mandate.
3. Optional: Instant Search strip for statute lookup.

### NSI / NSA / NSM / NSPM

Same as NSP for orchestrate/draft/search — ecosystem best-outcome applies. Brand UX only differs.

### JRX

Selective depth — do not assume full Queen mandate unless configured.

---

## 8. Error handling

| Code | Meaning | Action |
|---|---|---|
| 401 | Missing/bad key | Fix `X-API-Key` |
| 403 `documents:write` | Scope | Request documents scope on key |
| 503 CorpusBusy | Knowledge busy | Retry; gateway already FTS-fallback |
| 400 missing template | Draft body | Send `template` or `prompt` |

---

## 9. Honesty (sell correctly)

- Templates = **practice-pattern practitioner aids**, not sealed High Court certified forms.  
- Caselaw semantic embed = ops backfill; FTS/hybrid are sellable.  
- MCP partner curated ~125 — not full 556 catalog.  
- Live agents **164**.
