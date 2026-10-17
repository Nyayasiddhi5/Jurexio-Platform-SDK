# NYV SDK Deep AI-Flow Probe Evidence — 2026-05-11

**Base URL**: `http://localhost:5000`
**Result**: 36 PASS / 34 FAIL (total 70)

Each probe traverses the **NV-ARCH-001 safety ring** end-to-end:
tenant isolation → guardrails → Queen orchestration → agent allocation (BM25 over 1042 agents × 6 jur × 22 patterns × 107 swarm topologies) → 22-section Parlant prompt → 5-tier memory + multi-tier RAG + GraphRAG → CoT/ReAct/ToT → **NV-ROUTER-001** (`intelligent-router/orchestrateLLM`) → response engineering → hallucination + citation + safety + HITL gate → audit hash chain → streaming.

## Per-flow summary

| Flow | PASS | FAIL |
|---|---|---|
| doc-automation | 7 | 0 |
| doc-intelligence | 7 | 0 |
| doc-drafting | 7 | 0 |
| doc-summarize | 7 | 0 |
| compliance | 7 | 0 |
| doc-compare | 1 | 6 |
| embeddings | 0 | 7 |
| agentic-research | 0 | 7 |
| enterprise-research | 0 | 7 |
| translation | 0 | 7 |

## Per-platform × per-flow matrix

| Platform | doc-automation | doc-intelligence | doc-drafting | doc-summarize | compliance | doc-compare | embeddings | agentic-research | enterprise-research | translation |
|---|---|---|---|---|---|---|---|---|---|---|
| NSP | ✓ 200 8059ms | ✓ 200 18883ms | ✓ 200 22182ms | ✓ 200 25560ms | ✓ 200 16373ms | ✓ 200 4181ms | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 |
| NSPM | ✓ 200 13665ms | ✓ 200 18310ms | ✓ 200 24165ms | ✓ 200 31557ms | ✓ 200 21069ms | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 |
| NSI | ✓ 200 3242ms | ✓ 200 16150ms | ✓ 200 23346ms | ✓ 200 27942ms | ✓ 200 23248ms | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 |
| NSA | ✓ 403 16ms | ✓ 403 15ms | ✓ 403 14ms | ✓ 403 17ms | ✓ 403 16ms | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 |
| NSM | ✓ 200 11192ms | ✓ 200 21534ms | ✓ 200 14337ms | ✓ 200 24151ms | ✓ 200 23049ms | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 |
| NYM | ✓ 403 20ms | ✓ 403 18ms | ✓ 403 32ms | ✓ 403 17ms | ✓ 403 17ms | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 |
| JRX | ✓ 200 5697ms | ✓ 200 17154ms | ✓ 200 19118ms | ✓ 200 30331ms | ✓ 200 20648ms | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 | ✗ 429 |

## Sample envelopes (first non-null per flow)

### doc-automation — NSP
- HTTP: 200 | latency: 8059ms
- requestId: `b1032f99-c41e-4f5d-a735-7c9b95f9840e`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"documentId":"doc_1778459896855_f49a6f29","format":"text","jurisdiction":"IN","language":"en","pageCount":1,"metadata":{"createdAt":"2026-05-11T00:38:24.835Z","detectedLanguage":"en","characterCount":531,"wordCount":78},"sections":[{"id":"sec_1","title":"Document Content","startPage":1,"endPage":1,"content":"INDEMNIFICATION. The Service Provider shall indemnify and hold harmless the Client from and against any losses, damages, claims, or expenses (including reasonable attorneys' fees) arising out of or relating to the Service Provider's gross negligence, willful misconduct, or breach of this Agreement. CONFIDENTIALITY. Each party agrees to keep confidential any non-public information received from the other party for a period of three (3) years from disclosure. GOVERNING LAW. This Agreement shall be"}],"llm":{"provider":"orchestrator","model":"nvidia/nemotron-3-nano-30b-a3b:free","tokens":{"input":294,"output":1650,"prompt":294,"completion":1650,"total":1944},"cost":0,"responseTime":7976},"timestamp":"2026-05-11T00:38:24.835Z"}
```

### doc-intelligence — NSP
- HTTP: 200 | latency: 18883ms
- requestId: `d78d6544-da48-4a0e-aa94-825521f71674`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"analysisId":"intel_1778459938701_6f02cfbe","jurisdiction":"IN","analysisTypes":["obligations","risks","deadlines","entities"],"entities":{"obligations":[{"party":"Provider","obligation":"Indemnify and hold harmless the Client","scope":"Losses, damages, claims, or expenses arising from the Provider's gross negligence, willful misconduct, or breach of this Agreement","citation":"Section 2.1, Indian Contract Act, 1872, as applied to indemnity clauses"},{"party":"Both parties","obligation":"Maintain confidentiality of non-public information","duration":"Three (3) years from the date of disclosure","citation":"Section 7.2, Indian Contract Act, 1872, governing confidentiality obligations"}],"risks":[{"risk":"Potential financial liability for the Provider due to indemnity clause","description":"The Provider may be liable for significant losses if found grossly negligent or in breach, including reasonable attorneys' fees","citation":"Indian Contract Act, 1872, Section 2.1"},{"risk":"Enforcement risk for confidentiality term","description":"Both parties must monitor compliance for a 3‑year period; failure may lead to breach claims","citation":"Indian Contract Act, 1872, Section 7.2"}],"deadlines":[{"deadlineType":"Confidentiality duration","duration":"3 years","effectiveDate":"From disclosure date of non‑public information","citation":"Section 7.2, Indian Contract Act, 1872"}],"entities":[{"entityName":"[REDACTED_NAME] Provider","role":"Provider of services"},{"entityName":"[REDACTE…[truncated]
```

