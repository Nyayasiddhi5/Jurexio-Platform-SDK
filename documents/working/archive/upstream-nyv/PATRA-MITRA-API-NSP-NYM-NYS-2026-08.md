# Patra Mitra — Partner API (NSP / NYM / NYS)

> **Status:** Live — NYV `2026-08-12T1734Z-aws-ssm` · NYS nyayasearch `/patra-mitra` workbench  
> **Product name:** **Patra Mitra** (Document Companion) — *Parse · Understand · Ask*  
> **Base URL:** `https://api.nyayasiddhi.online`  
> **NYS UI:** `https://nyayasearch.nyayasiddhi.online/patra-mitra` (session auth) · BFF `/api/patra-mitra/*`  
> **Auth:** `X-API-Key: <NYV_SDK_KEY_NSP|NYM|…>` (or `Authorization: Bearer`)  
> **Platform header:** `X-NYV-Platform: nsp` \| `nym` \| `nys`  
> **Mount:** `/api/nv/v1/sdk/patra-mitra`  
> **Typed SDK:** `@nyayavigya/client-sdk@5.0.10` → `nyv.patraMitra.*`  
> **NSP handoff:** [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md)

Use this for **interactive** document work (Word selection, Legal Chat attach, Mitra upload, NYS Patra Mitra page).  
For **large / DMS / durable batch** jobs prefer EDJ (`/api/nv/v1/sdk/ecosystem-documents`) — see §4.8 of the platform integration guide.

---

## 1. Capabilities

| Capability | How |
|---|---|
| Parse PDF / DOCX / TXT / MD | Text layer extract |
| OCR images (PNG/JPEG/WebP/TIFF/GIF) | Multi-provider OCR cascade |
| Scanned / image-only PDFs | Vision OCR when text layer is thin/empty |
| Structured fields | Parties, dates, amounts, sections, document type, … |
| Summary + key points | Counsel-grade markdown (regenerable; multilingual) |
| Ask the document (Q&A) | Grounded only on uploaded text (session); `answerLanguage` |
| Session history | `GET …/sessions` (+ NYS localStorage workbench history) |
| Parse tools | `POST …/sessions/:id/tools` — parties, dates, amounts, citations/CNR, clauses, PII scan, language, export |
| Multilingual | Auto script detection (EN + Indic); answer/summary language selector on NYS UI |

---

## 2. Endpoints

### 2.1 Health

```http
GET /api/nv/v1/sdk/patra-mitra/health
```

```json
{
  "success": true,
  "data": {
    "product": "Patra Mitra",
    "code": "patra-mitra",
    "tagline": "Parse · Understand · Ask",
    "status": "ready",
    "capabilities": ["parse", "ocr", "fields", "summary", "document_chat"],
    "formats": ["pdf", "docx", "txt", "md", "png", "jpg", "jpeg", "webp", "tiff", "gif"]
  }
}
```

### 2.2 Open session (parse + fields + summary)

```http
POST /api/nv/v1/sdk/patra-mitra/sessions
Content-Type: application/json
X-API-Key: …
X-NYV-Platform: nsp
```

```json
{
  "base64": "<binary document or image, base64>",
  "fileName": "nda.pdf",
  "mimeType": "application/pdf",
  "jurisdiction": "IN",
  "includeFullText": false
}
```

Alternate for plain text / Word selection:

```json
{
  "content": "…pasted clause text…",
  "fileName": "selection.txt",
  "mimeType": "text/plain",
  "jurisdiction": "IN"
}
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "sessionId": "pm_…",
    "fileName": "nda.pdf",
    "documentType": "NDA",
    "extractionMethod": "text|ocr|pdf-parse|docx",
    "warnings": [],
    "characterCount": 12000,
    "wordCount": 1800,
    "textPreview": "…",
    "fields": [
      { "key": "party_a", "label": "Disclosing Party", "value": "…", "confidence": 0.9 }
    ],
    "summary": "## Summary\n…",
    "keyPoints": ["…"],
    "chat": [],
    "product": {
      "name": "Patra Mitra",
      "tagline": "Parse · Understand · Ask",
      "code": "patra-mitra"
    }
  }
}
```

### 2.2a List sessions (history)

```http
GET /api/nv/v1/sdk/patra-mitra/sessions
```

Returns recent in-process sessions (TTL ~2h). NYS UI also mirrors history in browser localStorage for reopen UX.

### 2.2b Parse tools

