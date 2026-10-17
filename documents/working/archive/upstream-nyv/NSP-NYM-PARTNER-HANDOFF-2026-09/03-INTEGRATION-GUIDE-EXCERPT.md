# Nyayavigya Platform Integration Guide — NSP · NYM · JRX (2026-07)

> **Audience:** Engineering leads integrating **Nyayasiddhi Professional (NSP)**, **Nyayamitra (NYM)**, and **JRX** (white-label / integrator) with the Nyayavigya (NYV) AI backbone.  
> **API / SDK / MCP line:** **5.0.0** (SemVer locked — additive only) · Client SDK **5.0.10+** for Patra Mitra / CNR / Instant Search / trust fields  
> **Live gateway:** `https://api.nyayasiddhi.online`  
> **NYS knowledge plane:** `https://nyayasearch.nyayasiddhi.online` (reached **only** via NYV Auto-RAG / knowledge proxies)  
> **Keys:** keep current shared / per-SKU keys (see §2). **Never** put live keys in browser bundles or this document.  
> **NSP API handoff (start here for endpoints):** [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md)  
> **Canonical entry:** [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) — §2.1–2.3 SME drafting + Instant Search / Legal Feed  
> **Playbook (req/res/use cases):** [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md)  
> **Companions:** `ECOSYSTEM-SDK-INTEGRATION-GUIDE-2026-07.md`, `NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`, `PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`, `NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`, `NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md`, `NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md`, `NYS-KNOWLEDGE-PLANE-INTEGRATION-2026-07.md`, `PARTNER-SDK-RELEASE-2026-05.md`  
> **Updated:** 2026-08-12

---

## 0. Executive topology (no gaps)

```text
┌─────────────────────────────────────────────────────────────────┐
│  Frontend platforms                                              │
│  NSP (web + Word add-in) · NYM (citizen) · JRX (white-label)     │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ API / SDK / MCP / Plugin       │
                ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  NYV Platform 5.0.0          │   │  Client Plugin (NSP Word)    │
│  Queen · RAG · Agents · EDJ  │◄──│  OAuth UX stays on NSP       │
│  Matter Vault · MCP · LLM    │   └──────────────────────────────┘
└───────────────┬──────────────┘
                │ Auto-RAG / knowledge plane (partner key forwarded)
                ▼
┌──────────────────────────────┐
│  NYS Agentic AI              │
│  Caselaw · Statutes · Tasks  │
│  Templates · Hybrid retrieve │
└──────────────────────────────┘
```

| Layer | Owns | Does **not** own |
|---|---|---|
| **NSP / NYM / JRX** | UX, auth sessions, Word/DMS OAuth, matter pickers, billing UX | Direct LLM calls, DMS bytes→AI without NYV |
| **NYV** | Orchestration, safety ring, LLM routing, EDJ, Matter Vault, citations, partner API/SDK/MCP | Word ribbon UI, iManage login screens |
| **NYS** | Caselaw/statutes/templates/legal-work knowledge | Partner keys, Word/DMS, billing |

**Rule:** Frontends never call NYS with end-user keys for product features. Always **NYV → NYS**.

---

## 1. Integration modes (choose one or combine)

| Mode | When to use | Entry |
|---|---|---|
| **A. REST API** | Backend-to-backend, server proxies, batch jobs | `https://api.nyayasiddhi.online/api/nv/...` + `X-API-Key` |
| **B. Client SDK** | Node/TS backends & BFF (recommended) | `@nyayavigya/client-sdk@5.0.0` → `NyvClient` |
| **C. MCP server** | Cursor / Claude Desktop / agent runtimes | `@nyayavigya/mcp-server@5.0.0` (stdio or SSE) |
| **D. Partner MCP HTTP** | Custom agents without local MCP process | `GET/POST /api/nv/sdk/workflows/protocols/mcp/tools[/invoke]` |
| **E. Client plugin (Word / Outlook)** | In-document drafting & review | **NSP** add-in → NSP BFF → NYV (see Word/DMS contract) |
| **F. Ecosystem Documents (EDJ)** | Large / offline / DMS-sourced docs | `POST /api/nv/v1/sdk/ecosystem-documents/jobs` |
| **G. Matter Vault** | Multi-doc matter review + playbooks | `/api/nv/matter-vault/*` |
| **H. Nyayamitra SDK** | Citizen chat (9 languages) | `@nyayavigya/nyayamitra-sdk@5.0.0` |
| **I. Enterprise SDK** | Multi-org / compliance admin (JRX/NSI) | `@nyayavigya/enterprise-sdk@5.0.0` |

### Recommended default by platform

| Platform | Primary mode | Secondary |
|---|---|---|
| **NSP** | SDK (B) + Word plugin (E) | MCP (C) for internal agents; EDJ (F) for DMS |
| **NYM** | Nyamamitra SDK (H) + `orchestrate` | Knowledge search via SDK |
| **JRX** | SDK (B) or raw API (A) | MCP (C/D) for customer agent stacks |

---

## 2. Authentication (same keys you use today)

### Headers (all modes)

```http
X-API-Key: <your-platform-key>
Content-Type: application/json
X-NYV-SDK-Version: 5.0.0
X-NYV-Platform: nsp
X-Request-Id: <uuid>
```

| Header | Required | Notes |
|---|---|---|
| `X-API-Key` | **Yes** (canonical) | Partner SDK key |
| `Authorization: Bearer <same-key>` | Fallback | Accepted where dual-auth is enabled |
| `Authorization: Bearer <JWT>` | Console only | Operator Console — not partner product path |
| `X-NYV-Platform` | Recommended | `nsp` \| `nym` \| `jrx` |
| `X-Customer-Org-Id` | Multi-tenant | Downstream customer org |
| `X-Request-Id` | Recommended | Audit correlation |

### Env vars (no values in git)

| Platform | Env var |
|---|---|
| Shared (dev-live until rotation) | `NYV_SDK_KEY_SHARED` + `NYV_SDK_SHARED_KEYS=1` |
| NSP | `<NYV_SDK_KEY_NSP>` |
| NYM | `<NYV_SDK_KEY_NYM>` |
| JRX | `NYV_SDK_KEY_JRX` |

Canonical secret file (operators): `.local/secrets/ecosystem-shared-integration.env`  
Handover stamps (no values): `documents/working/NSP-API-KEYS-HANDOVER.md`

### Dual auth

Routes marked **dualSdkOrJwt** accept SDK key **or** Console JWT. Partner products should always send **SDK key**.

---

## 3. Intelligence depth (all document APIs)

Canonical enum — **required** on new clients:

| `depth` | Aliases | ~words (summary) | Typical tier |
|---|---|---|---|
| `concise` | `brief`, `short` | ~150 | free / starter |
| `detailed` | `standard`, `medium` | ~400 | pro |
| `comprehensive` | `long`, `full` | ~800+ | enterprise |
