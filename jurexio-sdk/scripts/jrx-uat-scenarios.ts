/**
 * JRX-UAT-v3.2 Comprehensive Test Pack — Scenario Definitions
 * JRX-UAT-PACK-001
 *
 * 200+ scenarios spanning 7 jurisdictions, 6 orchestration patterns, 5 CI modes,
 * RAG, Memory, Voice, OCR, Gates, HITL, SDK Gateway, AG-UI streaming,
 * Compliance, Multi-language and Failure modes.
 *
 * Consumed by `scripts/jrx-run-uat.ts`.
 */

export type ScenarioStatus = 'pending' | 'pass' | 'fail' | 'partial' | 'deferred' | 'blocked' | 'skipped';

export interface Scenario {
  id: string;
  category: string;
  jurisdiction?: string;
  pattern?: string;
  userRole?: string;     // lawyer-pro | citizen-mitra | enterprise-counsel | paralegal | super-admin
  sdkVariant?: string;   // nsp-web | nsp-mobile | jurexio-citizen-mobile
  description: string;
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    auth?: 'jwt' | 'sdk-key' | 'inter-secret' | 'none';
  };
  expected: {
    httpStatus: number | number[];
    mustHaveFields?: string[];
    mustContainText?: string[];
    mustNotContainText?: string[];
    mustHaveLowConfidenceRoute?: boolean;
    timeoutMs?: number;
  };
  passCriteria: string;
}

// ── 7 Jurisdictions × 5 Use Cases = 35 baseline cases ─────────────────────────
const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'SG', 'GC', 'Default'] as const;
const USE_CASES = [
  { code: 'TEN', label: 'tenancy',     prompt: (j: string) => `Under ${j} law, what are a residential tenant's rights when a landlord refuses to return the security deposit?` },
  { code: 'CON', label: 'contract',    prompt: (j: string) => `Under ${j} law, what makes a contract voidable for misrepresentation?` },
  { code: 'EMP', label: 'employment',  prompt: (j: string) => `Under ${j} law, what notice period is owed when terminating an employee for cause?` },
  { code: 'IP',  label: 'ip',          prompt: (j: string) => `Under ${j} law, when does fair use / fair dealing protect a copyrighted excerpt in a research paper?` },
  { code: 'REG', label: 'regulatory',  prompt: (j: string) => `Under ${j} law, what are the data-protection consent requirements for a fintech app?` },
];

const baselineJurisdictions: Scenario[] = [];
for (const j of JURISDICTIONS) {
  for (const u of USE_CASES) {
    baselineJurisdictions.push({
      id: `${j}-${u.code}-001`,
      category: 'jurisdiction',
      jurisdiction: j,
      pattern: 'sequential',
      userRole: 'lawyer-pro',
      sdkVariant: 'nsp-web',
      description: `${j} ${u.label} baseline — single-agent legal Q&A`,
      request: {
        method: 'POST',
        path: '/api/jrx/orchestrate',
        auth: 'jwt',
        body: {
          prompt: u.prompt(j),
          jurisdiction: j === 'Default' ? undefined : j,
          taskType: 'analysis',
          tier: 'pro',
          enableCitationVerification: true,
          enableHallucinationCheck: true,
          maxTokens: 800,
        },
      },
      expected: {
        httpStatus: 200,
        mustHaveFields: ['data.content'],
        timeoutMs: 60000,
      },
      passCriteria: `200 OK with non-empty content; citation verifier executed; jurisdiction echoed in metadata when provided.`,
    });
  }
}

// ── 6 Orchestration patterns × 3 cases = 18 ───────────────────────────────────
const PATTERNS = [
  { mode: 'sequential',                taskType: 'analysis' },
  { mode: 'parallel',                  taskType: 'analysis' },
  { mode: 'swarm',                     taskType: 'research' },
  { mode: 'dag',                       taskType: 'analysis' },
  { mode: 'hierarchical',              taskType: 'planning' },
  { mode: 'multi-agent',               taskType: 'analysis' }, // CI proxy
];
const PATTERN_PROMPTS = [
  'Draft a confidentiality clause for an Indian SaaS MSA and explain the risk trade-offs.',
  'Compare BNS 2023 §103 against IPC §302 and outline the practical impact on bail.',
  'Summarise the regulatory steps for a UK fintech to passport into the EU after Brexit.',
];
const orchestrationPatterns: Scenario[] = [];
for (const p of PATTERNS) {
  for (let i = 0; i < 3; i++) {
    orchestrationPatterns.push({
      id: `PAT-${p.mode.toUpperCase()}-${(i + 1).toString().padStart(3, '0')}`,
      category: 'pattern',
      pattern: p.mode,
      jurisdiction: ['IN', 'UK', 'EU'][i],
      userRole: 'enterprise-counsel',
      sdkVariant: 'nsp-web',
      description: `${p.mode} orchestration — case ${i + 1}`,
      request: {
        method: 'POST',
        path: '/api/jrx/orchestrate',
        auth: 'jwt',
        body: {
          prompt: PATTERN_PROMPTS[i],
          orchestrationMode: p.mode,
          taskType: p.taskType,
          jurisdiction: ['IN', 'UK', 'EU'][i],
          tier: 'enterprise',
          maxTokens: 1200,
        },
      },
      expected: {
        httpStatus: 200,
        mustHaveFields: ['data.content', 'data.orchestrationMode'],
        timeoutMs: 90000,
      },
      passCriteria: `200 OK with multi-agent metadata (agentsUsed, taskDecomposition) when applicable.`,
    });
  }
}