```http
POST /api/nv/v1/sdk/patra-mitra/sessions/:sessionId/tools
Content-Type: application/json

{ "tool": "extract_parties", "answerLanguage": "hi" }
```

Tools: `detect_language`, `extract_parties`, `extract_dates`, `extract_amounts`, `extract_citations`, `find_clauses`, `pii_scan`, `regenerate_summary`, `export_fields`.

### 2.3 Get session

```http
GET /api/nv/v1/sdk/patra-mitra/sessions/:sessionId
GET /api/nv/v1/sdk/patra-mitra/sessions/:sessionId?fullText=1
```

### 2.4 Ask the document

```http
POST /api/nv/v1/sdk/patra-mitra/sessions/:sessionId/chat
```

Optional body field: `answerLanguage` (`en` | Indic codes | `mixed`).

```json
{
  "message": "Who are the parties and what is the confidentiality term?",
  "jurisdiction": "IN"
}
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "answer": "markdown counsel answer grounded in the document…",
    "session": { "sessionId": "pm_…", "chat": [/* history */], "…": "…" }
  }
}
```

Sessions expire after ~2 hours (server TTL). Re-upload if expired (`404`).

---

## 3. NSP wiring (recommended)

| NSP UI action | Call |
|---|---|
| Summarize selection / short file | `POST …/patra-mitra/sessions` with `content` or small `base64` |
| Show extracted parties / dates | Use `data.fields` |
| Show overview | Use `data.summary` + `data.keyPoints` |
| Follow-up Q&A in pane | `POST …/sessions/:id/chat` |
| Whole matter PDF / DMS | Prefer **EDJ** + optional Matter Vault; then orchestrate with `ragDocumentIds` |
| Insert answer into Word | NSP-only (clipboard / OOXML) |

```ts
// Preferred — @nyayavigya/client-sdk@5.0.10
import { NyvClient } from '@nyayavigya/client-sdk';
const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultPlatform: 'nsp',
});
const open = await nyv.patraMitra.createSession({
  fileBase64: base64,
  filename: fileName,
  mimeType,
  jurisdiction: 'IN',
});
const ask = await nyv.patraMitra.chat(String((open as any).data?.sessionId ?? (open as any).sessionId), {
  message: 'List key obligations',
});

// Raw HTTP (same mount)
const openHttp = await fetch(`${NYV}/api/nv/v1/sdk/patra-mitra/sessions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.NYV_SDK_KEY_NSP!,
    'X-NYV-Platform': 'nsp',
  },
  body: JSON.stringify({ base64, fileName, mimeType, jurisdiction: 'IN' }),
}).then((r) => r.json());
```

---

## 4. NYM SDK

`@nyayavigya/nyayamitra-sdk@5.1.2+`:

```ts
const session = await nym.openPatraMitra({ base64, fileName, mimeType, jurisdiction: 'IN' });
const { answer } = await nym.askPatraMitra(session.sessionId, 'Who are the parties?');
```

Expo sample: `examples/nyayamitra-mobile` → **PATRA** tab.

---

## 5. NYS dashboard

- UI: `https://nyayasearch.nyayasiddhi.online` → nav **Patra Mitra** (`/patra-mitra`)
- BFF: `/api/patra-mitra/*` on the Knowledge worker (proxies NYV when `NYV_API_BASE_URL` + `NYV_SDK_KEY` are set)

---

## 6. Related document APIs (when to use what)

| Need | API |
|---|---|
| Interactive parse + chat | **Patra Mitra** (this doc) |
| Sync extract / summarize only | `/api/nv/sdk/docs-pipeline/documents/*` |
| Large async + RAG index | EDJ `/api/nv/v1/sdk/ecosystem-documents/jobs` |
| Matter batch / playbooks | `/api/nv/matter-vault/*` |
| OCR image only | `/api/nv/gateway/ocr/process` |

---

## 7. Live smoke (2026-08-08)

| Check | Result |
|---|---|
| Health | 200 · product Patra Mitra |
| Session (NDA text) | 201 · 8 fields · summary · documentType=NDA · ~11s |
| Chat parties/term | 200 · grounded answer · no orchestration chrome |
| Chat consideration INR | 200 · INR 1,00,000 |
| Docs-pipeline extract | 200 |

Deploy: NYV `2026-08-08T1720Z-aws-ssm` · SSM `49c7dd8b-7dab-4241-a93b-2d1d0a25961c`.
