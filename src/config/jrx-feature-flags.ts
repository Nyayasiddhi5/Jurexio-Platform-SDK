/**
 * Jurexio Enterprise Platform SDK v5.0.0 — Phase C feature flags
 *
 * All flags read from environment variables and default to OFF, so
 * pre-existing behavior is preserved on any host that does not opt in.
 *
 * To enable a feature, set the corresponding env var to '1' or 'true'.
 *
 * JRX_F_AUDIT_WIRE       T-01  Append IronLedger audit row on /orchestrate completion
 * JRX_F_HITL_REGISTRY    T-03/T-04/T-05  Registry-driven HITL thresholds + reviewer routing + auto-approve audit
 * JRX_F_PII_JCN          T-06b Append jurisdiction-scoped PII regexes to safety pipeline Step 1
 * JRX_F_SECURITY_MONITOR T-08  Mount nv-security-monitor middleware on /api/jrx/*
 *
 * The two flags below are reserved for future phases and currently unused
 * by the in-tree code; they are listed here so that operators have a single
 * source of truth.
 *
 * JRX_F_CITATION_WIRE    Reserved (citation grounding is already wired at
 *                        nv-orchestration-routes.ts:254 — flag retained for
 *                        future variant routing)
 * JRX_F_TOKEN_OPT        Token-optimization ADVISORY surface (Session-16,
 *                        2026-06-02 unification). Previously documented
 *                        "reserved/Phase D" while the advisory token-opt
 *                        service shipped live via the v311 routes — that
 *                        inconsistency is now resolved. Coherent surface:
 *                          • JRX_F_TOKEN_OPT  → ADVISORY token shaping
 *                            (budget estimate, context compression, pricing
 *                            lookup) exposed read-only via /api/.../v311/
 *                            tokens/* (nyayavigya-token-optimization-service).
 *                            Advisory only — never denies a request.
 *                          • JRX_F_GOV_COST_OPT → ENFORCEMENT (pre-LLM budget
 *                            gate + post-LLM token deduction in the queen
 *                            orchestrator) + admin reads at
 *                            /api/nv5/gov/cost-optimizer/* (nv-cost-
 *                            optimization-suite). This is the lever that can
 *                            actually shape/deny spend.
 *                        The v311 /tokens/* endpoints remain always-on
 *                        (additive contract, no removal); the flag is the
 *                        documented signal the Console renders for the
 *                        advisory posture.
 */

// Task #114 — overlay store consulted before env so super-admins can flip
// flags from the Console without shell access. The overlay module is loaded
// lazily so we don't introduce a hard dependency cycle if it's imported
// before the DB layer is ready; failures fall through to env-only behaviour.
// Until the gateway wires the overlay (`wireFlagOverlayLookup()` is called
// from src/index.ts after `initFlagOverrides()` finishes hydrating the
// cache), this stays null and `flagOn` behaves exactly as before
// (env-only) — guaranteeing no behaviour change on cold start.
let _overlayLookup: ((logical: string) => boolean | undefined) | null = null;

/**
 * Wire the overlay lookup. Called once during gateway boot from
 * `src/index.ts` after `initFlagOverrides()` finishes hydrating the cache.
 * Idempotent — last writer wins. Pass `null` to detach (used by tests).
 */
