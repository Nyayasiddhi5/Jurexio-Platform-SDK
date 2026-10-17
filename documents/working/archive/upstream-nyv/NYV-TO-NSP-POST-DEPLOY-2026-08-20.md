# NYV → NSP — post-deploy update (2026-08-20)

> **From:** Nyayavigya platform team  
> **To:** Nyayasiddhi Professional (NSP) integration team  
> **Date:** 2026-08-20 (UTC)  
> **Deploy:** NYV gateway **`8c6852aa`** (`2026-08-20T1004Z-aws-ssm`) · NYS **`712e35ea785adab7068603d171d7c7e6`**  
> **Full reply:** [`NYV-TO-NSP-CONSOLIDATED-REPLY-2026-08-20.md`](./NYV-TO-NSP-CONSOLIDATED-REPLY-2026-08-20.md) · **Contract:** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)

---

## Summary (share this block)

We deployed the NYV-1 … NYV-11 sprint to **api.nyayasiddhi.online** at **2026-08-20T10:04Z**. Your Wave D D7 surfaces (`analysisStatus`, per-surface circuit breaker, citator numeric-token fix, `courtType` filter forwarding, judgment `paras[]`, caselaw pagination/filters/SLO, bare-numeric latency fix) are **live and verified**.

**What you can use now**

| Ask | Status | Action for NSP |
|---|---|---|
| ALB host rules (`api` / `console`) | **Live** | No change — keep calling `https://api.nyayasiddhi.online` |
| Citator exact resolution (case names + SCR brackets) | **Live** | Use `?exact=true` for citation-grade lookups; read `authority.resolution.method` |
| `paras[]` / judgment structure | **Live** | Opt in with `structure: true` on extract; see corpus caveat below |
| Caselaw search filters + `courtType` | **Live** | `GET /api/nv/knowledge/caselaw/search?courtType=sc\|hc\|dc` |
| Bare-numeric latency (`302` vs `IPC 302`) | **Live** | No client change |
| `analysisStatus` on orchestrate | **Live** | Read **`data.extras.analysisStatus`** (not top-level) |
| Per-surface circuit breaker | **Live** | Retry the **named surface** only; `fts` no longer blocked by slow `hybrid` |
| Wave D D7 (analyze / draft / research) | **Live** | Surfaces are up; quality envelope is honest (`authoritiesDelivered`, `unknownReason`) |
| On-demand full judgment text | **Live** | `/api/nv/knowledge/judgments/full-text` (96 MB cap) |
| Statute compare (IPC↔BNS, BNSS) | **Live** | Slug is **`new-old`** not `bns-ipc` |

**Counsel-grade harness (live, post-deploy `8c6852aa`):** **8 ok / 2 failing / 0 blocked** — same as pre-deploy baseline. Both failures are `authority_density` on `legal_research` (metadata-only FTS cannot surface locatable authorities in long-form research). Artifacts: `.local/benchmarks/post-deploy-8c6852aa-*/`.

