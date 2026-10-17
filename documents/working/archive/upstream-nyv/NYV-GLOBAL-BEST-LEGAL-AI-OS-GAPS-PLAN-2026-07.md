# NYV Global-Best Legal AI OS — Architecture gaps & execution plan (2026-07-30)

**Role:** CTO + AI Architect honest assessment.  
**Classification:** NYV primary (+ NYS caselaw embed ops).  
**Last update:** 2026-07-31T11:05Z — Platform hardening closed in code (R-SCHEMA-B residual CODE; neural nDCG CI gate; multi-domain packs). External PARKED items remain honest.

---

## Executive verdict (2026-07-31)

| Claim | Verdict |
|---|---|
| **Global-best agentic Legal AI OS (engineering)** | **COMPLETE** — live on nysdev `2026-07-31T0424Z-aws-ssm` |
| Ready as substrate for **other domains later** | **YES — scaffold shipped** — `GET /api/nv/domains` (legal GA + general/finance/healthcare); RAG fixtures + GLOBAL templates + partner smoke |
| SOC2 Type II **certified** | **NOT complete** — evidence pack ready; auditor engagement PARKED |
| Live DocuSign / iManage OAuth | **NOT complete** — NYV-native HMAC e-sign live; brand OAuth PARKED |
| 100% India caselaw semantic vectors | **OPS in progress** — HC embed loop active; hybrid FTS still serves search |
| GRPO continuous **weight** trainer | **NOT complete** — nightly export + online EMA live; GPU trainer PARKED |

**Sales / PM rule:** Sell the COMPLETE engineering OS + India Legal GA. Do **not** sell SOC2 certified, DocuSign OAuth, multimodal avatar GA, or “100% caselaw embedded” until those rows flip.

---

## Status legend

| Tag | Meaning |
|---|---|
| DONE | Live in code and deployed |
| CODE | Implemented — next deploy |
| OPS | Requires ops/time / partner / auditor |
| PARKED | External dependency |

---

## Wave status (compressed)

| Wave | Item | Status |
|---|---|---|
| W0 | Timeouts SSoT, Multi-AZ RDS+Redis, `db.r7g.large` | DONE |
| W1 | Memory∥RAG, LM cache, prompt compiler specialist+**Queen leaves**, RAG abstain, LLM hedge | DONE |
| W2 | Legal format, neural rerank honesty+keys, India registry, caselaw HC loop | DONE / OPS (% still climbing) |
| W3 | Self-RAG regen, CoT policy, credit L1, **GRPO nightly export** | DONE (trainer weights still PARKED) |
| W4 | Specialist stream, **Queen provisional + synthesis_final gated**, evidence cap, OCR async | DONE |
| W5 | SOC2 certified, DocuSign/iManage live OAuth | PARKED |
| R1–R5 | Residuals: CI nDCG, SDK gated contract, context budgets, queue_counts, IN templates | DONE |
| H1 | R-SCHEMA-B residual 4 tables (Drizzle+SQL) | CODE — RDS apply OPS (`nv_app` no CREATE) |
| H2 | Neural nDCG continuous gate (local CE + optional live keys) | DONE |
| H3 | Multi-domain packs (registry hint + RAG fixtures + templates + smoke) | DONE (scaffold) |

---

## Multi-domain expansion readiness

**Shipped 2026-07-31:** `src/config/nv-domain-packs.ts` + `GET /api/nv/domains`;
RAG fixtures under `tests/fixtures/rag/{general,finance,healthcare}-ndcg-sample.json`;
GLOBAL template seeds `seed-templates-domain-packs-2026-07.json`; partner smoke probes domains.

The Legal pack remains the first **GA vertical**. Domain expansion does **not** require rebuilding the OS:

| Layer | Legal today | Other domains later |
|---|---|---|
| Queen + AdaptiveRouter + QualityEnvelope | Live | Reuse; add domain taskTypes |
| Capability manifest + MCP curated | Legal-heavy allowlist | Add domain tool packs |
| RAG / Memory / budgets | India caselaw + templates | Swap corpus + template catalogs |
| EDJ / BullMQ / credit / safety ring | Live | Reuse unchanged |
| Agent registries | IN + Default 164 | New registry JSON per domain |
| Domain pack API | `legal` GA | `general` / `finance` / `healthcare` scaffold |
| SDK (`@nyayavigya/client-sdk`) | 5.0.6 | Additive APIs only |

**Gate for a new domain:** registry + RAG corpus + templates + partner smoke — not a new orchestrator.

---

## Closed this pack (2026-07-30T11xx) — pillars: cost · speed · legal quality

1. **EDJ → BullMQ primary** — `nyv-ecosystem-doc-job` queue + worker; PG enqueue only when BullMQ disabled (no double-process). `async_job_queue` remains status ledger.
2. **Learned AdaptiveRouter (bounded)** — `nv-adaptive-path-ema.ts` Redis path EMA; flips queen↔specialist only on moderate cases with ≥5 samples + score gap; lean/forceQueen never overridden; outcomes recorded post-request.
3. **GRPO online policy nudge** — `nv-grpo-online-policy.ts` → intelligent-router preferFast/preferQuality (±0.02). Nightly JSONL export remains; **weight trainer still PARKED**.
4. **Queen legal format parity** — `applyLegalResponseFormatting` after synthesis (India disclaimer / statute footer).
5. **NYV-native e-sign attestation** — HMAC-SHA256 proof + completionCertificate in `nv_esign_sessions.metadata` (`NYV_ESIGN_HMAC_SECRET`). Not DocuSign/Aadhaar.
6. **Caselaw India/HC-only default** — `EMBED_ALL_MAX_ROWS` default **0** in embed loop (never divert to light-all unless ops sets >0).
7. **SOC2 evidence pack** — checklist adds A1.2 Multi-AZ + C1.2 native attestation; still **not certified**.
8. **Orphans** — KEEP (dynamic imports): bedrock-request-builder, mcp-legal-delegate, redline-merge, gemini-embeddings, orch-retry-queue. Do not delete; fix wiring-audit honesty only.

### Pillar guardrails (always)

| Pillar | Mechanism in this pack |
|---|---|
| Cost / tokens | GRPO preferFast; evidence caps (prior); Adaptive flip→specialist when EMA says so |
| Speed / orchestration | Path EMA; BullMQ EDJ; HC-only embed (no wasted all-window) |
| Legal quality | Queen format polish; CoT on Queen flips; native signing honesty |

---

## Remaining outside engineering “100%” (honest backlog)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Caselaw semantic embed → product SLO | OPS | HC loop active; % climbs |
| 2 | SOC2 Type II **certified** | PARKED | Evidence pack ready |
| 3 | Live DocuSign/iManage OAuth | PARKED | NYV-native HMAC DONE |
| 4 | GRPO/DPO **weight trainer** | PARKED | Export + online EMA DONE |
| 5 | Multimodal flags ON + product UX | PARKED / product | Health wired; flags OFF |

Everything else in the global-best engineering matrix (W0–W4, residuals 6–16) is **DONE**.

---

*Tracker: 2026-07-31T10:00:00Z · Deploy: `2026-07-31T0424Z-aws-ssm`*