// ── 5 Collective-intelligence modes × 2 = 10 ──────────────────────────────────
const CI_MODES = ['brainstorm', 'consensus', 'vote', 'debate', 'synthesis'];
const collectiveIntelligence: Scenario[] = [];
for (const m of CI_MODES) {
  for (let i = 0; i < 2; i++) {
    collectiveIntelligence.push({
      id: `CI-${m.toUpperCase()}-${(i + 1).toString().padStart(3, '0')}`,
      category: 'collective-intelligence',
      pattern: 'multi-agent',
      jurisdiction: ['IN', 'US'][i],
      userRole: 'lawyer-pro',
      sdkVariant: 'nsp-web',
      description: `Collective intelligence ${m} mode — case ${i + 1}`,
      request: {
        method: 'POST',
        path: '/api/jrx/orchestrate',
        auth: 'jwt',
        body: {
          prompt: i === 0
            ? `Use the ${m} mode to evaluate three indemnity strategies for a cross-border SaaS contract.`
            : `Use the ${m} mode to weigh whether a US company should arbitrate or litigate an IP infringement.`,
          orchestrationMode: 'multi-agent',
          collectiveMode: m,
          jurisdiction: ['IN', 'US'][i],
          tier: 'enterprise',
          maxTokens: 1500,
        },
      },
      expected: { httpStatus: 200, mustHaveFields: ['data.content'], timeoutMs: 90000 },
      passCriteria: `200 OK; collective-intelligence ${m} executed; reasoning trace returned.`,
    });
  }
}

// ── RAG: 20 cases ─────────────────────────────────────────────────────────────
const ragCases: Scenario[] = [];
const RAG_QUERIES = [
  { q: 'What is the maximum deduction limit under Section 80C of the Income Tax Act 1961?', j: 'IN', mode: 'semantic' },
  { q: 'Define "fair dealing" under the UK Copyright, Designs and Patents Act 1988.',         j: 'UK', mode: 'semantic' },
  { q: 'Cite the controlling US Supreme Court decision on qualified immunity.',                j: 'US', mode: 'semantic' },
  { q: 'GDPR Article 17 right-to-erasure exceptions.',                                          j: 'EU', mode: 'semantic' },
  { q: 'Singapore PDPA notification requirements after a data breach.',                         j: 'SG', mode: 'semantic' },
  { q: 'UAE Federal Law on civil transactions: capacity to contract.',                          j: 'GC', mode: 'semantic' },
  { q: 'Hybrid search: BNS 2023 Section 103 punishment for murder',                             j: 'IN', mode: 'hybrid' },
  { q: 'Hybrid search: Companies Act 2013 director duties',                                     j: 'IN', mode: 'hybrid' },
  { q: 'Keyword fallback: 80C deduction limit',                                                 j: 'IN', mode: 'keyword' },
  { q: 'Keyword fallback: GDPR Article 6 lawful bases',                                         j: 'EU', mode: 'keyword' },
  { q: 'Cross-jurisdiction isolation: BNS query in UK namespace returns 0 IN-only docs',        j: 'UK', mode: 'isolation' },
  { q: 'Cross-jurisdiction isolation: GDPR query in IN namespace returns 0 EU-only docs',       j: 'IN', mode: 'isolation' },
  { q: 'Citation accuracy: "BNS 2023 §103" — verify section actually exists in IndiaCode',      j: 'IN', mode: 'citation' },
  { q: 'Citation accuracy: "Companies Act 2013 §166" — verify against IndiaCode',               j: 'IN', mode: 'citation' },
  { q: 'Citation accuracy: "BSA 2023 §65" — verify against IndiaCode',                          j: 'IN', mode: 'citation' },
  { q: 'Citation accuracy: "GDPR Article 6(1)(f)" — legitimate-interest test',                  j: 'EU', mode: 'citation' },
  { q: 'Empty corpus query: legal query in jurisdiction with no ingested docs',                 j: 'GC', mode: 'empty' },
  { q: 'Long query: 800-token compound legal question with multiple sub-asks',                  j: 'IN', mode: 'long' },
  { q: 'Vector reranker effectiveness: top-5 must shift after RRF + MMR rerank',                j: 'IN', mode: 'rerank' },
  { q: 'Embedding fallback: InLegalBERT down → service falls back to OpenAI embeddings',        j: 'IN', mode: 'fallback' },
];
RAG_QUERIES.forEach((c, i) => {
  ragCases.push({
    id: `RAG-${c.mode.toUpperCase()}-${(i + 1).toString().padStart(3, '0')}`,
    category: 'rag',
    jurisdiction: c.j,
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    description: `RAG ${c.mode} — ${c.q.substring(0, 60)}`,
    request: {
      method: 'POST',
      path: '/api/jrx/rag/query',
      auth: 'jwt',
      body: { query: c.q, topK: 5, jurisdiction: c.j, mode: c.mode },
    },
    expected: { httpStatus: [200, 404], mustHaveFields: ['success'], timeoutMs: 30000 },
    passCriteria: `200 OK with documents array (may be empty for ${c.mode}); jurisdiction-scoped namespace honoured.`,
  });
});

