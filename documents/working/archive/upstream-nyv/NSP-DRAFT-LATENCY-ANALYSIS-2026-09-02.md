# NSP Draft Latency Analysis — 2026-09-02

**Scope:** NYV partner orchestrate paths for NSP/NYM `legal-draft-fast` vs `legal-draft`.  
**Evidence:** EC2 probes via `npm run demo:probe:latency:ec2` (SSM `c87330bb`, deploy `2026-09-02T1013Z-aws-ssm-0e7a9b88`) + code audit of hot path.

---

## Executive answer

| Path | Wall time (nysdev) | Dominant cost | NYV overhead vs LLM |
|------|-------------------|---------------|---------------------|
| **NSP `legal-draft-fast` repeat** | **43–47 ms** | LM cache hit (Haiku) | **~0%** — essentially zero NYV tax once cached |
| **NSP `legal-chat-fast` repeat** | 60–91 ms | LM cache hit | ~0% |
| **NYM `legal-chat-fast` cold→warm** | 8329 ms → 42 ms | First call = LLM + RAG; repeat = cache | Cold: **LLM+RAG dominate**; NYV routing ~sub-second |
| **NYM `legal-draft-fast` repeat** | 45–54 ms | LM cache hit | ~0% |
| **`legal-draft` (full counsel)** | Not in repeat probe; historical **84.8 s** (pre NV-DRAFT-FAST-SLA-001) | Queen + CoT + partner RAG floor | **NYV was the problem** when `-fast` alias was ignored |

**Bottom line:** On the correctly wired `-fast` specialist path, **repeat prompts are cache-bound (~40–90 ms total)** — NYV adds negligible wall time. **Cold doc-less draft-fast** was still paying **partner RAG floor (topK 16, timeout up to 45 s)** and could re-enable **CoT when partners sent `enableCoT: true`**, both pure NYV overhead with no quality gain for Describe & Generate / one-line prayers.

---

## Probe results (2026-09-02, pre-change baseline)

Deploy: `2026-09-02T1013Z-aws-ssm-0e7a9b88` on nysdev. SSM `d9f570f4` (cold comparison, unique stamp prompt).

| Scenario | Wall ms | Path | Model |
|----------|---------|------|-------|
| **draft-fast-cold** | **18,597** | specialist | Haiku 4.5 |
| **draft-fast-warm** (repeat) | **55** | specialist | Haiku 4.5 |
| **draft-full-cold** (`legal-draft`) | **68,258** | specialist | Opus 5 |
| **chat-fast-cold** | **29,847** | specialist | Haiku 4.5 |

Repeat cache probe (SSM `c87330bb`, identical short prompt, maxTokens=128):

```
NSP legal-draft-fast:  run1=43ms  run2=47ms  path=specialist  model=haiku-4-5
NSP legal-chat-fast:   run1=91ms  run2=60ms  path=specialist  model=haiku-4-5
NYM legal-chat-fast:   run1=8329ms run2=42ms  (behavioral cache)
NYM legal-draft-fast:  run1=45ms  run2=54ms  path=specialist  model=haiku-4-5
```

---

## NYV vs LLM breakdown (code-path audit)

### Already correct (kept)

| Stage | `-fast` behaviour |
|-------|-------------------|
| SDK auth / tenant isolation | Unchanged |
| `isPartnerSlaFastTask` → `partnerLean=true` | Skips Queen; specialist + Haiku-first cascade (`NV-FAST-SERVING-TIER-001`) |
| Safety ring PII strip + output sanitize | Unchanged |
| Hallucination + citation verification | Stay on (async, non-blocking) |
| CoT strip from partner JSON | `NV-COT-PARTNER-STRIP-001` |
| Rate limits | NSP unlimited unchanged |
| Model cascade | `BEDROCK_SLA_FAST_LEGAL` — Haiku-first, not Sonnet-first |

### Removable overhead found (this change)

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| **CoT leak** — `enableCoT: true` from partner body bypassed SLA resolver | `nv-orchestration-routes.ts` dispatch sites | Multi-minute CoT path | `resolvePartnerDispatchEnableCoT()` — force off on `-fast` |
| **RAG on doc-less draft-fast** — partner RAG floor (16 chunks, 45 s timeout) with nothing to retrieve | `resolveNspNymBestOutcomeQuality` | **8–45 s cold** on first prompt | `shouldSkipRagForPartnerFastDraft()` — mirror chat-fast |
| **Complexity assessment on lean path** | `assessPromptComplexity` before router | Minor CPU | Skip when `partnerLean` |
| **Confidence scorer on `-fast`** | `nv-client.ts` post-LLM | Minor CPU | Skip when `slaFastExplicit` |

### Evaluated but not removed

| Candidate | Verdict |
|-----------|---------|
| Queen depth on `-fast` | Already disabled via `partnerLean` |
| Duplicate Sonnet cascade | Already Haiku-first via `isSlaFastLegalRoute` |
| GRPO EMA router nudge | Sync LRU read, non-blocking — keep |
| Hallucination/citation checks | Safety-critical — keep (async) |
| Context budget expansion | Already `partnerSlaFast: true` → simple complexity, no partner RAG floor |
| Orchestration metadata assembly | Required for contract; sanitized by `nv-client-outcome-sanitize.ts` |

---

## Changes shipped (2026-09-02)

- **NV-FAST-DRAFT-NORAG-001** — doc-less `legal-draft-fast` / `doc-draft-fast` skip vector RAG (documents attached or explicit `enableRAG: true` still retrieve).
- **NV-FAST-COT-OFF-001** — `-fast` aliases ignore partner `enableCoT: true` at dispatch.
- Lean-path complexity assessment skip; confidence scorer skip on explicit `-fast`.

**Expected cold improvement:** doc-less draft-fast avoids 8–45 s RAG wait; CoT cannot re-trigger on partners that send `enableCoT: true`.

---

## Verification

- Unit: `tests/unit/nv-draft-fast-sla.test.ts`
- Post-deploy: `npm run demo:probe:latency:ec2` + `scripts/_ec2-draft-latency-comparison-probe.sh` (cold stamp prompt)
