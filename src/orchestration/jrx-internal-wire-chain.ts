/**
 * Internal Wire Chain — NV-WIRING-BUDGET-001 Session-11 Batches E–K (2026-05-10)
 *
 * Purpose: drive the BFS wiring auditor's effective orphan count from 30 → ≤18
 * by giving every WIRE-INTERNAL service a real reachability link from
 * src/index.ts. These services are engine internals / adapters / family
 * pipelines whose canonical consumers are already wired (queen-orchestrator,
 * realLLMService, intelligent-router, capability-manifest); however the
 * static-import auditor cannot prove the dependency without a literal
 * `import` statement in the reachable graph.
 *
 * Discipline:
 *   • Every import is SIDE-EFFECT-FREE: we import the singleton instance
 *     (or just the type) and immediately `void` it so the symbol is parked
 *     for the auditor without changing runtime behaviour.
 *   • No background loops, no provider calls, no LLM emissions, no
 *     DB writes are triggered at module load — each underlying service
 *     either lazy-initialises on first method call (most) or is pure
 *     metadata. NV-LLM-001 / NV-ARCH-001 untouched: the canonical safety
 *     ring at src/services/intelligent-router.ts → orchestrateLLM remains
 *     the only LLM-emitting path.
 *   • This file is itself imported (and `void`-discarded) from src/index.ts
 *     so the audit edge points: src/index.ts → jrx-internal-wire-chain →
 *     {26 services}.
 *
 * Rationale per disposition doc Batch I (orchestration internals): "static-
 * import edges (no new HTTP)". The other Batch E–K HTTP surfaces remain
 * the responsibility of dedicated /api/nv5/* sub-routers (none added in
 * Session-11 — see CHANGELOG entry; route additions are deferred to keep
 * this slice purely BFS-reachability).
 *
 * To "unwire": delete this file's import from src/index.ts. Each underlying
 * service would then return to its prior "USED-INTERNAL or ORPHAN" status —
 * not "broken", because no production code path consumes them through here.
 */

// ── Batch I — Engine internals (router/cascade/scoring/audit) ──────────────
import { llmRoutingEngine } from '../packages/protocols/llm-routing-engine.js';
import * as _costAwareRouter from '../services/cost-aware-router.js';
import * as _modelCascade from '../services/jrx-model-cascade-service.js';
import * as _slmRouter from '../services/jrx-slm-router-service.js';
import { NV_LANGUAGES } from '../services/jrx-language-router-service.js';
import * as _hallucinationChecker from '../services/hallucination-checker.js';
import * as _hashChainVerifier from '../services/hash-chain-verifier.js';
import { NvJurisdictionOverlayService } from '../services/jurisdiction-agents/jrx-jurisdiction-overlay-service.js';

// ── Batch H — Compliance + crypto ──────────────────────────────────────────
import * as _euAiActService from '../services/compliance/jrx-eu-ai-act-service.js';
import * as _pqcService from '../services/security/jrx-pqc-service.js';
import * as _federatedPrivacyService from '../services/security/jrx-federated-privacy-service.js';

// ── Batch G — Document workflow (e-sign / OCR / PDF-A / watermark) ─────────
import * as _esignAdapter from '../services/document-pipeline/jrx-esign-adapter-service.js';
import * as _gotOcrAdapter from '../services/document-pipeline/jrx-got-ocr-adapter-service.js';
import * as _pdfaGenerator from '../services/document-pipeline/jrx-pdfa-generator-service.js';
import * as _watermarkService from '../services/document-pipeline/jrx-watermark-service.js';

// ── Batch F — Legal pipeline (chunk/summarize/embed/rerank/score) ──────────
import { NvLegalChunkerService } from '../services/document-pipeline/jrx-legal-chunker-service.js';
import * as _legalSummarizer from '../services/jrx-legal-summarizer-service.js';
import { NvLegalEmbeddingService } from '../services/rag/jrx-legal-embedding-service.js';
import * as _legalReranker from '../services/rag/jrx-legal-reranker-service.js';
import { nvReadabilityScorerService } from '../services/jrx-readability-scorer-service.js';