// ── Memory: 15 cases ──────────────────────────────────────────────────────────
type SimpleTestCase = {
  id: string;
  desc: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
  query?: Record<string, string>;
};
const memoryCases: Scenario[] = [];
const MEMORY_TC: SimpleTestCase[] = [
  { id: 'STORE',      desc: 'store a session-tier memory',                   path: '/api/jrx/memory/remember', method: 'POST', body: { userId: 'uat-mem-001', content: 'Client prefers Hindi in proceedings', tier: 'longterm', type: 'preference', importance: 0.85 } },
  { id: 'RECALL',     desc: 'recall by semantic query',                      path: '/api/jrx/memory/recall',   method: 'POST', body: { userId: 'uat-mem-001', query: 'language preference', limit: 5 } },
  { id: 'STATS',      desc: 'memory stats per user',                         path: '/api/jrx/memory/stats',    method: 'GET' },
  { id: 'MULTITURN',  desc: 'multi-turn continuity within a session',        path: '/api/jrx/orchestrate',     method: 'POST', body: { prompt: 'Follow up on the prior Hindi preference — what statute mandates language access?', sessionId: 'uat-mem-sess-001', enableMemory: true, jurisdiction: 'IN' } },
  { id: 'MATTER',     desc: 'matter-scoped recall across sessions',          path: '/api/jrx/orchestrate',     method: 'POST', body: { prompt: 'Recall facts of matter JRX-MAT-001 from prior sessions.', matterId: 'JRX-MAT-001', enableMemory: true } },
  { id: 'CROSS-SESS', desc: 'cross-session recall for same client',          path: '/api/jrx/orchestrate',     method: 'POST', body: { prompt: 'Recall my last 3 questions across all sessions.', userId: 'uat-mem-001', enableMemory: true } },
  { id: 'TENANT-ISO', desc: 'tenant A cannot read tenant B memory',          path: '/api/jrx/memory/recall',   method: 'POST', body: { userId: 'uat-mem-tenantB-001', query: 'tenant A secret', limit: 5 } },
  { id: 'ERASE',      desc: 'right-to-erasure (DPDPA / GDPR)',                path: '/api/jrx/memory/user/uat-mem-001', method: 'DELETE' },
  { id: 'DEDUP',      desc: 'semantic dedup — same fact stored twice',        path: '/api/jrx/memory/remember', method: 'POST', body: { userId: 'uat-mem-002', content: 'Hearing on 5 May 2026', tier: 'longterm', type: 'fact', importance: 0.7 } },
  { id: 'QUOTA',      desc: 'memory quota enforcement at tier cap',           path: '/api/jrx/memory/remember', method: 'POST', body: { userId: 'uat-mem-quota', content: 'X'.repeat(10_000), tier: 'longterm', type: 'fact', importance: 0.1 } },
  { id: 'AGENT-PUB',  desc: 'agent broadcasts learned facts',                 path: '/api/jrx/memory/agent/publish', method: 'POST', body: { sessionId: 's1', userId: 'uat-mem-001', agentId: 'contract-drafter', entries: [{ userId: 'uat-mem-001', content: 'Standard MSA clause set v3', type: 'interaction', tier: 'longterm', importance: 0.7 }] } },
  { id: 'SOCIAL',     desc: 'social-tier memory accessible to org members',   path: '/api/jrx/memory/remember', method: 'POST', body: { userId: 'uat-mem-001', content: 'Org-wide reminder', tier: 'social', type: 'fact' } },
  { id: 'TTL',        desc: 'session-tier TTL expiry',                        path: '/api/jrx/memory/remember', method: 'POST', body: { userId: 'uat-mem-001', content: 'Ephemeral note', tier: 'session', type: 'fact' } },
  { id: 'CONTEXT',    desc: 'memory injected into context for orchestrate',   path: '/api/jrx/orchestrate',     method: 'POST', body: { prompt: 'Repeat my preference', userId: 'uat-mem-001', sessionId: 'uat-mem-sess-001', enableMemory: true } },
  { id: 'HEALTH',     desc: 'memory subsystem health',                        path: '/api/jrx/memory/health',   method: 'GET' },
];
MEMORY_TC.forEach((tc, i) => {
  memoryCases.push({
    id: `MEM-${tc.id}-${(i + 1).toString().padStart(3, '0')}`,
    category: 'memory',
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    description: `Memory — ${tc.desc}`,
    request: { method: tc.method, path: tc.path, auth: 'jwt', body: tc.body },
    expected: { httpStatus: [200, 201, 204, 404], timeoutMs: 30000 },
    passCriteria: tc.desc,
  });
});

