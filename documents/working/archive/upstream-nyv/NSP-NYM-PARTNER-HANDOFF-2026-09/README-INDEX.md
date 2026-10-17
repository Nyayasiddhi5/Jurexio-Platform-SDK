# Nyayavigya NSP/NYM Partner Handoff — September 2026

> **Pack date:** 2026-09-03 · **Gateway:** 5.0.0 · **SDK:** 5.0.10+  
> **Audience:** NSP / NYM engineering leads integrating with Nyayavigya  
> **Secrets rule:** No API keys, passwords, live host IPs, or pricing tiers in this pack.

## Documents

| # | File | Purpose |
|---|------|---------|
| 1 | [README-INDEX.md](./README-INDEX.md) | This index |
| 2 | [PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md](./PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md) | Integration checklist, `-fast` vs counsel paths, prompt pipeline, latency, embeddings fix, prompt improve API |
| 3 | [NSP-DRAFT-LATENCY-ANALYSIS-2026-09-02.md](./NSP-DRAFT-LATENCY-ANALYSIS-2026-09-02.md) | Draft-fast RCA — NYV overhead vs LLM |
| 4 | [LEGAL-AGENT-REGISTRY-AND-MODEL-RECOMMENDATIONS-2026-09-02.md](./LEGAL-AGENT-REGISTRY-AND-MODEL-RECOMMENDATIONS-2026-09-02.md) | Agent registry audit, Bedrock model matrix, post-LLM intelligence |
| 5 | [03-INTEGRATION-ARCHITECTURE-EXCERPTS.md](./03-INTEGRATION-ARCHITECTURE-EXCERPTS.md) | Architecture, use cases, docparse (from ShareReady pack) |
| 6 | [03-INTEGRATION-GUIDE-EXCERPT.md](./03-INTEGRATION-GUIDE-EXCERPT.md) | Topology + integration modes (excerpt) |

## Quick integration rules

1. Use `POST /api/nv/orchestrate` with explicit `-fast` taskType aliases for UI threads.
2. Never sync `legal-draft` (counsel-grade) from interactive UI — use `legal-draft-fast`.
3. `-fast` = specialist + Haiku-first + registry L1 prompt; Queen skipped by design.
4. Warm repeat prompts are cache-bound (~40–90 ms total wall time).
5. Cold doc-less draft-fast ~10–12 s — dominated by LLM output generation, not NYV routing.
6. **Embeddings:** send `{ texts: [...] }`, `{ content }`, or `{ documents: [{ id, content }] }` — all accepted on gateway paths (**NV-NSP-EMBED-INPUT-001**).
7. **Prompt improve:** use `POST /api/nv/v1/sdk/prompt/improve` before orchestrate for instant prompt enrichment (<200 ms cold, <100 ms cache hit).

## Live API (public)

- Gateway: `https://api.nyayasiddhi.online`
- Health: `GET /api/nv/health`
- **Latest deploy:** `2026-09-03T0555Z-aws-ssm-689caf64` (embeddings input fix)

## Keys

Obtain platform SDK keys through your Nyayasiddhi onboarding channel. **Never** embed keys in browser bundles.

---

*Nyayasiddhi™ · Nyayavigya SDK v5.0.0 · Justice. Powered by Precision.*