**SDK tarball:** **`sdk-dist/current` → v5.1.0`** — SHA-256 `50306f8bac913decf9985206aec3f723dfca97023468a6b0b14bc24f5bd6953a`. Synced to S3 + EC2 `/opt/Nyayavigya/sdk-dist/v5.1.0/` (2026-08-20). Formal pin details: [`NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md`](./NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md) §5.

---

## Still open — not part of this deploy

These are **honest limitations**, not regressions. We are not claiming them as fixed.

### 1. Citation graph backfill — **running (GO received 2026-08-20)**

NSP issued **GO: citation-graph-backfill**. Jobs launched on caselaw worker (~11:04Z):

- Phase 3 extract: `nys-treatment-graph-extract.mjs` (newest-first)
- Phase 4 edges: `nys-treatment-graph-edges.mjs` → S3 / local JSONL fallback
- Ingest: `nv-treatment-graph-ingest.mjs` on nysdev → `nv_legal_graph_entities` / `_edges`

Monitor: `/opt/nyv/logs/treatment-graph-*.log`, checkpoints under `/opt/nyv/api/`. CITES edges first; OVERRULES gated on widened gold set.

### 2. Pre-2000 SCR `paras: []` — **corpus limitation, documented**

Supreme Court reporter volumes before ~2000 carry **no paragraph numbers** in the source PDFs. When you opt in with `structure: true`, the parser correctly returns:

- `paras: []`
- `numbering: 'ambiguous'`

This is not a parser bug — there is nothing to enumerate. Post-2000 SCR and HC rows with inline numbering populate `paras[]` normally. Do not treat empty `paras` on a 1973 landmark as a service failure.

### 3. FTS over judgment **bodies** — **deployed + backfill running (GO received 2026-08-20)**

NYS deploy **`ea9c3c28c9e12fc64221646e9b4a6955`** shipped SC body FTS. Backfill `backfill-sc-body-fts.mjs` running newest-first (~18 h, 43,505 SC judgments). Search path ORs metadata FTS with `body_search_tsv` when populated. HC/DC body FTS remains a separate programme.

### 4. Affirmative `goodLaw: 'good'` — **declined**

Statutory supersession and partial overruling are invisible to a citation graph. Use `unknownReason` + `coverage` (live) instead.

### 5. `verifyCitationPlane` — **definitively no**

Existence-only verification remains the contract (`verify-citation` confirms the citation string resolves; it does not assert treatment).

---

## Recommended NSP integration checks (post-deploy)

1. **Health:** `GET https://api.nyayasiddhi.online/api/nv/health` → 200  
2. **SC filter:** `GET …/knowledge/caselaw/search?q=bail&courtType=sc&limit=3` → SC rows only  
3. **Exact citator:** `GET …/authority/resolve?citation=…&exact=true` → branch on `method`  
4. **Structure:** `POST …/knowledge/judgments/full-text` or NYS extract with `structure: true` → expect `paras: []` on pre-2000 SCR  
5. **Orchestrate:** document-analysis turn → `data.extras.analysisStatus` present  
6. **Re-probe:** run `scripts/nv-nsp-partner-reprobe.sh` (canonical checklist) after your NSP deploy; reply with Pass/Fail per surface.

---

*Formal reply to NSP acceptance: [`NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md`](./NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md)*

---

## Demo-week AI quality mode (2026-08-20 → 2026-08-27)

Investor demos: **quality over cost** for all NSP/NYM counsel tasks.

| Setting | Demo value | Effect |
|---|---|---|
| `NYV_ROUTER_BEDROCK_FIRST` | `on` | Bedrock aggregator leads |
| `NYV_PARTNER_LEGAL_PREMIUM_FIRST` | **`0`** | **Do not** skip Bedrock for direct Gemini/Claude API |
| `NYV_LLM_CASCADE_LEAD` | Sonnet 5 → Opus 5 → … (Bedrock profiles) | Interactive counsel leads Sonnet; draft leads Opus |
| `NYV_LLM_CASCADE_GEMINI` | **`gemini-3.7-flash`**, `gemini-3-1-pro-preview`, … | Latest Flash first; Pro preview fallback only |
| `NYV_PARTNER_LEGAL_PREMIUM_MODELS` | Sonnet 5, Opus 5, **gemini-3.7-flash**, 3-1-pro | Bedrock first; Gemini 3.7 before Pro |
| `NYV_PARTNER_MAX_TOKENS_FLOOR` | `16384` | Longer counsel-formatted drafts |
| `NYV_LLM_OPENROUTER_FREE_FIRST` | `off` | No `:free` tier for partners |

**Apply on nysdev (no redeploy):** `bash scripts/nv-ec2-ssm-run.sh scripts/_ec2-demo-week-quality-models.sh demo-week-quality`

**Revert after demo week:** `DEMO_WEEK_REVERT=1` on the same script (uses timestamped env backup).

Extract/summarize/classify tasks still use fast Bedrock Nova rails — only counsel-grade task kinds get the full cascade.

*Tracker: 2026-08-20T12:45:00Z · Evidence: deploy SSM `2f08dd37`, counsel-grade `post-deploy-8c6852aa`, sdk-dist/v5.1.0*
