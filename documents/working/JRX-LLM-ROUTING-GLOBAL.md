# JRX global LLM routing (Bedrock, Gemini, peers)

**Scope:** Gateway orchestration, legal chat, docparse extract, streaming draft.  
**Principle:** Retrieve first (RDS + RAG), then complete — citations from chunks, not model memory.

---

## Routing matrix

| Task | Primary model plane | When to use Gemini / multilingual |
|------|---------------------|-----------------------------------|
| Statute-grounded Q&A | Amazon Bedrock (Claude / Nova) | Hindi/regional IN prompts; Arabic GC prompts |
| Precedent research | Bedrock + NYS/caselaw layer (when enabled) | Same |
| Structured extract (docparse) | Bedrock with JSON schema | Scanned Indic/GC docs needing OCR follow-up |
| Summarization / memo | Bedrock | Multilingual summary requested |
| Comparative (multi-jx) | Bedrock + **`crossJurisdiction: true`** Auto-RAG | — |
| Low-latency tier / lite | Nova / smaller Bedrock | — |
| Eval / GRPO scoring | Smaller/faster model | — |

Configure via existing tier + `preferredModel` on legal chat; env keys live in `/jurexio/prod/*` on EC2 (never commit values).

---

## Jurisdiction injection

1. **HTTP / SDK:** pass `jurisdiction` (`IN`, `US`, …) or bind via SDK context.
2. **Middleware:** `jrx-jurisdiction-binding-middleware.ts` injects currency, courts, compliance flags.
3. **Queen Step-0:** `autoRagRetrieve` with jurisdiction filter; cross-jx when flag or comparative intent.
4. **Output:** `jrx-client-outcome-sanitize.ts` + binding **prohibitedPhrases**.

---

## Grounding checklist (every legal completion)

- [ ] Auto-RAG attempted (`metadata.ragStep0` on Queen path)
- [ ] Chunk count > 0 OR explicit abstain / “no authority found”
- [ ] Citations reference `authorityRef` / section ids from retrieval
- [ ] Jurisdiction on response matches request (unless cross-jx disclosed)

---

## Finetune policy

- **Allowed:** datasets with explicit commercial-compatible licenses (e.g. Open India Law CC BY 4.0).
- **Not allowed without legal review:** NC/ND corpora (e.g. some Saudi HF sets).
- **Default production path:** RAG ingest + prompt/rubric tuning, not weight finetune.

See **`JRX-GLOBAL-LEGAL-INTELLIGENCE-ROADMAP.md`** for corpus sources and phasing.
