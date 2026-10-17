# UAT real-world scenario library

Scenario files for Track-2 of NV-OPT+UAT-2026-05-08. Driven by the (planned)
matrix runner `scripts/jrx-uat-real-world.ts` (T7).

## Structure

```
tests/uat/scenarios/
├── scenario.schema.json          ← JSON-schema validating every file below
├── README.md                     ← this file
├── IN/                           ← India scenarios
│   ├── litigation-drafting.json  (5)
│   ├── contract-review.json      (5)
│   ├── regulatory.json           (5)
│   ├── case-research.json        (5)
│   ├── ocr-multilingual.json     (5)
│   └── hitl-safety.json          (5)
└── US/                           ← USA scenarios
    ├── litigation-drafting.json  (5)
    ├── contract-review.json      (5)
    ├── regulatory.json           (5)
    ├── case-research.json        (5)
    ├── ocr-multilingual.json     (5)
    └── hitl-safety.json          (5)
```

**Total: 60 scenarios** (30 IN + 30 US) — meeting the §2A target of ≥30 per
jurisdiction. Every scenario is schema-valid against `scenario.schema.json`.

## How the matrix runner consumes these (T7, planned)

For each scenario file × each scenario × the cartesian product of:

- 6 active LLM providers (`anthropic`, `openai`, `google`, `openrouter`,
  `sarvam`, `bedrock`) + AgentZero priority-99 fallback,
- 8 OpenRouter `:free` models (sub-matrix on cost-sensitive scenarios only),
- CoT strategies (`zero_shot`, `self_consistency`, `tot`, `cove`),
- Failure injections (`provider-down`, `rag-empty`, `citation-fail`,
  `hash-break`, `rate-limit-storm`).

…it fires the request via the same SDK key (jurisdiction-aware, scope-aware),
captures the full envelope (`requestId`, `qualityScore`, `tokens.*`,
`metadata.auditHash`, agents invoked, swarm topology, CoT trace, RAG set,
gate verdicts, total cost, latency p50/p95) and writes a per-run audit
ledger to `audit/uat-real-world-<timestamp>.json`.

Pass/fail is the conjunction of: HTTP status match, every `mustHaveFields`
present, every `mustContainText` substring present, every `mustNotContainText`
absent, and `passCriteria` (free-text, scored by NS LRM judge).

## Conventions

- **IDs**: `{IN|US}-{LIT|CON|REG|RES|OCR|SAF}-NNN`. Never reused.
- **Document fixtures**: referenced via `fixtures/<JUR>/...` paths. The
  fixtures themselves are NOT in this repo — they live in S3
  `nsp-deploy-artifacts-789925699169-ap-south-1/uat-fixtures/`. The runner
  downloads on first run and caches under `.uat-cache/`.
- **Patterns**: `P01..P22` per `src/routes/jrx-patterns-routes.ts`.
- **No platform secrets in scenario bodies**: SDK keys are pulled from
  Replit Secrets at runtime, never embedded.

## Coverage matrix (today)

| Jurisdiction × Category | IN | US |
|---|---|---|
| litigation-drafting     | 5  | 5  |
| contract-review         | 5  | 5  |
| regulatory              | 5  | 5  |
| case-research           | 5  | 5  |
| ocr-multilingual        | 5  | 5  |
| hitl-safety             | 5  | 5  |
| **total**               | 30 | 30 |
