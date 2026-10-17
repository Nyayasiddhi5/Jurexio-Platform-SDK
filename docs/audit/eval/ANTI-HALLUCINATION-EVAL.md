# Anti-Hallucination & Citation Verification — Eval Harness + Honest Reframing

**Owner:** Legal-AI / Platform Safety
**Scope:** IN, UK, US, EU, GC (Gulf), SG
**Guardrail IDs:** NV-SVC-AUTHORITY-ADAPTER-001 (this work), NV-ARCH-001 (safety ring), NV-LLM-001 (single router unchanged)

---

## 1. The honest reframing of the marketing claim

The platform has historically claimed **"95%+ accuracy, zero hallucination at all
times."** "Zero hallucination at all times" is not a measurable or defensible
guarantee for an LLM system. It is replaced here with a **measured, release-gated
bound**:

| Old (un-measurable) claim | New (measured, gated) bound |
|---|---|
| "Zero hallucination at all times" | **0 structurally-invalid citations surfaced** on verified answers, **0 unverified citations surfaced without an explicit `unverified` label / HITL gate**, measured per jurisdiction by the eval harness |
| "95%+ accuracy" | **≥ 95% blended legal-QA accuracy** (citation recall + answer-key coverage + LLM-as-judge) measured on the per-jurisdiction golden set in **live** mode |
| (implicit) every citation is trustworthy | **≥ 0.95 citation-faithfulness** (verified ÷ verifiable) via the jurisdiction authority adapter, with the remainder shown as **explicit `unverified`** — never a silent pass (guardrails §5.5) |
| (implicit) hallucinations never happen | **≥ 90% adversarial-detection**: the verifier must flag deliberately fabricated citations (impossible years, out-of-range sections/titles, instruments absent from the authority corpus) |

**What "bounded hallucination" means operationally:** a citation is only ever
labelled `verified` when an authority (known corpus or a live authority API)
positively confirms it. Anything else is labelled `unverified` (explicit) or
`invalid` (structurally impossible). The safety ring (Step 7) surfaces those
labels and the low-confidence path triggers the **HITL gate** before the answer
is shown to a user. We therefore bound *surfaced* hallucination, not the raw
model output.

---

## 2. Architecture — jurisdiction-pluggable verification

```
request.jurisdiction
        │
        ▼
 nv-authority-registry  ──►  JurisdictionAuthorityAdapter  (one per jurisdiction)
        │                         ├─ IN  → India Code            (NYV_F_CITATION_LIVE_IN)
        │                         ├─ UK  → legislation.gov.uk    (NYV_F_CITATION_LIVE_UK)
        │                         ├─ US  → US Code / CourtListener(NYV_F_CITATION_LIVE_US)
        │                         ├─ EU  → EUR-Lex               (NYV_F_CITATION_LIVE_EU)
        │                         ├─ GC  → UAE Federal / DIFC / ADGM (NYV_F_CITATION_LIVE_GC)
        │                         └─ SG  → Singapore Statutes Online (NYV_F_CITATION_LIVE_SG)
        ▼
 verdict per citation: verified | unverified | invalid | unsupported
        │
        ▼
 safety-pipeline Step 7  ──►  warnings + confidence  ──►  HITL gate (Step 8)
```

- **Source files:** `src/services/citation-verification/` (adapters + registry),
  `src/services/hallucination-checker.ts` (jurisdiction-pluggable entry; IN path
  preserved byte-for-byte), `src/services/safety-pipeline.ts` (Step 7 now
  jurisdiction-aware).
- **Live vs deterministic:** every adapter ships a **deterministic** verifier
  (known-corpus match + structural-format validation). Live authority APIs are
  **off by default** behind per-jurisdiction feature flags; when disabled or
  unreachable the adapter returns an explicit `unverified` status — **no silent
  fallback to "verified".**

---

## 3. The eval harness

- **Golden sets:** `docs/audit/eval/golden/{IN,UK,US,EU,GC,SG}.json` — legal Q&A
  prompts with `expectedCitations`, `expectedAnswerKeywords`, a grounded
  `seedAnswer`, and an `adversarialAnswer` (deliberately fabricated) per item.
- **Runner:** `npm run eval:legal-accuracy` (`scripts/nv-eval-legal-accuracy.ts`).
- **Scoreboard:** `docs/audit/eval/scoreboard-latest.{json,md}` +
  timestamped JSON.

### Modes

| Mode | Command | What it measures | Needs |
|---|---|---|---|
| **seed** (default) | `npm run eval:legal-accuracy` | citation-faithfulness, hallucination-rate, adversarial-detection on the golden reference + fabricated answers. Proves the verifiers + gate logic work. | nothing (no DB / no keys) |
| **live** | `npm run eval:legal-accuracy -- --gateway http://localhost:5000 --token "$JWT"` | the **real model's** accuracy + citation-faithfulness + hallucination per jurisdiction | running gateway, provider keys, DB |

In **seed** mode the *accuracy* number reflects the reference answer text plus the
heuristic judge, so it is reported but **not release-blocking**; the
verifier-derived metrics are real and **are** blocking. In **live** mode all
metrics block.

### Release-gate thresholds (env-overridable)

| Metric | Env var | Default |
|---|---|---|
| Min accuracy (live) | `NYV_EVAL_MIN_ACCURACY` | 95 (%) |
| Min citation faithfulness | `NYV_EVAL_MIN_CITATION_FAITHFUL` | 0.95 |
| Max hallucination rate | `NYV_EVAL_MAX_HALLUCINATION` | 0 (%) |
| Min adversarial detection | `NYV_EVAL_MIN_ADVERSARIAL_DETECT` | 90 (%) |

`npm run eval:legal-accuracy` exits non-zero if any jurisdiction fails its
blocking gate (use `-- --no-gate` for an informational run). Wire this into CI as
a release gate.

---

## 4. What must be provided to make each jurisdiction *fully live*

All adapters work deterministically today. To enable live authority confirmation:

| JCN | Flag | Optional env (base URL / token) | Notes |
|---|---|---|---|
| IN | `NYV_F_CITATION_LIVE_IN` | `NYV_INDIA_CODE_API_BASE` | India Code search API |
| UK | `NYV_F_CITATION_LIVE_UK` | `NYV_UK_LEGISLATION_API_BASE` | legislation.gov.uk Atom feed |
| US | `NYV_F_CITATION_LIVE_US` | `NYV_COURTLISTENER_API_BASE`, `NYV_COURTLISTENER_TOKEN` | CourtListener REST v4 |
| EU | `NYV_F_CITATION_LIVE_EU` | `NYV_EURLEX_API_BASE` | EUR-Lex quick-search |
| GC | `NYV_F_CITATION_LIVE_GC` | `NYV_GC_LEGISLATION_API_BASE` (required) | no single free GCC API — operator wires a regional source |
| SG | `NYV_F_CITATION_LIVE_SG` | `NYV_SG_SSO_API_BASE` | Singapore Statutes Online |

Live mode of the *eval harness* additionally requires a running gateway, the
LLM provider keys for the orchestrator, and the Postgres statute tables for the
DB-backed IN citation service.