export function wireFlagOverlayLookup(
  fn: ((logical: string) => boolean | undefined) | null,
): void {
  _overlayLookup = fn;
}

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envFlagExplicitlyOff(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

/**
 * F-002 fix (Session-15 v11, 2026-05-11). Flags listed here default to ON
 * in non-development environments when their JRX_F_* env var is unset,
 * while still honoring explicit opt-out (`=0|false|no|off`).
 *
 * Rationale: the audit-hash-chain step of NV-ARCH-001's safety ring is
 * a compliance-critical step. Defaulting OFF in production silently
 * weakens the no-bypass invariant (Verification Audit F-002). Per user
 * mandate ("don't leave any gaps"), audit-wire now defaults ON for any
 * `NODE_ENV !== 'development'`. Dev keeps default OFF so test runs and
 * UAT harnesses without the audit table provisioned still pass.
 *
 * Add new entries here only after verifying that the underlying code
 * path is fail-soft (i.e. its failure does not break orchestration).
 *
 * ── Session-16 (2026-06-02) — differentiated-capability default-on pass ──
 * Each flag below was verified fail-soft before being added (CTO P1 task).
 * Dev/test keep these OFF so local UAT harnesses without DB/Redis/keys are
 * unchanged; only NODE_ENV not in {'', development, test} flips them ON, and
 * an explicit JRX_F_*=0|false|no|off still wins. The snapshot contract is
 * preserved: getNyvFeatureFlagSnapshot() resolves these the same way (source
 * attributed to 'default'), so Console observability never drifts from runtime.
 *
 *   govConcurrency   — per-tenant semaphore (default 16) wrapped around the
 *                      synthesis dispatch in the queen orchestrator; FIFO
 *                      backpressure, no daemon. Read snapshot at
 *                      /api/nv5/gov/concurrency/snapshot.
 *   govCostOpt       — in-memory advisory token budget (1M/user default, fail
 *                      OPEN on infra error). Pre/post LLM hooks in the queen
 *                      orchestrator + admin reads at /api/nv5/gov/cost-optimizer/*.
 *   govSecurityMon   — cross-session injection-attack monitor middleware. Only
 *                      acts on requests already flagged for injection; blocks
 *                      ONLY past a repeat threshold; fails OPEN without Redis;
 *                      never throws. Boot-mounted on /api/jrx/*.
 *   legalPipeline*   — 5 read-only deterministic admin sub-routers under
 *   compliance*      — 3 read-only admin sub-routers under
 *   internalSurface  — read-only admin /capabilities surface. All SDK-key +
 *                      admin-scope gated; ZERO LLM emission (NV-LLM-001/ARCH-001).
 *
 *   hitlRegistry     — registry-driven HITL thresholds + reviewer routing +
 *                      auto-approve audit (T-03/T-04/T-05). Fail-soft: when
 *                      off, workflows still run with legacy PA thresholds.
 *                      Default ON in non-dev (2026-07-14 enterprise governance pass).
 *
 * Deliberately LEFT OFF in dev / non-enterprise (documented gate to enable):
 *   govMakerChecker  — runs an extra synthesis-verification loop on EVERY
 *                      orchestration. The deterministic checker (threshold
 *                      0.85) can reject when a response omits the literal first
 *                      prompt token → triggers a re-synthesis LLM call, an
 *                      unpredictable cost/latency increase. SME flows already
 *                      force it per-request via metadata.forceMakerChecker.
 *                      Default ON for enterprise pack hosts only
 *                      (`NYV_ENTERPRISE_TIER=1` or `NYV_PACK=enterprise|government`);
 *                      otherwise gate via JRX_F_GOV_MAKER_CHECKER=1 or DB overlay.
 *   govOrgRatelimit  — adds a 30 req/min PER-ORG cap (DB-driven) on top of the
 *                      existing public/authenticated limiters; blast radius
 *                      includes Console traffic, and the mount is boot-time
 *                      (needs a gateway restart, not just an overlay flip).
 *                      Gate: set ns_schema.organisations.ai_rate_limit per org,
 *                      then JRX_F_GOV_ORG_RATELIMIT=1 + restart.
 */
import { shouldDefaultOnEnterprisePack } from './jrx-enterprise-governance-defaults.js';

const FLAG_DEFAULT_ON_IN_NON_DEV: ReadonlySet<string> = new Set([
  'auditWire',
  // Enterprise governance (fail-soft HITL registry — 2026-07-14):
  'hitlRegistry',
  // Differentiated governance / cost / concurrency (fail-soft, verified):
  'govConcurrency',
  'govCostOpt',
  'govSecurityMon',
  // Legal-pipeline read-only admin surface (deterministic, SDK-key gated):
  'legalPipelineChunker',
  'legalPipelineEmbedding',
  'legalPipelineReranker',
  'legalPipelineSummarizer',
  'legalPipelineReadability',
  // Compliance read-only admin surface (data lookup + deterministic crypto):
  'complianceEuAiAct',
  'compliancePqc',
  'complianceFederatedPrivacy',
  // Consolidated internal-services read-only /capabilities surface:
  'internalSurface',
  // ── Session-17 (2026-06-03) — LIVE citation/statute authority verification ──
  // NV-SVC-AUTHORITY-ADAPTER-001. Each adapter is fail-soft: the live lookup is
  // timeout- + cache-guarded (authorityFetch + LIVE_CACHE) and degrades to an
  // explicit `unverified` (never a silent `verified`, never a hang) on any
  // timeout/non-200/parse error. Defaulting ON in non-dev backs the
  // anti-hallucination layer with real authority data:
  //   citationLiveUk — legislation.gov.uk Atom feed (free, public, no key) — LIVE
  //   citationLiveEu — EUR-Lex CELEX legal-content resolve (public) — LIVE
  //   citationLiveIn — India Code DSpace simple-search (public) — LIVE
  //   citationLiveSg — Singapore Statutes Online (SSO results are JS-rendered;
  //                    live probe is positive-only best-effort, corpus+structural
  //                    primary) — LIVE-BEST-EFFORT
  //   citationLiveUs — CourtListener (works keyless but rate-limited; set
  //                    NYV_COURTLISTENER_TOKEN to lift the limit) + US Code
  //                    structural/corpus — LIVE-DEGRADED-PENDING-TOKEN
  //   citationLiveGc — no single free GCC API; corpus+structural primary, live
  //                    probe only when an operator wires NYV_GC_LEGISLATION_API_BASE
  //                    — LIVE-DEGRADED-PENDING-SOURCE
  // Dev/test stay OFF (env unset) so local UAT runs the deterministic
  // corpus+structural verifier with no external egress.
  'citationLiveIn',
  'citationLiveUk',
  'citationLiveUs',
  'citationLiveEu',
  'citationLiveGc',
  'citationLiveSg',
  // NYV-SDK-AUTO-ORCH-001 — partner /orchestrate auto-engages the Queen for
  // complex prompts (fail-soft: Queen errors degrade to the single-agent
  // ring inside the route's existing catch). Dev/test stay OFF so local UAT
  // harnesses keep the fast single-shot behaviour unless explicitly enabled.
  'sdkAutoOrch',
  // NV-DOCPARSE-ADAPTER-001 — deterministic docparse primary for IN legal bytes.
  'docparse',
  // NV-DOCPARSE-SDK-001 — Platform SDK engine + contracts on legal ingest (legacy @jurexio/docparse only if JRX_F_DOCPARSE_LEGACY=1).
  'docparseSdk',
  // NV-DOCPARSE-JOBS-001 — Redis/BullMQ async docparse jobs when queue live; in-memory fallback otherwise.
  'docparseJobs',
  /** NV-DOCPARSE-LEGACY-001 — emergency @jurexio/docparse engine if SDK throws (default OFF). */
  'docparseLegacy',
  /** NV-DOCPARSE-NSP-EVIDENCE-DEPICT-001 — NSP vision caption for case photos/imaging (default OFF). */
  'docparseEvidenceDepict',
  /** NV-DOCPARSE-NSP-ATTACH-UNDERSTAND-001 — NSP draft/chat attach context LLM (default OFF). */
  'docparseAttachUnderstand',
  /** NV-TEXTRACT-OCR-001 — Amazon Textract before vision LLM on OCR fallback (default OFF). */
  'textractOcr',
  // NYV-P1-ORCH-CORE-001 — post-call credit accounting (record()) is fully
  // fail-soft (the insert is wrapped + swallowed). Defaulting ON in non-dev
  // makes the already-wired pre-call budget gate functional (it reads the
  // rows record() writes). Dev/test stay OFF so local UAT without the
  // nv_schema.ai_credit_usage table is byte-for-byte unchanged.
  'creditRecord',
  // NV-AGENTIC-RR-001 — agentic RAG rerank/re-retrieval defaults ON in non-dev
  // because both hops are fail-soft and preserve the original result on error.
  'ragNeuralRerank',
  'agenticReretrieval',
  'providerTokenStream',
  // NV-STREAM-TERMINAL-POLISH-001 — post-stream sync-parity polish on partner
  // `-fast` specialist SSE before run_completed. Default ON in non-dev.
  'streamTerminalPolish',
  // ROMA L5 engine admin surface (/api/nv5/orch/roma) — read-only + outcome
  // track, no LLM. Queen already records outcomes into the same in-process
  // engine. Default ON in non-dev so CAM/ops can read the live store.
  'aiOrchRoma',
  // NYS knowledge plane (caselaw/statute proxy). Default ON in non-dev when
  // NYS_KNOWLEDGE_BASE_URL is set; health/full reports not_configured if URL missing.
  'nysKnowledgePlane',
  // NV-BETA-QUALITY-FIRST-001 / NV-AI-COMPLETION-LOOP-001 / NV-TRUST-TIER-001 — Beta cred over cost.
  'betaQualityFirst',
  'betaCompletionLoop',
  'trustTierMemory',
]);

function shouldDefaultOnInNonDev(logical: string | undefined): boolean {
  if (!logical || !FLAG_DEFAULT_ON_IN_NON_DEV.has(logical)) return false;
  const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  return env !== '' && env !== 'development' && env !== 'test';
}

function flagOn(name: string, logical?: string): boolean {
  if (logical && _overlayLookup) {
    const ov = _overlayLookup(logical);
    if (typeof ov === 'boolean') return ov;
  }
  if (envFlagOn(name)) return true;
  if (envFlagExplicitlyOff(name)) return false;
  // Env var unset — apply non-dev default policy if this flag opts in.
  if (shouldDefaultOnInNonDev(logical)) return true;
  // Enterprise / government pack hosts flip additional governance flags.
  if (logical && shouldDefaultOnEnterprisePack(logical as NyvFeatureFlag)) return true;
  return false;
}

const FLAG_ENV_MAP = {
  auditWire:        'JRX_F_AUDIT_WIRE',
  hitlRegistry:     'JRX_F_HITL_REGISTRY',
  piiJcn:           'JRX_F_PII_JCN',
  securityMonitor:  'JRX_F_SECURITY_MONITOR',
  citationWire:     'JRX_F_CITATION_WIRE',
  tokenOpt:         'JRX_F_TOKEN_OPT',
  // NV-WIRING-BUDGET-001 Phase-1 wire-chain (2026-05-10) — opt-in mounts
  // for previously-orphan middleware. Default OFF preserves v5 behaviour.
  canonicalRequestLogger:    'JRX_F_CANONICAL_REQUEST_LOGGER',
  tracing:                   'JRX_F_TRACING',
  nsResponseMap:             'JRX_F_NS_RESPONSE_MAP',
  platformRateLimiterInmem:  'JRX_F_PLATFORM_RATE_LIMITER_INMEM',
  // NV-WIRING-BUDGET-001 Session-10 Batch A — additive /api/nv5/orch/* mounts.
  // Each flag controls one sub-router under /api/nv5/orch/. Default OFF so
  // deploys without env changes preserve v5 behaviour byte-for-byte. The
  // routes are READ-ONLY status/list/select/score endpoints; LLM-emitting
  // paths (agentzero/azentzero invoke) are deliberately NOT exposed — those
  // remain reachable only through realLLMService.executeRequest per
  // NV-LLM-001 (single-router rule).
  aiOrchKb:             'JRX_F_AI_ORCH_KB',
  aiOrchContext:        'JRX_F_AI_ORCH_CONTEXT',
  aiOrchMultimodalRag:  'JRX_F_AI_ORCH_MULTIMODAL_RAG',
  aiOrchProviders:      'JRX_F_AI_ORCH_PROVIDERS',
  aiOrchPlugins:        'JRX_F_AI_ORCH_PLUGINS',
  aiOrchRoma:           'JRX_F_AI_ORCH_ROMA',
  aiOrchFacade:         'JRX_F_AI_ORCH_FACADE',
  aiOrchAgentSelect:    'JRX_F_AI_ORCH_AGENT_SELECT',
  aiOrchProtocols:      'JRX_F_AI_ORCH_PROTOCOLS',
  // NV-WIRING-BUDGET-001 Session-10 Batch B — additive /api/nv5/{multimodal,voice}/*.
  // Each flag controls one sub-router. Default OFF so deploys without env
  // changes preserve v5 behaviour byte-for-byte. Routes are READ-ONLY
  // status/list/capability/session-lifecycle endpoints; provider-emitting
  // paths (TTS/STT/avatar render) are deliberately NOT exposed — those
  // remain reachable only through the canonical /api/jrx/voice/* +
  // /api/jrx/sdk/multimodal/* pipelines per NV-LLM-001 / NV-ARCH-001.
  multimodalAvatarUnity:    'JRX_F_MULTIMODAL_AVATAR_UNITY',
  multimodalAvatarChatdoll: 'JRX_F_MULTIMODAL_AVATAR_CHATDOLL',
  multimodalRagAdv:         'JRX_F_MULTIMODAL_RAG_ADV',
  multimodal3dImmersive:    'JRX_F_MULTIMODAL_3D_IMMERSIVE',
  multimodalAvatar3d:       'JRX_F_MULTIMODAL_AVATAR_3D',
  voiceStreamRt:            'JRX_F_VOICE_STREAM_RT',
  voiceSynth:               'JRX_F_VOICE_SYNTH',
  voiceEnhanced:            'JRX_F_VOICE_ENHANCED',
  // NV-WIRING-BUDGET-001 Session-10 Batch C — additive /api/nv5/workflows/*
  // and /api/nv5/doc-ai/* mounts. Default OFF. Workflow engines are
  // import-loaded for wiring-audit reachability but DO NOT start their
  // background loops until an SDK request explicitly POSTs to
  // /api/nv5/workflows/{autonomous,continuous}/start or to the canonical
  // /api/nv5/workflows/start shim. There is NO env-based boot-start path
  // (architect review removed it entirely). Doc-AI runs conversions
  // on-demand only — no daemon.
  workflowAutonomous:       'JRX_F_WORKFLOW_AUTONOMOUS',
  workflowContinuous:       'JRX_F_WORKFLOW_CONTINUOUS',
  docAiConvert:             'JRX_F_DOC_AI_CONVERT',
  // NV-WIRING-BUDGET-001 Session-10 Batch D — additive /api/nv5/gov/* mounts
  // for cross-cutting governance services. Default OFF preserves byte-for-byte
  // v5 behaviour. Each flag controls one read-only admin sub-router under
  // /api/nv5/gov/. The underlying services run NO background daemons (cost
  // optimizer caches lazily, concurrency governor only counts in-flight when
  // queen-orchestrator wraps a call, org-rate-limiter is a check() function,
  // maker-checker is invoked from orchestrator). Routes are admin-scoped.
  govMakerChecker:          'JRX_F_GOV_MAKER_CHECKER',
  // NV-GOV-MAKER-CHECKER-LLM-001 — when ON, the maker-checker loop's CHECKER is
  // a real LLM critique (routed through the safety ring) that scores the
  // synthesis and emits structured issues/suggestions, instead of the
  // length/jurisdiction/citation heuristic. Fail-safe: any LLM/parse error
  // degrades to the deterministic heuristic checker so a critique failure never
  // poisons a successful synthesis. Default OFF (adds one critique LLM call per
  // maker-checker iteration); enable once the extra spend is budgeted.
  govMakerCheckerLlm:       'JRX_F_GOV_MAKER_CHECKER_LLM',
  govSecurityMon:           'JRX_F_GOV_SECURITY_MON',
  govCostOpt:               'JRX_F_GOV_COST_OPT',
  govConcurrency:           'JRX_F_GOV_CONCURRENCY',
  govOrgRatelimit:          'JRX_F_GOV_ORG_RATELIMIT',
  // NV-WIRING-BUDGET-001 Session-11 Batch E — additive /api/nv5/legal-pipeline/*
  // mounts wiring 5 previously-orphan RAG services. Default OFF preserves
  // byte-for-byte v5 behaviour. Each flag controls one read-only admin
  // sub-router. NV-LLM-001 / NV-ARCH-001: only deterministic methods
  // (chunking, RRF fusion, readability scoring) are exposed; LLM/embedding
  // emission remains exclusively in the canonical RAG pipeline reachable
  // from realLLMService.executeRequest.
  legalPipelineChunker:     'JRX_F_LEGAL_PIPELINE_CHUNKER',
  legalPipelineEmbedding:   'JRX_F_LEGAL_PIPELINE_EMBEDDING',
  legalPipelineReranker:    'JRX_F_LEGAL_PIPELINE_RERANKER',
  legalPipelineSummarizer:  'JRX_F_LEGAL_PIPELINE_SUMMARIZER',
  legalPipelineReadability: 'JRX_F_LEGAL_PIPELINE_READABILITY',
  // NV-WIRING-BUDGET-001 Session-11 Batch F — additive /api/nv5/compliance/*
  // mounts wiring 3 previously-orphan compliance/crypto services. Default OFF
  // preserves byte-for-byte v5 behaviour. EU-AI-Act doc generation is pure
  // data lookup; PQC operations are deterministic crypto; federated-privacy
  // exposes session listings + DP-noise probe (lifecycle mutations remain
  // in code-path use only).
  complianceEuAiAct:          'JRX_F_COMPLIANCE_EU_AI_ACT',
  compliancePqc:              'JRX_F_COMPLIANCE_PQC',
  complianceFederatedPrivacy: 'JRX_F_COMPLIANCE_FEDERATED_PRIVACY',
  // NV-WIRING-BUDGET-001 Session-11 Batches G+H+I+J — single namespace flag
  // for the consolidated /api/nv5/internal/* admin surface (14 wired
  // previously-orphan services). Default OFF preserves byte-for-byte v5
  // behaviour. NV-LLM-001 / NV-ARCH-001: zero LLM-emitting endpoints —
  // all routing, escalation, audit, hallucination logic remains reachable
  // only from canonical pipelines (queen orchestrator, realLLMService,
  // adaptive-RAG, audit-chain commit).
  internalSurface:            'JRX_F_INTERNAL_SURFACE',
  // NV-SVC-AUTHORITY-ADAPTER-001 — per-jurisdiction live citation-authority
  // lookups. Default OFF: every adapter runs its deterministic corpus +
  // structural-format verifier and returns explicit `unverified` (never a
  // silent pass) when it cannot confirm a citation. Flip a flag ON (and supply
  // the matching base-URL/key env var) to consult the live authority API for
  // that jurisdiction. No LLM emission happens here — these are read-only
  // authority lookups, so NV-LLM-001 is unaffected.
  citationLiveIn:  'JRX_F_CITATION_LIVE_IN',
  citationLiveUk:  'JRX_F_CITATION_LIVE_UK',
  citationLiveUs:  'JRX_F_CITATION_LIVE_US',
  citationLiveEu:  'JRX_F_CITATION_LIVE_EU',
  citationLiveGc:  'JRX_F_CITATION_LIVE_GC',
  citationLiveSg:  'JRX_F_CITATION_LIVE_SG',
  // NYV-P1-ORCH-CORE-001 — P1 orchestration-core hardening (default OFF, fail-safe).
  //   queenLlmPlanner       — when ON, QueenOrchestrator.decomposeTask first
  //                           attempts an LLM-driven plan (routed through the
  //                           existing safety ring via withMiddleware, per
  //                           NV-LLM-001). ANY failure (flag off, parse error,
  //                           empty plan, LLM unavailable) falls back to the
  //                           existing keyword-heuristic decomposition. Default
  //                           OFF so the heuristic stays the default path and
  //                           no orchestration regresses without opt-in.
  //   lmcacheSemanticEmbed  — when ON (AND the cache's enableSemanticMatching
  //                           is on AND the namespace pins a tenant), the LM
  //                           cache may SERVE an answer matched by embedding
  //                           cosine similarity (nvLegalEmbeddingService)
  //                           instead of requiring an exact key. The legacy
  //                           hash-overlap scorer this used to fall back to has
  //                           been removed: at the 0.85 threshold it could only
  //                           match identical digests, i.e. it never served a
  //                           real paraphrase. Embedding-provider failure now
  //                           degrades to exact-match-only (never throws, never
  //                           fabricates a vector). Default OFF — the live
  //                           embedding call adds latency/cost on the write
  //                           path, so it is opt-in; the cache's key-stability,
  //                           tenant-isolation and staleness fixes are always on.
  queenLlmPlanner:      'JRX_F_QUEEN_LLM_PLANNER',
  lmcacheSemanticEmbed: 'JRX_F_LMCACHE_SEMANTIC_EMBED',
  // NYV-P1-ORCH-CORE-001 — post-call credit accounting on /orchestrate. The
  // pre-call gate (nvAICreditEnforcer.enforce) was already wired, but no path
  // called record() afterward, so getUsedToday() stayed 0 and the budget gate
  // could never actually fire for orchestrate traffic. When ON, the Queen and
  // single-agent branches persist real per-request token/cost (from
  // nv-request-usage-context) via record(). Fully fail-soft (record() swallows
  // its own errors). Default ON in non-dev (matches govCostOpt posture); dev/
  // test stay OFF so local UAT without the credit tables is byte-for-byte
  // unchanged, and an explicit JRX_F_CREDIT_RECORD=0 opts out.
  creditRecord:         'JRX_F_CREDIT_RECORD',
  // NV-RETENTION-TTL-001 — daily data-retention sweep (storage limitation).
  // When ON the timer runs; deletion still requires NYV_RETENTION_APPLY=1
  // (otherwise dry-run logs counts). Default OFF — destructive, opt-in.
  retentionSweep:       'JRX_F_RETENTION_SWEEP',
  // NYV-SVC-MEM0-DURABLE-001 (2026-06-29) — durable + embedding-backed mem0.
  // When ON, src/services/mem0-persistence-service.ts persists every memory to
  // nv_schema.mem0_memories and hydrates the in-process Map (hot cache) from it
  // on recall, so store()/recall() survive a restart and span replicas; recall
  // ranks by cosine over embeddings from the existing nv-legal-embedding-service.
  // Default OFF everywhere: with the flag off the service behaves exactly as
  // before (Map-only, lexical recall). Fail-safe: any DB or embedding-provider
  // error degrades back to the in-process lexical path (loud warning, never a
  // silent pass, never random vectors).
  mem0Durable:     'JRX_F_MEM0_DURABLE',
  // NYV-SDK-AUTO-ORCH-001 (2026-06-12) — partner-path intelligence parity.
  // When ON, POST /api/jrx/orchestrate auto-engages the Queen orchestrator
  // (topology auto-selection + multi-agent decomposition) for prompts the
  // Queen's own complexity analyzer rates complex/very_complex, instead of
  // unconditionally short-circuiting to the single-agent ring when the
  // caller omitted `orchestrationMode`. Fail-soft: any Queen error falls
  // back to the pre-existing single-agent safety-ring path (route already
  // catches and degrades). Default ON in non-dev; explicit
  // JRX_F_SDK_AUTO_ORCH=0 opts out without a code change.
  sdkAutoOrch:     'JRX_F_SDK_AUTO_ORCH',
  // NV-OTEL-GENAI-001 (2026-06-29) — OpenTelemetry GenAI tracing export.
  // When ON (or when OTEL_EXPORTER_OTLP_ENDPOINT / *_TRACES_ENDPOINT is set),
  // every finished LLM span (and generic span) is converted to spec-compliant
  // OTLP/HTTP JSON and POSTed to the configured collector by nv-otlp-exporter.
  // gen_ai.* semantic-convention attributes are always stamped on LLM spans;
  // this flag only gates the network export. Fully fail-safe: export is queued
  // + flushed fire-and-forget and never throws into the request path. Default
  // OFF so deploys without a collector are byte-for-byte unchanged.
  otelGenai:       'JRX_F_OTEL_GENAI',
  // NV-AGENTIC-RR-001 (2026-06-29) — agentic RAG re-retrieval + LLM query
  // reformulation. Both default OFF and are independent:
  //   ragLlmReformulate  — when ON, corrective-rag-service rewrites a weak query
  //                        with an LLM (routed through the safety ring per
  //                        NV-LLM-001) before its heuristic string-template
  //                        rewrites. ANY failure falls back to the heuristic.
  //   agenticReretrieval — when ON, autoRagRetrieve runs ONE bounded extra
  //                        retrieval pass with an LLM-reformulated query when
  //                        the first pass returns low-confidence results, then
  //                        re-fuses (RRF) and recomputes confidence. Fail-safe:
  //                        any error keeps the original result.
  ragLlmReformulate:  'JRX_F_RAG_LLM_REFORMULATE',
  agenticReretrieval: 'JRX_F_AGENTIC_RERETRIEVAL',
  // NV-CTX-RETRIEVAL-001 (2026-06-29) — Anthropic-style contextual retrieval.
  // When ON, an opt-in `contextualizeChunks()` step (only runs when a caller
  // ALSO passes options.contextualize=true, so the deterministic chunker
  // preview route is never affected) generates a one-sentence situating header
  // per chunk via the safety ring (NV-LLM-001) and prepends it to the chunk
  // text before embedding — improving retrieval precision on long documents.
  // Bounded concurrency + per-chunk fail-safe: any error keeps the existing
  // deterministic parentContext breadcrumb. Default OFF (adds LLM cost/latency
  // at ingest, so opt-in).
  contextualRetrieval: 'JRX_F_CONTEXTUAL_RETRIEVAL',
  // NV-RAG-RERANK-001 (2026-06-29) — neural cross-encoder rerank of the fused
  // Auto-RAG result set. When ON, autoRagRetrieve reranks the RRF-merged chunks
  // via nvLegalRerankerService (precedence: self-hosted CROSS_ENCODER_URL →
  // Cohere → Voyage; deterministic keyword-overlap heuristic last resort when
  // none configured). Highest-ROI RAG precision win. Fully fail-safe: any error
  // keeps the RRF order. Default OFF (adds a rerank hop / optional provider
  // call latency, so opt-in per deployment).
  ragNeuralRerank:    'JRX_F_RAG_NEURAL_RERANK',
  // NV-NYS-KNOWLEDGE-001 (2026-07-13) — federated NYS Knowledgesearch plane.
  // When ON, Auto-RAG fuses an extra `nys_global` layer from the live NYS API
  // (statutes / caselaw / retrieve) BEFORE LLM; MCP + /api/jrx/knowledge/*
  // proxy routes become live. Fully fail-soft: NYS down → tenant RAG only.
  // Default ON in non-dev (FLAG_DEFAULT_ON_IN_NON_DEV). Missing
  // NYS_KNOWLEDGE_BASE_URL still reports not_configured on health/full.
  nysKnowledgePlane:  'JRX_F_NYS_KNOWLEDGE_PLANE',
  // NV-CASE-API-001 — route CNR resolve via NYS-Search case-api (nysapi) before
  // legacy :8080 /cnr/resolve. Fallback on 404/401/504. Also readable via
  // NYS_CASE_API_ENABLED=1. Default OFF; JRX_F_CASE_API_CNR_SHADOW=1 logs diff only.
  caseApiCnr:         'JRX_F_CASE_API_CNR',
  // NV-PROVIDER-TOKEN-STREAM-001 — true provider SSE through safety ring on
  // /orchestrate/stream specialist path. Tokens emit as provisional text_delta;
  // post-stream hallucination/citation gate before run_completed. Default ON
  // in non-dev (FLAG_DEFAULT_ON_IN_NON_DEV). Set JRX_F_PROVIDER_TOKEN_STREAM=0 to disable.
  providerTokenStream: 'JRX_F_PROVIDER_TOKEN_STREAM',
  // NV-STREAM-TERMINAL-POLISH-001 — deterministic post-stream polish on partner
  // `-fast` specialist SSE (legal format + fast-delivery + human polish). Also
  // readable via NYV_STREAM_TERMINAL_POLISH=1|0. Default ON in non-dev.
  streamTerminalPolish: 'NYV_STREAM_TERMINAL_POLISH',
  // NV-DOCPARSE-ADAPTER-001 — @jurexio/docparse v0.2.0 deterministic Indian legal
  // parsing on PDF/image bytes. Fail-soft: on throw/unreadable, tier-2 heuristics
  // + cloud OCR paths in nv-doc-content-extractor remain. Default ON in non-dev
  // for IN jurisdiction ingest; JRX_F_DOCPARSE=0 opts out.
  docparse: 'JRX_F_DOCPARSE',
  // NV-DOCPARSE-LLM-FALLBACK-001 — when ON, a low-confidence / partial docparse
  // result triggers ONE cheap Nova-Micro tool-schema (Zod) extraction pass
  // routed through the safety ring (realLLMService.executeRequest → NV-LLM-001).
  // Fills only ABSENT / low-confidence fields; never overwrites a confident
  // deterministic value and never invents facts. Fully fail-soft (any LLM/parse
  // error returns the original deterministic result). Default OFF — it adds one
  // LLM call + spend per degraded doc; enable once the budget is approved.
  docparseLlmFallback: 'JRX_F_DOCPARSE_LLM_FALLBACK',
  // NV-DOCPARSE-SDK-001 — @jurexio/docparse-sdk Platform line on ingest + job API.
  // Default ON in non-dev (legal-first cutover); explicit JRX_F_DOCPARSE_SDK=0 reverts to @jurexio/docparse engine.
  docparseSdk: 'JRX_F_DOCPARSE_SDK',
  // NV-DOCPARSE-JOBS-001 — async docparse jobs via BullMQ when Redis live; in-process fallback otherwise.
  docparseJobs: 'JRX_F_DOCPARSE_JOBS',
  docparseLegacy: 'JRX_F_DOCPARSE_LEGACY',
  docparseEvidenceDepict: 'JRX_F_DOCPARSE_EVIDENCE_DEPICT',
  docparseAttachUnderstand: 'JRX_F_DOCPARSE_ATTACH_UNDERSTAND',
  textractOcr: 'JRX_F_TEXTRACT',
  /** NV-DOCPARSE-TEXTRACT-PAGE-001 — page-scoped Textract before vision LLM (alias of textract policy). */
  docparseTextractPage: 'JRX_F_DOCPARSE_TEXTRACT_PAGE',
  /** NV-BEDROCK-CLAUDE55-001 — prepend Haiku 5.5 on partner `-fast` Bedrock ladder. Default OFF. */
  bedrockHaiku55Fast: 'JRX_F_BEDROCK_HAIKU_55_FAST',
  /** NV-BEDROCK-CLAUDE55-001 — prepend Sonnet 5.5 on interactive Claude-fast ladder. Default OFF. */
  bedrockSonnet55Chat: 'JRX_F_BEDROCK_SONNET_55_CHAT',
  /** NV-BEDROCK-CLAUDE55-001 — prepend Opus 5.5 on counsel deep ladder. Default OFF. */
  bedrockOpus55Counsel: 'JRX_F_BEDROCK_OPUS_55_COUNSEL',
  /** NV-BEDROCK-CLAUDE55-001 — Queen leaf preferredModels remap to 5.5 family. Default OFF. */
  bedrockQueen55Leaves: 'JRX_F_BEDROCK_QUEEN_55_LEAVES',
  /** NV-BETA-QUALITY-FIRST-001 — generous token floors; default ON in non-dev. */
  betaQualityFirst: 'JRX_F_BETA_QUALITY_FIRST',
  /** NV-AI-COMPLETION-LOOP-001 — LLM continuation segments on incomplete drafts. */
  betaCompletionLoop: 'JRX_F_BETA_COMPLETION_LOOP',
  /** NV-TRUST-TIER-001 — block unreviewed AI output from durable memory recall. */
  trustTierMemory: 'JRX_F_TRUST_TIER_MEMORY',
} as const;

export type NyvFeatureFlag = keyof typeof FLAG_ENV_MAP;

/**
 * Read-only snapshot of every JRX_F_* flag for admin/console surfaces.
 * Returns logical name → { env var name, resolved boolean }. Computed at
 * call time so any toggle since boot is reflected.
 *
 * Used by `GET /api/jrx/admin/feature-flags` (Task #109 — Console UI must
 * be able to render "feature disabled" banners for the /api/nv5/* admin
 * pages without trial-and-erroring every endpoint to discover OFF state).
 */
export function getNyvFeatureFlagSnapshot(): Record<NyvFeatureFlag, {
  env: string;
  on: boolean;
  /** "overlay" when DB row forced the value, "env" when an JRX_F_* env var
   *  set it ON, "default" when neither — Console renders this so operators
   *  can tell at a glance which lever a chip came from. */
  source: 'overlay' | 'env' | 'default';
  /** Raw env value (true/false) ignoring overlay — useful in the Console
   *  to show "currently overridden" UI. */
  envOn: boolean;
}> {
  const out = {} as Record<NyvFeatureFlag, { env: string; on: boolean; source: 'overlay' | 'env' | 'default'; envOn: boolean }>;
  for (const k of Object.keys(FLAG_ENV_MAP) as NyvFeatureFlag[]) {
    const envName = FLAG_ENV_MAP[k];
    const envOn = envFlagOn(envName);
    const envOff = envFlagExplicitlyOff(envName);
    const overlay = _overlayLookup ? _overlayLookup(k) : undefined;

    // F-002 v11.1 fix (architect catch, 2026-05-11): the snapshot must use
    // the SAME resolution logic as runtime `flagOn()` so admin/Console
    // observability cannot drift from the real value the gateway is acting
    // on. Previously this function computed `overlay ?? envOn`, which under
    // NODE_ENV=production with JRX_F_AUDIT_WIRE unset would report `false`
    // while runtime returned `true` from the FLAG_DEFAULT_ON_IN_NON_DEV
    // policy. Now: overlay precedence (matches runtime), then env-on, then
    // env-explicit-off, then per-flag non-dev default. Source is
    // attributed to the layer that actually decided.
    let on: boolean;
    let source: 'overlay' | 'env' | 'default';
    if (typeof overlay === 'boolean') {
      on = overlay;
      source = 'overlay';
    } else if (envOn) {
      on = true;
      source = 'env';
    } else if (envOff) {
      on = false;
      source = 'env';
    } else if (shouldDefaultOnInNonDev(k)) {
      on = true;
      source = 'default';
    } else if (shouldDefaultOnEnterprisePack(k)) {
      on = true;
      source = 'default';
    } else {
      on = false;
      source = 'default';
    }
    out[k] = { env: envName, on, source, envOn };
  }
  return out;
}

/**
 * Returns the canonical JRX_F_* env name for a logical flag key, or
 * `undefined` if the key is not registered. Used by the admin PATCH
 * endpoint (Task #114) to validate `:logical` route params.
 */
export function getFlagEnvName(logical: string): string | undefined {
  return (FLAG_ENV_MAP as Record<string, string>)[logical];
}

/** All known logical flag keys. */
export function listNyvFeatureFlagKeys(): NyvFeatureFlag[] {
  return Object.keys(FLAG_ENV_MAP) as NyvFeatureFlag[];
}

/**
 * IMPORTANT: env vars are read fresh on every call so that flags toggled
 * after process startup (e.g. via dotenv loaded later in the boot sequence,
 * or runtime export from an admin endpoint) take effect immediately and we
 * don't capture a stale snapshot at module-import time.
 */
export function isNyvFeatureOn(flag: NyvFeatureFlag): boolean {
  return flagOn(FLAG_ENV_MAP[flag], flag);
}

/**
 * Backward-compat snapshot of all flag values. Computed at access time via
 * a Proxy so callers that read NYV_FEATURE_FLAGS.xxx still see live values.
 */
export const NYV_FEATURE_FLAGS = new Proxy({} as Record<NyvFeatureFlag, boolean>, {
  get(_t, prop: string) {
    if (prop in FLAG_ENV_MAP) return flagOn(FLAG_ENV_MAP[prop as NyvFeatureFlag], prop);
    return undefined;
  },
});