### doc-drafting — NSP
- HTTP: 200 | latency: 22182ms
- requestId: `e9a1d9bf-56c4-494c-a63d-09d624f5e3af`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"suggestionId":"sug_1778460030766_446de508","contractType":"msa-saas","jurisdiction":"IN","suggestions":[{"clauseId":"cls_confidentiality","title":"Confidentiality & NDA","relevance":0.95,"reason":"Recommended for msa-saas agreements in IN"},{"clauseId":"cls_termination","title":"Termination for Convenience","relevance":0.9,"reason":"Recommended for msa-saas agreements in IN"},{"clauseId":"cls_arbitration","title":"Arbitration Clause","relevance":0.85,"reason":"Recommended for msa-saas agreements in IN"},{"clauseId":"cls_non_compete","title":"Non-Compete","relevance":0.8,"reason":"Recommended for msa-saas agreements in IN"},{"clauseId":"cls_ip_assignment","title":"IP Assignment","relevance":0.75,"reason":"Recommended for msa-saas agreements in IN"},{"clauseId":"cls_entire_agreement","title":"Entire Agreement","relevance":0.7,"reason":"Recommended for msa-saas agreements in IN"}],"metadata":{"contextLength":202,"modelConfidence":0.91,"totalClausesEvaluated":15},"llm":{"provider":"orchestrator","model":"openai/gpt-oss-20b:free","tokens":{"input":499,"output":565,"prompt":499,"completion":565,"total":1064}},"timestamp":"2026-05-11T00:40:52.929Z"}
```

### doc-summarize — NSP
- HTTP: 200 | latency: 25560ms
- requestId: `30949b8f-543d-4d16-8dff-242fef49dc46`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"summaryId":"sum_1778460133961_cc7c90e9","jurisdiction":"IN","length":"medium","summary":"","keyPoints":[],"metadata":{"originalLength":531,"summaryLength":1,"compressionRatio":0.01,"confidence":0.91},"llm":{"provider":"orchestrator","model":"openai/gpt-oss-20b:free","tokens":{"input":326,"output":899,"prompt":326,"completion":899,"total":1225}},"timestamp":"2026-05-11T00:42:39.503Z"}
```

### compliance — NSP
- HTTP: 200 | latency: 16373ms
- requestId: `9d3b1a37-c821-402d-bf99-30e03f31acfe`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"checkId":"comp_1778460273538_6e9a3529","jurisdiction":"IN","frameworks":["DPDP","GDPR"],"overallScore":0.57,"overallStatus":"non_compliant","findings":[{"framework":"DPDP","status":"partially_compliant","score":0.6,"issues":[{"severity":"medium","description":"Clause does not explicitly state that processing is based on lawful ground or consent as required under DPDP Section 4.","recommendation":"Add a statement that data processing is based on legitimate interest or obtained consent, and include a reference to DPDP Section 4."},{"severity":"low","description":"Retention period of three years may exceed DPDP's requirement for minimal necessary retention.","recommendation":"Review DPDP Section 13 to ensure retention period is justified and can be shortened if possible."},{"severity":"high","description":"No mention of data subject rights as required under DPDP Section 8, including right to access, rectification, erasure, and objection.","recommendation":"Insert a clause outlining the data subject's rights and procedures to exercise them, citing DPDP Section 8."}]},{"framework":"GDPR","status":"partially_compliant","score":0.55,"issues":[{"severity":"high","description":"The confidentiality clause does not address the requirement for lawful basis and transparency under GDPR Article 5 and Article 13.","recommendation":"Add a statement confirming lawful basis for processing (e.g., consent, contract, legitimate interest) and provide transparency details as per Article 13."},{"se…[truncated]
```

### doc-compare — NSP
- HTTP: 200 | latency: 4181ms
- requestId: `01220068-2ca4-460c-9d80-76055c42d46f`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"comparisonId":"cmp_1778460377962_d51935e1","compareTypes":["text","structure","clauses"],"similarityScore":0.99,"differences":[{"type":"modification","section":"CONFIDENTIALITY","description":"Document B extends the confidentiality period from three (3) years to five (5) years from disclosure.","severity":"high"}],"summary":{"totalDifferences":1,"additions":0,"modifications":1,"deletions":0,"documentALength":531,"documentBLength":530},"llm":{"provider":"orchestrator","model":"openai/gpt-oss-20b:free","tokens":{"input":503,"output":100,"prompt":503,"completion":100,"total":603}},"timestamp":"2026-05-11T00:46:22.123Z"}
```

### embeddings — NSP
- HTTP: 429 | latency: 5ms
- requestId: `760616fa-c2f8-4c63-b033-a31256eedf0e`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"error":"RATE_LIMIT_EXCEEDED","code":"NYV-RATE-002","retryAfterSeconds":60}
```

### agentic-research — NSP
- HTTP: 429 | latency: 6ms
- requestId: `a249fa4e-acf3-4128-b37a-1447e5ffb46c`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"error":"RATE_LIMIT_EXCEEDED","code":"NYV-RATE-002","retryAfterSeconds":60}
```

### enterprise-research — NSP
- HTTP: 429 | latency: 5ms
- requestId: `3523ece5-8084-4f3b-b285-cbb6355e2849`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"error":"RATE_LIMIT_EXCEEDED","code":"NYV-RATE-002","retryAfterSeconds":60}
```

### translation — NSP
- HTTP: 429 | latency: 5ms
- requestId: `b268b4aa-3fc6-42ed-8e3f-a468a40aaf1b`
- tokens: `"—"`
- auditHash: `—`
- qualityScore: `—`

```json
{"error":"RATE_LIMIT_EXCEEDED","code":"NYV-RATE-002","retryAfterSeconds":60}
```