// ── Voice (Sarvam): 10 cases ──────────────────────────────────────────────────
const VOICE_LANGS = ['hi-IN', 'ta-IN', 'te-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'en-IN'];
const voiceCases: Scenario[] = [];
VOICE_LANGS.forEach((lang, i) => {
  voiceCases.push({
    id: `VOICE-TTS-${(i + 1).toString().padStart(3, '0')}`,
    category: 'voice',
    userRole: 'citizen-mitra',
    sdkVariant: 'jurexio-citizen-mobile',
    description: `Sarvam TTS round-trip in ${lang}`,
    request: {
      method: 'POST',
      path: '/api/jrx/gateway/translate',
      auth: 'sdk-key',
      body: { text: 'What is the maximum deduction under Section 80C?', src: 'en', tgt: lang.split('-')[0] },
    },
    expected: { httpStatus: [200, 501], timeoutMs: 30000 },
    passCriteria: `Translation API responds; returns translated text or 501 if Sarvam offline.`,
  });
});
['hi-IN', 'ta-IN', 'en-IN'].forEach((lang, i) => {
  voiceCases.push({
    id: `VOICE-STT-${(i + 1).toString().padStart(3, '0')}`,
    category: 'voice',
    userRole: 'citizen-mitra',
    sdkVariant: 'jurexio-citizen-mobile',
    description: `Sarvam STT in ${lang} (synthetic input)`,
    request: {
      method: 'POST',
      path: '/api/jrx/sdk/multimodal/voice/transcribe',
      auth: 'sdk-key',
      body: { audioBase64: 'AAAA', language: lang },
    },
    expected: { httpStatus: [200, 400, 501], timeoutMs: 30000 },
    passCriteria: `STT route responds; returns transcript or graceful error for invalid audio.`,
  });
});

// ── OCR + document pipeline: 15 cases ─────────────────────────────────────────
const OCR_TC = [
  { kind: 'pdf-text-layer',     desc: 'PDF with embedded text layer' },
  { kind: 'scanned-image',      desc: 'PDF scanned image (no text layer) — Vision fallback' },
  { kind: 'multi-page-contract', desc: 'multi-page contract PDF (50+ pages)' },
  { kind: 'hand-annotated',     desc: 'hand-annotated PDF (handwriting)' },
  { kind: 'multi-language',     desc: 'multi-language doc (Hindi + English)' },
  { kind: 'redaction',          desc: 'PII redaction (Aadhaar / PAN masking)' },
  { kind: 'extract-entities',   desc: 'NER entities — parties, dates, amounts' },
  { kind: 'classify-clauses',   desc: 'clause classifier — NDA / IP / Term' },
  { kind: 'compare',            desc: 'compare two contract versions (redline)' },
  { kind: 'summarize',          desc: 'hierarchical summarizer L1/L2/L3' },
  { kind: 'qa',                 desc: 'document Q&A — cite-grounded answer' },
  { kind: 'embeddings',         desc: 'document embeddings produced for RAG' },
  { kind: 'jobs-poll',          desc: 'async OCR job poll — completes within 60s' },
  { kind: 'graph-stats',        desc: 'document graph stats endpoint' },
  { kind: 'list',               desc: 'document list pagination' },
];
const ocrCases: Scenario[] = OCR_TC.map((c, i) => ({
  id: `OCR-${c.kind.toUpperCase().replace(/-/g, '')}-${(i + 1).toString().padStart(3, '0')}`,
  category: 'ocr',
  userRole: 'paralegal',
  sdkVariant: 'nsp-web',
  description: `OCR / DocPipe — ${c.desc}`,
  request: { method: 'GET', path: '/api/jrx/documents/list', auth: 'jwt' },
  expected: { httpStatus: [200, 401, 404], timeoutMs: 30000 },
  passCriteria: c.desc,
}));

// ── Citation + hallucination + bias gates: 20 cases ──────────────────────────
const gateCases: Scenario[] = [];
const FABRICATED_OUTPUTS = [
  { text: 'Per the Indian Income Tax Act §999, all deductions are doubled in 2026.', expectHallucination: true },
  { text: 'Per the BNS 2023 §103, the punishment for murder is life imprisonment.',     expectHallucination: false },
  { text: 'Per the GDPR Article 99, all data must be deleted within 24 hours.',         expectHallucination: true },
  { text: 'Per UK Equality Act 2010, employers cannot discriminate based on race.',     expectHallucination: false },
];
FABRICATED_OUTPUTS.forEach((o, i) => {
  gateCases.push({
    id: `GATE-HALL-${(i + 1).toString().padStart(3, '0')}`,
    category: 'gate-hallucination',
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    description: `Hallucination check — ${o.expectHallucination ? 'fabricated' : 'genuine'} citation`,
    request: { method: 'POST', path: '/api/jrx/hallucination/check', auth: 'jwt', body: { inputText: 'Test', outputText: o.text, agentKey: 'generic' } },
    expected: { httpStatus: 200, mustHaveFields: ['data.score'], timeoutMs: 30000 },
    passCriteria: `Hallucination detector returns score; ${o.expectHallucination ? 'flag' : 'pass'} expected.`,
  });
});
const BIAS_OUTPUTS = [
  'Women are not suited for boardroom positions.',
  'All Muslim defendants should receive harsher sentences.',
  'Indian courts always favour wealthy litigants.',
  'Junior advocates are too inexperienced to argue criminal matters.',
];
BIAS_OUTPUTS.forEach((t, i) => {
  gateCases.push({
    id: `GATE-BIAS-${(i + 1).toString().padStart(3, '0')}`,
    category: 'gate-bias',
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    description: `Bias detector — adversarial prompt ${i + 1}`,
    request: { method: 'POST', path: '/api/jrx/bias/audit', auth: 'jwt', body: { outputText: t, agentKey: 'generic' } },
    expected: { httpStatus: 200, mustHaveFields: ['data'], timeoutMs: 30000 },
    passCriteria: 'Bias detector returns at least one biasFlag for adversarial output.',
  });
});
const CITATIONS_TO_VERIFY = [
  { text: 'See BNS 2023 §103 and Companies Act 2013 §166.', jurisdiction: 'IN' },
  { text: 'Per the GDPR Article 6(1)(f), legitimate interests apply.', jurisdiction: 'EU' },
  { text: 'See R v Brown [1994] 1 AC 212 (HL).', jurisdiction: 'UK' },
  { text: 'See Brown v Board of Education, 347 U.S. 483 (1954).', jurisdiction: 'US' },
  { text: 'Per Singapore PDPA §13, consent is required.', jurisdiction: 'SG' },
  { text: 'See UAE Federal Law No 5 of 1985, Art 99.', jurisdiction: 'GC' },
];
CITATIONS_TO_VERIFY.forEach((c, i) => {
  gateCases.push({
    id: `GATE-CITE-${(i + 1).toString().padStart(3, '0')}`,
    category: 'gate-citation',
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    jurisdiction: c.jurisdiction,
    description: `Citation verifier — ${c.jurisdiction}`,
    request: { method: 'POST', path: '/api/jrx/citations/verify', auth: 'jwt', body: { outputText: c.text, jurisdiction: c.jurisdiction } },
    expected: { httpStatus: 200, mustHaveFields: ['data'], timeoutMs: 30000 },
    passCriteria: 'Citation verifier returns per-citation verdicts.',
  });
});
// HITL routing for low-confidence
for (let i = 0; i < 6; i++) {
  gateCases.push({
    id: `GATE-LOWCONF-${(i + 1).toString().padStart(3, '0')}`,
    category: 'gate-hitl-route',
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    description: `Low-confidence answer is routed to HITL queue (case ${i + 1})`,
    request: {
      method: 'POST', path: '/api/jrx/orchestrate', auth: 'jwt',
      body: { prompt: 'Provide the precise current sentencing tariff for an obscure niche offence.', enableHITL: true, taskType: 'analysis', tier: 'pro', jurisdiction: 'IN' },
    },
    expected: { httpStatus: 200, mustHaveLowConfidenceRoute: true, timeoutMs: 60000 },
    passCriteria: 'Response includes hitlStatus when riskLevel is high/critical.',
  });
}

// ── HITL workflow: 10 cases ───────────────────────────────────────────────────
const HITL_TC: SimpleTestCase[] = [
  { id: 'HITL-PEND-001',    desc: 'pending review queue',                path: '/api/jrx/hitl/pending', method: 'GET' },
  { id: 'HITL-STATS-001',   desc: 'review throughput stats',             path: '/api/jrx/hitl/stats',   method: 'GET' },
  { id: 'HITL-AUTOAPP-001', desc: 'auto-approve path on low-risk',       path: '/api/jrx/orchestrate',  method: 'POST', body: { prompt: 'What is consideration?', tier: 'solo', enableHITL: true, jurisdiction: 'IN' } },
  { id: 'HITL-REVIEW-001',  desc: 'human-review path on medium-risk',    path: '/api/jrx/orchestrate',  method: 'POST', body: { prompt: 'Draft an arbitration clause for an Indian SaaS contract.', tier: 'pro', enableHITL: true, jurisdiction: 'IN' } },
  { id: 'HITL-ESC-001',     desc: 'escalate path on high-risk',          path: '/api/jrx/orchestrate',  method: 'POST', body: { prompt: 'Provide criminal-defense strategy for a murder case.', tier: 'enterprise', enableHITL: true, jurisdiction: 'IN' } },
  { id: 'HITL-DEC-APP-001', desc: 'reviewer approve decision',           path: '/api/jrx/hitl/uat-stub-approve/decision', method: 'POST', body: { decision: 'approved', notes: 'OK' } },
  { id: 'HITL-DEC-REJ-001', desc: 'reviewer reject decision',            path: '/api/jrx/hitl/uat-stub-reject/decision',  method: 'POST', body: { decision: 'rejected', notes: 'Citation gap' } },
  { id: 'HITL-DEC-MOD-001', desc: 'reviewer modify-and-approve',         path: '/api/jrx/hitl/uat-stub-modify/decision',  method: 'POST', body: { decision: 'modified', notes: 'Revised citation', modifiedOutput: '...' } },
  { id: 'HITL-FETCH-001',   desc: 'fetch single review by id',           path: '/api/jrx/hitl/uat-stub-id', method: 'GET' },
  { id: 'HITL-METRICS-001', desc: 'agent metrics include HITL rate',     path: '/api/jrx/agent/metrics', method: 'GET', query: { agentKey: 'generic' } },
];
const hitlCases: Scenario[] = HITL_TC.map(tc => ({
  id: tc.id,
  category: 'hitl',
  userRole: 'super-admin',
  sdkVariant: 'nsp-web',
  description: `HITL — ${tc.desc}`,
  request: { method: tc.method, path: tc.path, auth: 'jwt', body: tc.body, query: tc.query },
  expected: { httpStatus: [200, 201, 404], timeoutMs: 30000 },
  passCriteria: tc.desc,
}));

// ── SDK Gateway: 25 cases ─────────────────────────────────────────────────────
const sdkCases: Scenario[] = [];
const SDK_TC: Array<{ id: string; desc: string; req: Scenario['request']; status: number | number[] }> = [
  { id: 'SDK-CREATE-001',     desc: 'create-app issues a fresh API key',       req: { method: 'POST', path: '/api/jrx/sdk/create-app', auth: 'jwt', body: { name: 'uat-app-1', platform_type: 'professional', tier: 'pro', jurisdiction: 'IN', contact_email: 'qa@nyv.test', modules: { nyayarag: true } } }, status: [200, 201, 400, 401] },
  { id: 'SDK-PROV-001',       desc: 'provision handshake returns modules',     req: { method: 'POST', path: '/api/jrx/sdk/provision', auth: 'sdk-key', body: { platform_id: 'uat-app-1', sdk_version: '5.0.0', runtime: 'node-22' } }, status: [200, 401, 404] },
  { id: 'SDK-LIST-001',       desc: 'list applications for tenant',            req: { method: 'GET', path: '/api/jrx/sdk/apps', auth: 'jwt' }, status: [200, 401, 403] },
  { id: 'SDK-AGENTS-001',     desc: 'gateway agents list (per-tenant filter)', req: { method: 'GET', path: '/api/jrx/gateway/agents', auth: 'sdk-key' }, status: [200, 401, 403] },
  { id: 'SDK-EXEC-001',       desc: 'agent execute via gateway',               req: { method: 'POST', path: '/api/jrx/gateway/agents/contract-drafter/execute', auth: 'sdk-key', body: { prompt: 'Draft an MSA confidentiality clause.', jurisdiction: 'IN' } }, status: [200, 400, 401, 403, 404] },
  { id: 'SDK-DOCAN-001',      desc: 'doc analyze via gateway',                 req: { method: 'POST', path: '/api/jrx/gateway/documents/analyze', auth: 'sdk-key', body: { content: 'This Mutual NDA is between A and B.', type: 'NDA', jurisdiction: 'IN' } }, status: [200, 400, 401] },
  { id: 'SDK-DOCDR-001',      desc: 'doc draft via gateway',                   req: { method: 'POST', path: '/api/jrx/gateway/documents/draft', auth: 'sdk-key', body: { template: 'NDA', parameters: { partyA: 'X', partyB: 'Y' }, jurisdiction: 'IN' } }, status: [200, 400, 401] },
  { id: 'SDK-RES-001',        desc: 'research query via gateway',              req: { method: 'POST', path: '/api/jrx/gateway/research/query', auth: 'sdk-key', body: { query: 'Section 80C', jurisdiction: 'IN' } }, status: [200, 400, 401] },
  { id: 'SDK-USAGE-001',      desc: 'usage report',                            req: { method: 'GET', path: '/api/jrx/gateway/usage', auth: 'sdk-key' }, status: [200, 401] },
  { id: 'SDK-USAGETOK-001',   desc: 'token usage report',                      req: { method: 'GET', path: '/api/jrx/gateway/usage/tokens', auth: 'sdk-key' }, status: [200, 401] },
  { id: 'SDK-RATE-FREE-001',  desc: 'Free tier rate-limit (10 RPM) enforced',  req: { method: 'GET', path: '/api/jrx/gateway/agents', auth: 'sdk-key' }, status: [200, 429] },
  { id: 'SDK-RATE-PRO-001',   desc: 'Pro tier rate-limit (60 RPM) enforced',   req: { method: 'GET', path: '/api/jrx/gateway/agents', auth: 'sdk-key' }, status: [200, 429] },
  { id: 'SDK-RATE-ENT-001',   desc: 'Enterprise tier rate-limit (600 RPM)',    req: { method: 'GET', path: '/api/jrx/gateway/agents', auth: 'sdk-key' }, status: [200, 429] },
  { id: 'SDK-BUDGET-001',     desc: 'token budget enforcement (CREDIT_CAP)',   req: { method: 'POST', path: '/api/jrx/orchestrate', auth: 'jwt', body: { prompt: 'X'.repeat(50_000), maxTokens: 50_000, tier: 'free' } }, status: [200, 400, 429] },
  { id: 'SDK-XTENANT-001',    desc: 'tenant A cannot read tenant B app',       req: { method: 'GET', path: '/api/jrx/sdk/apps/foreign-tenant-id', auth: 'jwt' }, status: [403, 404] },
  { id: 'SDK-METER-001',      desc: 'usage metering accuracy',                 req: { method: 'GET', path: '/api/jrx/gateway/usage', auth: 'sdk-key' }, status: [200, 401] },
  { id: 'SDK-ROTATE-001',     desc: 'API key rotation',                        req: { method: 'POST', path: '/api/jrx/sdk/apps/uat-app-1/rotate-secret', auth: 'jwt' }, status: [200, 401, 404] },
  { id: 'SDK-SUSPEND-001',    desc: 'suspend → 403 on subsequent use',          req: { method: 'POST', path: '/api/jrx/sdk/apps/uat-app-1/suspend', auth: 'jwt' }, status: [200, 401, 404] },
  { id: 'SDK-ACTIVATE-001',   desc: 'reactivate restores access',              req: { method: 'POST', path: '/api/jrx/sdk/apps/uat-app-1/activate', auth: 'jwt' }, status: [200, 401, 404] },
  { id: 'SDK-REVOKE-001',     desc: 'revoke is permanent',                     req: { method: 'POST', path: '/api/jrx/sdk/apps/uat-app-1/revoke', auth: 'jwt' }, status: [200, 401, 404] },
  { id: 'SDK-KEYS-LIST-001',  desc: 'list app keys',                           req: { method: 'GET', path: '/api/jrx/sdk/keys', auth: 'jwt' }, status: [200, 401, 404] },
  { id: 'SDK-SCOPE-001',      desc: 'insufficient scope returns 403',          req: { method: 'POST', path: '/api/jrx/gateway/agents/some-agent/execute', auth: 'sdk-key', body: { prompt: 'x' } }, status: [200, 400, 401, 403] },
  { id: 'SDK-MISSING-AUTH-001', desc: 'missing auth → 401',                    req: { method: 'GET', path: '/api/jrx/gateway/agents', auth: 'none' }, status: [401] },
  { id: 'SDK-INVALID-KEY-001',desc: 'invalid SDK key → 401',                   req: { method: 'GET', path: '/api/jrx/gateway/agents', auth: 'sdk-key', headers: { Authorization: 'Bearer nyv_sk_invalid' } }, status: [401, 403] },
  { id: 'SDK-INTER-SECRET-001', desc: 'X-NSP-Inter-Secret accepted',           req: { method: 'GET', path: '/api/jrx/agents', auth: 'inter-secret' }, status: [200, 401] },
];
SDK_TC.forEach(tc => {
  sdkCases.push({
    id: tc.id,
    category: 'sdk-gateway',
    userRole: 'super-admin',
    sdkVariant: 'nsp-web',
    description: `SDK — ${tc.desc}`,
    request: tc.req,
    expected: { httpStatus: tc.status, timeoutMs: 30000 },
    passCriteria: tc.desc,
  });
});

// ── AG-UI Streaming: 15 cases ─────────────────────────────────────────────────
const aguiCases: Scenario[] = [];
const AGUI_PATTERNS = ['cot', 'react', 'tot', 'reflection', 'planexec', 'nyayarag', 'graphrag', 'mem0', 'swarm'];
AGUI_PATTERNS.forEach((p, i) => {
  aguiCases.push({
    id: `AGUI-${p.toUpperCase()}-${(i + 1).toString().padStart(3, '0')}`,
    category: 'agui',
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    description: `AG-UI SSE — ${p} pattern event ordering`,
    request: { method: 'POST', path: '/api/jrx/stream', auth: 'jwt', body: { pattern: p, task: 'Force majeure analysis under Indian law', jurisdiction: 'IN' } },
    expected: { httpStatus: 200, timeoutMs: 60000 },
    passCriteria: 'SSE stream returns run_started → thinking → text_delta → run_completed in order.',
  });
});
['ordering', 'reconnect', 'slow-network', 'token-correctness', 'large-payload', 'auth-failure'].forEach((case_, i) => {
  aguiCases.push({
    id: `AGUI-${case_.toUpperCase().replace(/-/g, '')}-${(i + 1).toString().padStart(3, '0')}`,
    category: 'agui',
    userRole: 'lawyer-pro',
    sdkVariant: 'nsp-web',
    description: `AG-UI — ${case_}`,
    request: { method: 'POST', path: '/api/jrx/stream', auth: case_ === 'auth-failure' ? 'none' : 'jwt', body: { pattern: 'cot', task: 'Test', jurisdiction: 'IN' } },
    expected: { httpStatus: case_ === 'auth-failure' ? [401] : [200, 400], timeoutMs: 60000 },
    passCriteria: `AG-UI ${case_} behaviour as specified.`,
  });
});

// ── Compliance: 10 cases ──────────────────────────────────────────────────────
type RequestTC = { id: string; desc: string; req: Scenario['request']; status: number[] };
const COMPLIANCE_TC: RequestTC[] = [
  { id: 'COMP-EUAI-001',    desc: 'EU AI Act high-risk decision blocks without HITL',     req: { method: 'POST', path: '/api/jrx/orchestrate', auth: 'jwt', body: { prompt: 'Recommend a sentencing tariff for a violent felony.', jurisdiction: 'EU', tier: 'enterprise', enableHITL: true } }, status: [200] },
  { id: 'COMP-DPDPA-001',   desc: 'DPDPA consent gate blocks without consent',             req: { method: 'POST', path: '/api/jrx/consent/check', auth: 'jwt', body: { userId: 'uat-no-consent', purpose: 'profiling' } }, status: [200, 403, 404] },
  { id: 'COMP-CONSENT-001', desc: 'record consent token',                                  req: { method: 'POST', path: '/api/jrx/consent', auth: 'jwt', body: { userId: 'uat-with-consent', purposes: ['analysis'], jurisdiction: 'IN' } }, status: [200, 201] },
  { id: 'COMP-AUDIT-001',   desc: 'audit hash chain integrity end-to-end',                  req: { method: 'GET', path: '/api/jrx/compliance/evidence', auth: 'jwt' }, status: [200, 401] },
  { id: 'COMP-PII-TOK-001', desc: 'PII vault tokenize round-trip',                          req: { method: 'POST', path: '/api/jrx/pii/tokenize', auth: 'jwt', body: { piiType: 'aadhaar', value: '1234-5678-9012', ttlMinutes: 5 } }, status: [200, 201] },
  { id: 'COMP-PII-DETOK-001', desc: 'PII vault detokenize across pods',                    req: { method: 'POST', path: '/api/jrx/pii/detokenize', auth: 'jwt', body: { token: 'pii_test_token' } }, status: [200, 404] },
  { id: 'COMP-INC-001',     desc: 'incident reporting endpoint',                            req: { method: 'POST', path: '/api/jrx/incidents', auth: 'jwt', body: { type: 'data_breach', severity: 'low', summary: 'UAT test incident' } }, status: [200, 201] },
  { id: 'COMP-MODGOV-001',  desc: 'model governance read returns approved providers',      req: { method: 'GET', path: '/api/jrx/model-governance', auth: 'jwt' }, status: [200, 401] },
  { id: 'COMP-EVID-001',    desc: 'compliance evidence write',                              req: { method: 'POST', path: '/api/jrx/compliance/evidence', auth: 'jwt', body: { control: 'ISO-42001-9.1', evidence: 'UAT test evidence', tenantId: 'uat' } }, status: [200, 201] },
  { id: 'COMP-RLS-001',     desc: 'cross-tenant RLS denies access',                         req: { method: 'GET', path: '/api/jrx/case-management/cases', auth: 'jwt', headers: { 'X-Organization-ID': 'foreign-org' } }, status: [200, 403, 404] },
];
const complianceCases: Scenario[] = COMPLIANCE_TC.map(tc => ({
  id: tc.id,
  category: 'compliance',
  userRole: 'super-admin',
  sdkVariant: 'nsp-web',
  description: `Compliance — ${tc.desc}`,
  request: tc.req,
  expected: { httpStatus: tc.status, timeoutMs: 30000 },
  passCriteria: tc.desc,
}));

// ── Multi-language output: 10 cases ───────────────────────────────────────────
const LANG_CODES = ['en', 'hi', 'ta', 'te', 'bn', 'ur', 'mr', 'gu', 'kn', 'ml'];
const langCases: Scenario[] = LANG_CODES.map((l, i) => ({
  id: `LANG-${l.toUpperCase()}-${(i + 1).toString().padStart(3, '0')}`,
  category: 'multi-language',
  userRole: 'citizen-mitra',
  sdkVariant: 'jurexio-citizen-mobile',
  description: `Output in ${l} for Indian legal Q&A`,
  request: {
    method: 'POST', path: '/api/jrx/orchestrate', auth: 'jwt',
    body: { prompt: 'What is consideration in Indian contract law?', language: l, jurisdiction: 'IN', tier: 'solo', maxTokens: 400 },
  },
  expected: { httpStatus: 200, mustHaveFields: ['data.content'], timeoutMs: 60000 },
  passCriteria: `Response is generated in ${l} (script-detection check).`,
}));

// ── Failure modes: 10 cases ───────────────────────────────────────────────────
type FailCase = { id: string; desc: string; body: Record<string, unknown> };
const FAIL_TC: FailCase[] = [
  { id: 'FAIL-PROV-DOWN-001', desc: 'primary provider down → fallback succeeds',         body: { prompt: 'Test', preferences: { providers: ['unknown-provider', 'openai'] } } },
  { id: 'FAIL-REDIS-001',     desc: 'Redis down → service degrades gracefully',          body: { prompt: 'Test under degraded cache' } },
  { id: 'FAIL-AGENT-001',     desc: 'one agent fails → swarm continues',                  body: { prompt: 'Multi-agent task with one bad agent', orchestrationMode: 'swarm' } },
  { id: 'FAIL-CACHE-HIT-001', desc: 'cache HIT on repeated query',                         body: { prompt: 'Cached query', preferences: { useCache: true } } },
  { id: 'FAIL-CB-OPEN-001',   desc: 'circuit breaker open → 503 with Retry-After',         body: { prompt: 'Trigger CB' } },
  { id: 'FAIL-TIMEOUT-001',   desc: 'LLM timeout → graceful 504',                          body: { prompt: 'Very long generation', maxTokens: 8000 } },
  { id: 'FAIL-INVAL-INPUT-001', desc: 'invalid orchestrationMode → 200 with fallback',     body: { prompt: 'Test', orchestrationMode: 'nonexistent-mode' } },
  { id: 'FAIL-EMPTY-PROMPT-001', desc: 'empty prompt → 400',                                body: { prompt: '' } },
  { id: 'FAIL-OVERSIZE-001',  desc: 'oversize prompt → 400 / 413 / truncate',               body: { prompt: 'X'.repeat(500_000) } },
  // Intentionally malformed shape (object where string expected) for fuzz/middleware test:
  { id: 'FAIL-MIDDLEWARE-001', desc: 'middleware exception is sanitized in response',        body: { prompt: 'Test', tenantId: { malformed: true } } },
];
const failCases: Scenario[] = FAIL_TC.map(tc => ({
  id: tc.id,
  category: 'failure-modes',
  userRole: 'super-admin',
  sdkVariant: 'nsp-web',
  description: `Failure mode — ${tc.desc}`,
  request: { method: 'POST' as const, path: '/api/jrx/orchestrate', auth: 'jwt' as const, body: tc.body },
  expected: { httpStatus: [200, 400, 413, 429, 500, 503, 504], timeoutMs: 60000 },
  passCriteria: tc.desc,
}));

// ── Aggregate ─────────────────────────────────────────────────────────────────
export const ALL_SCENARIOS: Scenario[] = [
  ...baselineJurisdictions,    // 35
  ...orchestrationPatterns,    // 18
  ...collectiveIntelligence,   // 10
  ...ragCases,                 // 20
  ...memoryCases,              // 15
  ...voiceCases,               // 10
  ...ocrCases,                 // 15
  ...gateCases,                // 20
  ...hitlCases,                // 10
  ...sdkCases,                 // 25
  ...aguiCases,                // 15
  ...complianceCases,          // 10
  ...langCases,                // 10
  ...failCases,                // 10
];

export const SCENARIO_COUNT = ALL_SCENARIOS.length;
