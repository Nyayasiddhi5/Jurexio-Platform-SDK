/**
 * PatternsApi — All 22 ROMA L5 agentic patterns for Jurexio Enterprise Platform 312.
 * Each method calls the corresponding /api/jrx/patterns/* endpoint.
 */

import type {
  JrxBasePatternRequest,
  JrxPatternResponse,
  ReActRequest,
  ToTRequest,
  GRPORequest,
  DigitalTwinRequest,
} from '../types/index.js';
import type { JrxHttpClient } from '../JrxClient.js';

export class PatternsApi {
  constructor(private readonly http: JrxHttpClient) {}

  /** P01 — ReAct: Reason + Act agentic loop */
  react(req: ReActRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/react', req);
  }

  /** P02 — Chain-of-Thought: step-by-step legal reasoning */
  cot(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/cot', req);
  }

  /** P03 — Tree-of-Thought: multi-branch strategy exploration */
  tot(req: ToTRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/tot', req);
  }

  /** P04 — Reflection: self-critique and iterative improvement */
  reflect(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/reflect', req);
  }

  /** P05 — Plan-and-Execute: structured sequential legal execution */
  planExecute(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/plan-exec', req);
  }

  /** P06 — Iterative Refinement: quality-driven document improvement */
  refine(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/refine', req);
  }

  /** P07 — Maker-Checker: dual-agent validation (maker + independent checker) */
  makerChecker(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/maker-checker', req);
  }

  /** P08 — Tool-Retry: resilient tool invocation with exponential backoff */
  toolRetry(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/tool-retry', req);
  }

  /** P09 — Function Router: intelligent agent and tool routing */
  functionRouter(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/function-router', req);
  }

  /** P10 — MCP Chain: sequential multi-tool Model Context Protocol execution */
  mcpChain(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/mcp-chain', req);
  }

  /** P11 — NyayaRAG: retrieval-augmented generation with pgvector + BNS/BNSS/BSA statute retrieval */
  nyayaRag(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/nyayarag', req);
  }

  /** P12 — GraphRAG: legal knowledge graph traversal */
  graphRag(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/graphrag', req);
  }

  /** P13 — Mem0: long-term memory integration with tiered hot/warm/cold storage */
  mem0(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/mem0', req);
  }

  /** P14 — Semantic Cache: cached response retrieval for repeated legal queries */
  semanticCache(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/semantic-cache', req);
  }

  /** P15 — HTA: hierarchical task analysis for complex legal matters */
  hta(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/hta', req);
  }

  /** P16 — Swarm: parallel multi-agent legal consensus */
  swarm(req: JrxBasePatternRequest & { swarmSize?: number }): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/swarm', req);
  }

  /** P17 — ACONIC: autonomous continuous monitoring intelligence */
  aconic(req: JrxBasePatternRequest & { monitorInterval?: number }): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/aconic', req);
  }

  /** P18 — MOAt: multi-layer orchestration with audit trail */
  moat(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/moat', req);
  }

  /** P19 — ADaPT: adaptive task planning */
  adapt(req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/adapt', req);
  }

  /** P20 — Computer-Use: vision-based UI automation for legal workflows */
  computerUse(req: JrxBasePatternRequest & { screenshotBase64?: string }): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/computer-use', req);
  }

  /** P21 — GRPO Legal RLHF: advocate feedback loop with policy optimization */
  grpo(req: GRPORequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/grpo', req);
  }

  /** P22 alias — role-play / bench simulation for moot prep */
  rolePlay(req: DigitalTwinRequest): Promise<JrxPatternResponse> {
    return this.digitalTwin({ ...req, task: req.task ?? 'Role-play legal hearing simulation' });
  }

  /** P22 — Legal Digital Twin: AI persona simulation for scenario modelling */
  digitalTwin(req: DigitalTwinRequest): Promise<JrxPatternResponse> {
    return this.http.post('/api/jrx/patterns/digital-twin', req);
  }

  /**
   * Execute any pattern by code (e.g. 'P11', 'grpo', 'react').
   * Normalises the pattern code to the correct route slug.
   */
  execute(patternCode: string, req: JrxBasePatternRequest): Promise<JrxPatternResponse> {
    const slug = PATTERN_SLUGS[patternCode.toUpperCase()] ?? patternCode.toLowerCase();
    return this.http.post(`/api/jrx/patterns/${slug}`, req);
  }
}

const PATTERN_SLUGS: Record<string, string> = {
  P01: 'react', P02: 'cot', P03: 'tot', P04: 'reflect',
  P05: 'plan-exec', P06: 'refine', P07: 'maker-checker', P08: 'tool-retry',
  P09: 'function-router', P10: 'mcp-chain', P11: 'nyayarag', P12: 'graphrag',
  P13: 'mem0', P14: 'semantic-cache', P15: 'hta', P16: 'swarm',
  P17: 'aconic', P18: 'moat', P19: 'adapt', P20: 'computer-use',
  P21: 'grpo', P22: 'digital-twin',
  REACT: 'react', COT: 'cot', TOT: 'tot', REFLECT: 'reflect',
  GRPO: 'grpo', SWARM: 'swarm', ACONIC: 'aconic', MEM0: 'mem0',
  HTA: 'hta', MOAT: 'moat', ADAPT: 'adapt',
};