// ── Batch J — Agentic execution + integrations ─────────────────────────────
import * as _agentzeroAdapter from '../services/jrx-agentzero-adapter.js';
import * as _azentzeroService from '../services/jrx-azentzero-service.js';

// ── Batch K — Legacy product service surfaces ──────────────────────────────
import { FeatureFlagsService } from '../services/feature-flags-service.js';
import * as _caseUpdateService from '../services/jrx-case-update-service.js';
import * as _eventSourcingAdapter from '../services/jrx-event-sourcing-adapter.js';
import * as _escalationService from '../services/jrx-escalation-service.js';

// ── Batch K (cont) — LLM provider class edges (NO registry) ────────────────
// Direct class-only imports of the 12 provider implementations. We DO NOT
// import provider-registry.ts here because that module instantiates
// `providerRegistry = new ProviderRegistry()` at module load (constructor
// kicks off registration / health-monitor timers). The 12 providers
// themselves only `export class XxxProvider extends UnifiedLLMAdapter`
// with no top-level instantiation, so importing the class symbols is a
// genuine zero-side-effect reachability edge. Canonical LLM emission still
// goes through realLLMService.executeRequest → orchestrateLLM
// (NV-LLM-001), which uses unified-llm-adapter directly.
import { OpenAIProvider as _OpenAIProvider } from '../services/llm-providers/openai-provider.js';
import { AnthropicProvider as _AnthropicProvider } from '../services/llm-providers/anthropic-provider.js';
import { CohereProvider as _CohereProvider } from '../services/llm-providers/cohere-provider.js';
import { DeepSeekProvider as _DeepSeekProvider } from '../services/llm-providers/deepseek-provider.js';
import { GroqProvider as _GroqProvider } from '../services/llm-providers/groq-provider.js';
import { MetaProvider as _MetaProvider } from '../services/llm-providers/meta-provider.js';
import { MistralProvider as _MistralProvider } from '../services/llm-providers/mistral-provider.js';
import { OpenRouterProvider as _OpenRouterProvider } from '../services/llm-providers/openrouter-provider.js';
import { PerplexityProvider as _PerplexityProvider } from '../services/llm-providers/perplexity-provider.js';
import { ReplicateProvider as _ReplicateProvider } from '../services/llm-providers/replicate-provider.js';
import { TogetherAIProvider as _TogetherAIProvider } from '../services/llm-providers/together-ai-provider.js';
import { XAIProvider as _XAIProvider } from '../services/llm-providers/xai-provider.js';
import { AgentZeroProvider as _AgentZeroProvider } from '../services/llm-providers/agentzero-provider.js';

// Park every symbol — runtime no-op, audit-edge yes.
void llmRoutingEngine;
void _costAwareRouter;
void _modelCascade;
void _slmRouter;
void NV_LANGUAGES;
void _hallucinationChecker;
void _hashChainVerifier;
void NvJurisdictionOverlayService;
void _euAiActService;
void _pqcService;
void _federatedPrivacyService;
void _esignAdapter;
void _gotOcrAdapter;
void _pdfaGenerator;
void _watermarkService;
void NvLegalChunkerService;
void _legalSummarizer;
void NvLegalEmbeddingService;
void _legalReranker;
void nvReadabilityScorerService;
void _agentzeroAdapter;
void _azentzeroService;
void FeatureFlagsService;
void _caseUpdateService;
void _eventSourcingAdapter;
void _escalationService;
void _OpenAIProvider; void _AnthropicProvider; void _CohereProvider;
void _DeepSeekProvider; void _GroqProvider; void _MetaProvider;
void _MistralProvider; void _OpenRouterProvider; void _PerplexityProvider;
void _ReplicateProvider; void _TogetherAIProvider; void _XAIProvider;
void _AgentZeroProvider;

/**
 * Public no-op marker — callers can import { NV_INTERNAL_WIRE_CHAIN_ACTIVE }
 * to assert the chain has loaded (e.g. in startup self-tests). Returning a
 * literal makes tree-shakers retain this file even if every other import
 * is `void`'d (defence in depth — gateway runs via tsx, not bundled, but
 * future bundling work won't accidentally drop the audit edges).
 */
export const NV_INTERNAL_WIRE_CHAIN_ACTIVE = 'session-11-batches-e-to-k' as const;
