/**
 * Jurexio Swarm Topology Service
 * @version 3.1.2
 *
 * 107 agentic swarm topologies for multi-agent legal reasoning.
 * Each topology defines how N agents coordinate to produce a result.
 *
 * Categories:
 *   Linear (10): sequential pipeline
 *   Fan-out (8): parallel branch + merge
 *   Hierarchical (12): manager → worker trees
 *   Round-Robin (6): rotating agent pools
 *   Competitive (8): race to best answer
 *   Consensus (10): voting + aggregation
 *   Iterative (8): feedback loops
 *   Specialized (12): domain-specific chains
 *   Hybrid (15): mixed strategies
 *   Quantum-Ready (8): GRPO-enhanced  
 *   ROMA L5 (10): full ROMA L5 protocol
 *
 * Total: 107 topologies
 */

import { createLogger } from '../utils/logger.js';
import {
  getAllAgents,
  getAgentsByJurisdiction,
  getRegistryStats,
} from './agent-registry-service.js';
import {
  getTopologyAlgorithmPlan,
  aggregateTopologyResults,
  refineAgentResults,
  type TopologyAgentResult,
} from './jrx-topology-algorithms.js';
import { queenOrchestrator } from '../orchestration/jrx-queen-orchestrator.js';

const logger = createLogger('swarm-topology');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type TopologyCategory =
  | 'linear' | 'fan_out' | 'hierarchical' | 'round_robin'
  | 'competitive' | 'consensus' | 'iterative' | 'specialized'
  | 'hybrid' | 'quantum_ready' | 'roma_l5';

export interface SwarmTopology {
  id: string;
  name: string;
  category: TopologyCategory;
  agentCount: number;
  maxAgents: number;
  description: string;
  useCases: string[];
  strengths: string[];
  weaknesses: string[];
  estimatedLatencyMs: [number, number]; // [min, max]
  costMultiplier: number;
  grpoCompatible: boolean;
  jurisdictions: string[];
  romaLevel: 1 | 2 | 3 | 4 | 5;
  implementationPattern: string;
}

export interface SwarmExecutionRequest {
  topologyId: string;
  query: string;
  agents: string[];
  jurisdiction: string;
  userId: string;
  context?: Record<string, any>;
  maxTokens?: number;
  qualityThreshold?: number;
}

export interface SwarmExecutionResult {
  topologyId: string;
  topologyName: string;
  agentsUsed: string[];
  individualResults: Array<{ agentId: string; result: string; score: number; latencyMs: number }>;
  aggregatedResult: string;
  consensusScore: number;
  executionMs: number;
  romaLevel: number;
  grpoEpisode?: number;
  catalogOnly?: false;
  orchestrationPattern?: string;
  queenStatus?: string;
  topologyAlgorithm?: string;
  algorithmMetadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 107 SWARM TOPOLOGIES REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export const SWARM_TOPOLOGIES: SwarmTopology[] = [

  // ─── LINEAR (10) ──────────────────────────────────────────────────────────
  { id: 'linear-001', name: 'Sequential Legal Chain', category: 'linear', agentCount: 3, maxAgents: 8, description: 'Agents execute sequentially — output of each is input to next.', useCases: ['Contract review', 'Due diligence'], strengths: ['Predictable', 'Auditable'], weaknesses: ['Slow', 'No parallelism'], estimatedLatencyMs: [2000, 8000], costMultiplier: 1.0, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 1, implementationPattern: 'A → B → C → Result' },
  { id: 'linear-002', name: 'Legal Research Pipeline', category: 'linear', agentCount: 4, maxAgents: 6, description: 'Research → Analysis → Drafting → Review pipeline.', useCases: ['Legal opinion', 'Research memo'], strengths: ['Structured', 'Quality-gated'], weaknesses: ['Sequential bottleneck'], estimatedLatencyMs: [3000, 12000], costMultiplier: 1.2, grpoCompatible: true, jurisdictions: ['IN','UK'], romaLevel: 2, implementationPattern: 'Research → Analyse → Draft → Review' },
  { id: 'linear-003', name: 'Compliance Audit Chain', category: 'linear', agentCount: 5, maxAgents: 8, description: 'Document intake → PII scan → Clause analysis → Compliance check → Report.', useCases: ['SEBI filing', 'AML audit'], strengths: ['Thorough', 'Regulatory-grade'], weaknesses: ['High latency'], estimatedLatencyMs: [5000, 15000], costMultiplier: 1.5, grpoCompatible: true, jurisdictions: ['IN','EU'], romaLevel: 2, implementationPattern: 'Intake → PII → Clause → Compliance → Report' },
  { id: 'linear-004', name: 'Contract Lifecycle Pipeline', category: 'linear', agentCount: 6, maxAgents: 10, description: 'NLP extraction → Risk scoring → Negotiation → Execution → Post-execution monitoring.', useCases: ['Enterprise contracts'], strengths: ['End-to-end tracking'], weaknesses: ['Complex orchestration'], estimatedLatencyMs: [8000, 25000], costMultiplier: 2.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: 'Extract → Score → Negotiate → Execute → Monitor' },
  { id: 'linear-005', name: 'Judgment Analysis Chain', category: 'linear', agentCount: 3, maxAgents: 5, description: 'Citation extraction → Precedent mapping → Legal principle distillation.', useCases: ['Case law research'], strengths: ['Deep precedent analysis'], weaknesses: ['Citation-dependent'], estimatedLatencyMs: [2000, 7000], costMultiplier: 1.1, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 1, implementationPattern: 'Citations → Precedents → Principles' },
  { id: 'linear-006', name: 'E-Filing Preparation Chain', category: 'linear', agentCount: 4, maxAgents: 6, description: 'Draft → Format → Validate → Submit chain for court e-filing.', useCases: ['NCLT filing', 'HC e-filing'], strengths: ['Error-free submission'], weaknesses: ['Requires court-specific templates'], estimatedLatencyMs: [3000, 10000], costMultiplier: 1.3, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 2, implementationPattern: 'Draft → Format → Validate → Submit' },
  { id: 'linear-007', name: 'M&A Due Diligence Chain', category: 'linear', agentCount: 8, maxAgents: 15, description: 'Corporate → IP → Employment → Regulatory → Environmental → Financial → Litigation → Summary.', useCases: ['M&A DD'], strengths: ['Comprehensive coverage'], weaknesses: ['Very high latency'], estimatedLatencyMs: [15000, 45000], costMultiplier: 3.5, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: 'Corporate→IP→Employ→Reg→Env→Fin→Lit→Summary' },
  { id: 'linear-008', name: 'IBC CIRP Chain', category: 'linear', agentCount: 5, maxAgents: 7, description: 'Default analysis → CIRP initiation → Claim collation → Resolution plan → Execution.', useCases: ['IBC insolvency matters'], strengths: ['IBC-compliant workflow'], weaknesses: ['India-only'], estimatedLatencyMs: [5000, 18000], costMultiplier: 1.8, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 2, implementationPattern: 'Default → CIRP → Claims → Plan → Execute' },
  { id: 'linear-009', name: 'Arbitration Preparation Chain', category: 'linear', agentCount: 4, maxAgents: 6, description: 'Pleading → Evidence bundling → Expert witness → Award analysis.', useCases: ['International arbitration'], strengths: ['UNCITRAL/ICC compliant'], weaknesses: ['Complex evidentiary rules'], estimatedLatencyMs: [4000, 12000], costMultiplier: 1.6, grpoCompatible: false, jurisdictions: ['IN','UK','SG','GC'], romaLevel: 2, implementationPattern: 'Plead → Bundle → Expert → Award' },
  { id: 'linear-010', name: 'Tax Litigation Chain', category: 'linear', agentCount: 5, maxAgents: 8, description: 'Assessment order → Show cause response → Appeal → Tribunal → High Court chain.', useCases: ['Income Tax, GST disputes'], strengths: ['Appeals-ready formatting'], weaknesses: ['Jurisdiction-limited'], estimatedLatencyMs: [6000, 20000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 2, implementationPattern: 'Order → SCN → Appeal → Tribunal → HC' },

  // ─── FAN-OUT / PARALLEL (8) ───────────────────────────────────────────────
  { id: 'fanout-001', name: 'Parallel Jurisdiction Analysis', category: 'fan_out', agentCount: 6, maxAgents: 6, description: 'Fan out to 6 jurisdiction agents simultaneously, merge results.', useCases: ['Cross-border contracts', 'Multi-jurisdiction compliance'], strengths: ['Speed', 'Coverage'], weaknesses: ['Higher cost'], estimatedLatencyMs: [1500, 5000], costMultiplier: 2.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: 'Query → [IN|UK|US|EU|GC|SG] → Merge' },
  { id: 'fanout-002', name: 'Multi-Clause Parallel Review', category: 'fan_out', agentCount: 10, maxAgents: 20, description: 'Fan out to clause-specialist agents in parallel, aggregate clause-level results.', useCases: ['Large contract review (50+ clauses)'], strengths: ['Very fast for large docs'], weaknesses: ['Token overhead'], estimatedLatencyMs: [2000, 6000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: 'Contract → [ClauseAgent×N] → Aggregate' },
  { id: 'fanout-003', name: 'Practice Area Fan-Out', category: 'fan_out', agentCount: 8, maxAgents: 12, description: 'Fan out query to 8 practice area agents (corp, IP, tax, employ, env, lit, arb, re), merge.', useCases: ['Complex transaction, unknown risk profile'], strengths: ['Discovers hidden risks'], weaknesses: ['Expensive'], estimatedLatencyMs: [2000, 7000], costMultiplier: 3.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 4, implementationPattern: 'Query → [Corp|IP|Tax|Employ|Env|Lit|Arb|RE] → Merge' },
  { id: 'fanout-004', name: 'Evidence Parallel Indexer', category: 'fan_out', agentCount: 5, maxAgents: 10, description: 'Fan out evidence documents to parallel OCR+extraction agents.', useCases: ['Litigation document review'], strengths: ['Fast bulk processing'], weaknesses: ['Requires document segmentation'], estimatedLatencyMs: [1000, 4000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK','US'], romaLevel: 2, implementationPattern: 'Docs → [OCR+Extract×N] → Index → Merge' },
  { id: 'fanout-005', name: 'Parallel Statute Verification', category: 'fan_out', agentCount: 4, maxAgents: 6, description: 'Simultaneously verify citations across 4 statute databases.', useCases: ['Citation audit', 'Legal brief verification'], strengths: ['Fast multi-source verification'], weaknesses: ['Database access required'], estimatedLatencyMs: [500, 2000], costMultiplier: 1.5, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 2, implementationPattern: 'Citation → [DB1|DB2|DB3|DB4] → Verify → Merge' },
  { id: 'fanout-006', name: 'Language Fan-Out', category: 'fan_out', agentCount: 5, maxAgents: 22, description: 'Translate legal query to N languages simultaneously via Sarvam AI.', useCases: ['Multilingual legal notices', 'Citizen-facing documents'], strengths: ['Parallel translation'], weaknesses: ['API rate limits'], estimatedLatencyMs: [1000, 4000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 2, implementationPattern: 'Doc → [Lang1|Lang2|...|LangN] → Merge' },
  { id: 'fanout-007', name: 'Due Diligence Fan-Out', category: 'fan_out', agentCount: 6, maxAgents: 8, description: 'Parallel DD workstreams: corporate, IP, employment, litigation, regulatory, financial.', useCases: ['PE/VC target company DD'], strengths: ['2x faster than sequential DD'], weaknesses: ['Coordination overhead'], estimatedLatencyMs: [5000, 15000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 4, implementationPattern: 'Target → [Corp|IP|Employ|Lit|Reg|Fin] → DD Report' },
  { id: 'fanout-008', name: 'Risk Dimension Fan-Out', category: 'fan_out', agentCount: 15, maxAgents: 15, description: 'Fan out contract to 15 risk-dimension specialist agents simultaneously.', useCases: ['Enterprise risk scoring'], strengths: ['Comprehensive 15-dimension coverage'], weaknesses: ['Very high token usage'], estimatedLatencyMs: [2000, 8000], costMultiplier: 5.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Contract → [Risk×15] → Score → Report' },

  // ─── HIERARCHICAL (12) ────────────────────────────────────────────────────
  { id: 'hier-001', name: 'Manager-Worker Legal', category: 'hierarchical', agentCount: 5, maxAgents: 20, description: 'Manager agent decomposes task, assigns to specialist workers, aggregates.', useCases: ['Complex litigation strategy'], strengths: ['Structured decomposition'], weaknesses: ['Manager bottleneck'], estimatedLatencyMs: [3000, 10000], costMultiplier: 2.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: 'Manager → Workers[N] → Aggregate → Report' },
  { id: 'hier-002', name: 'Partner-Associate Hierarchy', category: 'hierarchical', agentCount: 4, maxAgents: 12, description: 'Senior Partner agent supervises Associate agents, reviews output.', useCases: ['Law firm workflow simulation'], strengths: ['Quality control built-in'], weaknesses: ['Slower review cycle'], estimatedLatencyMs: [4000, 12000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 3, implementationPattern: 'Partner → [Assoc×N] → Review → Approve' },
  { id: 'hier-003', name: 'Three-Tier Legal Pyramid', category: 'hierarchical', agentCount: 7, maxAgents: 15, description: '3-tier: Specialist → Senior → Principal escalation hierarchy.', useCases: ['Complex advisory, sensitive matters'], strengths: ['Escalation-aware'], weaknesses: ['High coordination cost'], estimatedLatencyMs: [5000, 18000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 4, implementationPattern: 'Specialists → Senior → Principal → Advice' },
  { id: 'hier-004', name: 'Sectoral Practice Groups', category: 'hierarchical', agentCount: 6, maxAgents: 18, description: 'Head agent routes to sectoral practice groups (Banking, Corp, IP, Environ, Employ, Dispute).', useCases: ['Full-service firm simulation'], strengths: ['Sector expertise routing'], weaknesses: ['Inter-group communication overhead'], estimatedLatencyMs: [4000, 14000], costMultiplier: 3.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU'], romaLevel: 4, implementationPattern: 'Head → Sectors[6] → Groups → Merge' },
  { id: 'hier-005', name: 'Judicial Panel Simulation', category: 'hierarchical', agentCount: 3, maxAgents: 5, description: 'Bench of 3–5 judges deliberate, with Chief Justice agent as tiebreaker.', useCases: ['Constitutional law, appellate research'], strengths: ['Multi-judge perspective'], weaknesses: ['Long deliberation time'], estimatedLatencyMs: [6000, 20000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 4, implementationPattern: 'Query → [J1|J2|J3] → Deliberation → CJ → Judgment' },
  { id: 'hier-006', name: 'Regulatory Authority Hierarchy', category: 'hierarchical', agentCount: 4, maxAgents: 8, description: 'Regulatory → Compliance → Legal → Risk hierarchy for financial compliance.', useCases: ['SEBI, RBI, MCA compliance'], strengths: ['Authority-aware routing'], weaknesses: ['India-specific'], estimatedLatencyMs: [3000, 10000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 3, implementationPattern: 'Regulatory → Compliance → Legal → Risk → Report' },
  { id: 'hier-007', name: 'International Law Hierarchy', category: 'hierarchical', agentCount: 5, maxAgents: 10, description: 'International → Regional → National → Local law hierarchy.', useCases: ['Cross-border transactions, trade law'], strengths: ['Proper hierarchy respect'], weaknesses: ['Complex precedence rules'], estimatedLatencyMs: [4000, 14000], costMultiplier: 2.5, grpoCompatible: true, jurisdictions: ['IN','UK','EU','GC'], romaLevel: 4, implementationPattern: 'Intl → Regional → National → Local → Advice' },
  { id: 'hier-008', name: 'GRPO Teacher-Student', category: 'hierarchical', agentCount: 3, maxAgents: 6, description: 'Expert teacher agent supervises student agents and applies GRPO rewards to improve outputs.', useCases: ['Training mode, quality improvement'], strengths: ['Continuous improvement'], weaknesses: ['Higher compute'], estimatedLatencyMs: [3000, 9000], costMultiplier: 2.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Teacher → Students[N] → GRPO Reward → Improve' },
  { id: 'hier-009', name: 'Corporate Group Structure', category: 'hierarchical', agentCount: 4, maxAgents: 10, description: 'HoldCo → SubCo hierarchy mirroring corporate group structure for M&A analysis.', useCases: ['Group company transactions'], strengths: ['Structure-aware analysis'], weaknesses: ['Requires org chart input'], estimatedLatencyMs: [4000, 12000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: 'HoldCo → [SubCo1..N] → Group Analysis' },
  { id: 'hier-010', name: 'Appellate Hierarchy', category: 'hierarchical', agentCount: 5, maxAgents: 7, description: 'Trial Court → Appellate → High Court → Supreme Court hierarchy for appeal strategy.', useCases: ['Multi-level appeals strategy'], strengths: ['Court-hierarchy aware'], weaknesses: ['India/UK specific'], estimatedLatencyMs: [5000, 16000], costMultiplier: 3.0, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 3, implementationPattern: 'Trial → Appellate → HC → SC → Strategy' },
  { id: 'hier-011', name: 'Deal Team Hierarchy', category: 'hierarchical', agentCount: 6, maxAgents: 12, description: 'Deal lead → Legal → Tax → Finance → Regulatory → HR team hierarchy for transactions.', useCases: ['Private equity deals', 'Joint ventures'], strengths: ['Deal-team simulation'], weaknesses: ['High coordination overhead'], estimatedLatencyMs: [6000, 20000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 4, implementationPattern: 'Lead → [Legal|Tax|Fin|Reg|HR] → Deal Report' },
  { id: 'hier-012', name: 'HITL Escalation Hierarchy', category: 'hierarchical', agentCount: 3, maxAgents: 5, description: 'AI agents escalate to HITL expert when confidence < threshold.', useCases: ['High-stakes matters, regulatory grey areas'], strengths: ['Human oversight built-in'], weaknesses: ['Human-in-loop latency'], estimatedLatencyMs: [2000, 60000], costMultiplier: 1.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'AI Agent → [Confidence OK → Result | Low → HITL Expert → Result]' },

  // ─── ROUND-ROBIN (6) ──────────────────────────────────────────────────────
  { id: 'rr-001', name: 'Load-Balanced Legal Pool', category: 'round_robin', agentCount: 5, maxAgents: 10, description: 'Requests distributed round-robin across agent pool for load balancing.', useCases: ['High-volume query processing'], strengths: ['Horizontal scale', 'No hotspots'], weaknesses: ['No specialization'], estimatedLatencyMs: [1000, 4000], costMultiplier: 1.0, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 1, implementationPattern: 'Queue → [A1|A2|A3|A4|A5] (rotating) → Results' },
  { id: 'rr-002', name: 'Language-Aware Round-Robin', category: 'round_robin', agentCount: 5, maxAgents: 10, description: 'Round-robin among language-specialist agents, routing by detected language.', useCases: ['Multilingual legal helpline'], strengths: ['Language load balancing'], weaknesses: ['Language detection overhead'], estimatedLatencyMs: [1200, 4500], costMultiplier: 1.2, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 2, implementationPattern: 'Query → LangDetect → [LangPool] → Response' },
  { id: 'rr-003', name: 'Time-Zone Agent Rotation', category: 'round_robin', agentCount: 3, maxAgents: 6, description: 'Route to IST / GMT / EST agent pools based on time of day.', useCases: ['24/7 legal AI, global law firms'], strengths: ['Always-on coverage'], weaknesses: ['Time-zone logic complexity'], estimatedLatencyMs: [800, 3000], costMultiplier: 1.0, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 1, implementationPattern: 'Query → TimeRouter → [IST|GMT|EST] Pool → Response' },
  { id: 'rr-004', name: 'Practice Area Rotation', category: 'round_robin', agentCount: 8, maxAgents: 8, description: 'Rotate queries across 8 practice area pools to maintain even load.', useCases: ['Law firm intake'], strengths: ['Practice area coverage'], weaknesses: ['May mismatch specialization'], estimatedLatencyMs: [1000, 4000], costMultiplier: 1.2, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 1, implementationPattern: 'Intake → PracticeRouter → AreaPool[8] → Response' },
  { id: 'rr-005', name: 'Cost-Optimized Rotation', category: 'round_robin', agentCount: 4, maxAgents: 8, description: 'Rotate across premium/standard/economy agent tiers based on query complexity.', useCases: ['Cost-sensitive workflows'], strengths: ['Cost efficiency'], weaknesses: ['Quality variation'], estimatedLatencyMs: [1000, 5000], costMultiplier: 0.7, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 1, implementationPattern: 'Query → ComplexityScore → [Premium|Standard|Economy] → Response' },
  { id: 'rr-006', name: 'Jurisdiction Round-Robin', category: 'round_robin', agentCount: 6, maxAgents: 6, description: 'Round-robin across 6 jurisdiction-specialist agents for multi-jurisdiction filings.', useCases: ['Global compliance reporting'], strengths: ['Balanced jurisdiction load'], weaknesses: ['May repeat agents'], estimatedLatencyMs: [1000, 4000], costMultiplier: 1.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 2, implementationPattern: 'Query → [IN|UK|US|EU|GC|SG] Agent → Response' },

  // ─── COMPETITIVE (8) ──────────────────────────────────────────────────────
  { id: 'comp-001', name: 'Best-of-N Legal Race', category: 'competitive', agentCount: 3, maxAgents: 8, description: 'N agents race to produce answer; best-scored response wins.', useCases: ['High-quality legal drafting'], strengths: ['Quality maximization'], weaknesses: ['3x cost vs single agent'], estimatedLatencyMs: [2000, 6000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: '[A1|A2|A3] → Scorer → Best → Response' },
  { id: 'comp-002', name: 'Argument Tournament', category: 'competitive', agentCount: 4, maxAgents: 8, description: 'Agents compete to produce strongest legal argument; judge agent selects winner.', useCases: ['Adversarial legal analysis', 'Moot court'], strengths: ['Strongest argument discovery'], weaknesses: ['High token usage'], estimatedLatencyMs: [4000, 12000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 4, implementationPattern: '[Arg1|Arg2|Arg3|Arg4] → Judge → Winner' },
  { id: 'comp-003', name: 'Red-Blue Team Legal', category: 'competitive', agentCount: 4, maxAgents: 8, description: 'Red team (finds flaws) vs Blue team (defends document); judge resolves.', useCases: ['Contract stress testing', 'Risk discovery'], strengths: ['Finds weaknesses other approaches miss'], weaknesses: ['Double-cost'], estimatedLatencyMs: [3000, 10000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU'], romaLevel: 4, implementationPattern: 'Doc → Red[Attack] + Blue[Defend] → Judge → Report' },
  { id: 'comp-004', name: 'Claimant-Respondent Simulator', category: 'competitive', agentCount: 2, maxAgents: 4, description: 'Two agents take opposing legal positions; mediator scores strength of each.', useCases: ['Dispute strategy', 'Settlement analysis'], strengths: ['Balanced opposing views'], weaknesses: ['Requires mediator judgment'], estimatedLatencyMs: [3000, 9000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK','US','SG'], romaLevel: 3, implementationPattern: 'Issue → [Claimant|Respondent] → Mediator → Score' },
  { id: 'comp-005', name: 'Citation Race', category: 'competitive', agentCount: 3, maxAgents: 5, description: 'Multiple research agents race to find best supporting precedent; top-ranked wins.', useCases: ['Case law research'], strengths: ['Breadth of search'], weaknesses: ['Duplicate effort'], estimatedLatencyMs: [2000, 7000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK','US'], romaLevel: 2, implementationPattern: '[ResA|ResB|ResC] → Rank → Best Precedent' },
  { id: 'comp-006', name: 'Model Comparison Race', category: 'competitive', agentCount: 4, maxAgents: 6, description: 'Same query sent to 4 different LLMs; best-scored response wins.', useCases: ['LLM benchmarking, high-stakes queries'], strengths: ['Best model wins per query'], weaknesses: ['4x API cost'], estimatedLatencyMs: [1500, 5000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: '[GPT-4o|Claude|Gemini|Mistral] → Judge → Best' },
  { id: 'comp-007', name: 'Draft Competition', category: 'competitive', agentCount: 3, maxAgents: 5, description: 'Multiple agents draft same clause; human or judge agent picks best draft.', useCases: ['High-value contract clauses'], strengths: ['Best draft selected'], weaknesses: ['HITL dependency optional'], estimatedLatencyMs: [3000, 9000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: '[Draft1|Draft2|Draft3] → [HITL|Judge] → Best Draft' },
  { id: 'comp-008', name: 'Regulatory Interpretation Race', category: 'competitive', agentCount: 3, maxAgents: 5, description: 'Multiple regulatory agents interpret same provision; consensus or best-scored wins.', useCases: ['Regulatory grey areas'], strengths: ['Multiple interpretations considered'], weaknesses: ['May produce conflicting views'], estimatedLatencyMs: [2500, 8000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','EU','UK'], romaLevel: 3, implementationPattern: '[RegA|RegB|RegC] → Judge → Best Interpretation' },

  // ─── CONSENSUS (10) ───────────────────────────────────────────────────────
  { id: 'cons-001', name: 'Majority Vote Legal', category: 'consensus', agentCount: 3, maxAgents: 9, description: '3–9 agents vote on legal conclusion; majority wins.', useCases: ['Binary legal questions', 'Validity opinions'], strengths: ['Democratic', 'Reduces single-agent bias'], weaknesses: ['Odd agent count required'], estimatedLatencyMs: [2000, 7000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: '[A1|A2|A3] → Vote → Majority → Decision' },
  { id: 'cons-002', name: 'Weighted Expert Consensus', category: 'consensus', agentCount: 5, maxAgents: 10, description: 'Agents weighted by expertise score; weighted vote determines consensus.', useCases: ['Specialized legal opinions'], strengths: ['Expertise-weighted accuracy'], weaknesses: ['Weight calibration required'], estimatedLatencyMs: [3000, 9000], costMultiplier: 3.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 4, implementationPattern: '[A1(w)|A2(w)|A3(w)] → WeightedVote → Consensus' },
  { id: 'cons-003', name: 'Delphi Legal Round', category: 'consensus', agentCount: 5, maxAgents: 10, description: 'Multiple Delphi rounds: agents submit opinions, see others, revise, repeat until convergence.', useCases: ['Complex legal questions, policy analysis'], strengths: ['Convergence to high-quality answer'], weaknesses: ['Multi-round latency'], estimatedLatencyMs: [8000, 25000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 5, implementationPattern: '[Round1] → [See Others] → [Revise] × N → Consensus' },
  { id: 'cons-004', name: 'Risk Consensus Scoring', category: 'consensus', agentCount: 5, maxAgents: 8, description: 'Risk-scorer agents independently score document; average score is consensus.', useCases: ['Contract risk aggregation'], strengths: ['Robust to outlier agents'], weaknesses: ['Numerical aggregation only'], estimatedLatencyMs: [2000, 6000], costMultiplier: 2.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: '[Score1|Score2|...|Score5] → Average → Risk Score' },
  { id: 'cons-005', name: 'Precedent Consensus', category: 'consensus', agentCount: 3, maxAgents: 7, description: 'Research agents independently find precedents; only commonly cited ones pass consensus filter.', useCases: ['High-confidence precedent lists'], strengths: ['High-confidence citations only'], weaknesses: ['May miss relevant minority precedents'], estimatedLatencyMs: [3000, 10000], costMultiplier: 3.0, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 3, implementationPattern: '[Res1|Res2|Res3] → Intersect → Common Precedents' },
  { id: 'cons-006', name: 'Hallucination Filter Consensus', category: 'consensus', agentCount: 4, maxAgents: 6, description: 'Multiple verification agents independently verify LLM claims; consensus determines accuracy.', useCases: ['High-stakes fact verification'], strengths: ['Anti-hallucination'], weaknesses: ['Slower verification'], estimatedLatencyMs: [2000, 6000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 4, implementationPattern: 'Claims → [Verify1|Verify2|Verify3|Verify4] → Consensus → Verified' },
  { id: 'cons-007', name: 'Translation Consensus', category: 'consensus', agentCount: 3, maxAgents: 5, description: 'Three translation agents translate same text; most-similar pair wins by BLEU consensus.', useCases: ['High-stakes multilingual legal documents'], strengths: ['Translation quality assurance'], weaknesses: ['3x translation cost'], estimatedLatencyMs: [2000, 6000], costMultiplier: 3.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 3, implementationPattern: '[Trans1|Trans2|Trans3] → BLEU → Best Translation' },
  { id: 'cons-008', name: 'Compliance Consensus', category: 'consensus', agentCount: 5, maxAgents: 8, description: 'Multiple compliance agents independently assess document; consensus determines compliance status.', useCases: ['Regulatory compliance certification'], strengths: ['High-confidence compliance assessment'], weaknesses: ['Multiple agent overhead'], estimatedLatencyMs: [3000, 9000], costMultiplier: 3.5, grpoCompatible: false, jurisdictions: ['IN','EU','UK'], romaLevel: 4, implementationPattern: '[Comp1|...|Comp5] → Consensus → Compliance Status' },
  { id: 'cons-009', name: 'Clause Consensus', category: 'consensus', agentCount: 3, maxAgents: 5, description: 'Three drafting agents write same clause; human/judge picks consensus best.', useCases: ['Critical contract clauses'], strengths: ['Best clause selection'], weaknesses: ['Redundant drafting'], estimatedLatencyMs: [3000, 9000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: '[Clause1|Clause2|Clause3] → Judge → Best Clause' },
  { id: 'cons-010', name: 'Sentiment Consensus (Regulatory)', category: 'consensus', agentCount: 3, maxAgents: 5, description: 'Multiple sentiment/tone agents assess regulatory tone; consensus determines tone class.', useCases: ['Regulatory correspondence tone analysis'], strengths: ['Robust tone detection'], weaknesses: ['Edge case disagreements'], estimatedLatencyMs: [1000, 3000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK','EU'], romaLevel: 2, implementationPattern: '[Tone1|Tone2|Tone3] → Consensus → Tone Class' },

  // ─── ITERATIVE (8) ────────────────────────────────────────────────────────
  { id: 'iter-001', name: 'Critique-Revise Loop', category: 'iterative', agentCount: 2, maxAgents: 4, description: 'Draft agent → Critique agent → Revise agent, up to N iterations until quality threshold met.', useCases: ['Document drafting', 'Brief writing'], strengths: ['Self-improving quality'], weaknesses: ['Latency grows with iterations'], estimatedLatencyMs: [3000, 15000], costMultiplier: 2.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: 'Draft → [Critique → Revise] × N until quality ≥ threshold' },
  { id: 'iter-002', name: 'GRPO Reward Loop', category: 'iterative', agentCount: 2, maxAgents: 4, description: 'Agent produces response, GRPO scorer rewards/penalizes, agent improves via gradient-free RL.', useCases: ['Legal quality optimization, training'], strengths: ['Continuous quality improvement'], weaknesses: ['Compute-intensive'], estimatedLatencyMs: [5000, 20000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Agent → GRPO Score → Reward/Penalize → Improve × N' },
  { id: 'iter-003', name: 'Negotiation Simulation Loop', category: 'iterative', agentCount: 2, maxAgents: 4, description: 'Two agents simulate contract negotiation, iterating on positions until agreement or deadlock.', useCases: ['Pre-negotiation strategy', 'Settlement scenarios'], strengths: ['Realistic negotiation dynamics'], weaknesses: ['May not converge'], estimatedLatencyMs: [4000, 20000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: '[Party A] ↔ [Party B] ↔ ... → Agreement | Deadlock' },
  { id: 'iter-004', name: 'Hallucination Correction Loop', category: 'iterative', agentCount: 2, maxAgents: 3, description: 'Generate → Check hallucinations → Correct → Check again, until clean.', useCases: ['High-stakes legal factual content'], strengths: ['High factual accuracy'], weaknesses: ['Multiple LLM calls'], estimatedLatencyMs: [3000, 12000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 4, implementationPattern: 'Generate → HallucinationCheck → [Clean | Correct → Recheck]' },
  { id: 'iter-005', name: 'Progressive Refinement', category: 'iterative', agentCount: 1, maxAgents: 3, description: 'Single agent refines output progressively — Draft → Expand → Polish → Finalize.', useCases: ['Long-form legal writing'], strengths: ['Incremental improvement'], weaknesses: ['Multiple calls required'], estimatedLatencyMs: [4000, 16000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK','US'], romaLevel: 2, implementationPattern: 'Draft → Expand → Polish → Finalize' },
  { id: 'iter-006', name: 'Compliance Remediation Loop', category: 'iterative', agentCount: 2, maxAgents: 3, description: 'Draft → Compliance check → Remediate non-compliant clauses → Re-check until compliant.', useCases: ['Regulatory filings, compliance certification'], strengths: ['Guaranteed compliance output'], weaknesses: ['May loop multiple times'], estimatedLatencyMs: [4000, 18000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','EU','UK'], romaLevel: 3, implementationPattern: 'Draft → [ComplianceCheck → Remediate] × N → Compliant' },
  { id: 'iter-007', name: 'Citation Enrichment Loop', category: 'iterative', agentCount: 2, maxAgents: 3, description: 'Draft → Citation audit → Add missing citations → Re-audit until citation density met.', useCases: ['Academic legal papers, HC briefs'], strengths: ['High citation density'], weaknesses: ['Citation DB access required'], estimatedLatencyMs: [3000, 12000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 2, implementationPattern: 'Draft → [CitationAudit → Enrich] × N → Fully Cited' },
  { id: 'iter-008', name: 'Risk Reduction Loop', category: 'iterative', agentCount: 2, maxAgents: 4, description: 'Draft → Risk score → Revise high-risk clauses → Re-score until risk ≤ threshold.', useCases: ['Risk-aware contract drafting'], strengths: ['Risk minimization'], weaknesses: ['May over-negotiate clauses'], estimatedLatencyMs: [4000, 18000], costMultiplier: 2.5, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 4, implementationPattern: 'Draft → [RiskScore → Revise] × N → Low-Risk Doc' },

  // ─── SPECIALIZED (12) ────────────────────────────────────────────────────
  { id: 'spec-001', name: 'IBC CIRP Swarm', category: 'specialized', agentCount: 5, maxAgents: 8, description: 'Specialized IBC agents: RP advisor, FC analyst, OC claim handler, NCLT drafter, liquidation planner.', useCases: ['IBC insolvency proceedings'], strengths: ['Deep IBC expertise'], weaknesses: ['India-only'], estimatedLatencyMs: [5000, 18000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 3, implementationPattern: 'IBC Matter → [RP|FC|OC|NCLT|Liq] → CIRP Report' },
  { id: 'spec-002', name: 'IPO Due Diligence Swarm', category: 'specialized', agentCount: 6, maxAgents: 10, description: 'Specialized agents: DRHP drafter, SEBI compliance, Company Law, Tax, Disclosure, Litigation.', useCases: ['IPO preparation'], strengths: ['SEBI-LODR compliant'], weaknesses: ['India-only, complex'], estimatedLatencyMs: [8000, 25000], costMultiplier: 4.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 4, implementationPattern: '[DRHP|SEBI|Company|Tax|Disc|Lit] → IPO DD Report' },
  { id: 'spec-003', name: 'Real Estate Swarm', category: 'specialized', agentCount: 5, maxAgents: 8, description: 'Title search, RERA compliance, stamp duty, mutation, encumbrance agents.', useCases: ['Property transactions, RERA filings'], strengths: ['RERA-compliant'], weaknesses: ['State-specific stamp duty'], estimatedLatencyMs: [4000, 14000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 3, implementationPattern: '[Title|RERA|Stamp|Mutation|Encumbrances] → Property Report' },
  { id: 'spec-004', name: 'GDPR DPO Swarm', category: 'specialized', agentCount: 4, maxAgents: 6, description: 'GDPR specialist agents: DPIA, consent, data mapping, breach notification.', useCases: ['GDPR compliance program'], strengths: ['GDPR/UK-GDPR/PDPA expert'], weaknesses: ['EU/UK/SG only'], estimatedLatencyMs: [3000, 10000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['EU','UK','SG'], romaLevel: 3, implementationPattern: '[DPIA|Consent|DataMap|Breach] → GDPR Report' },
  { id: 'spec-005', name: 'Employment Law Swarm', category: 'specialized', agentCount: 4, maxAgents: 6, description: 'Employment agents: POSH, Shops & Estab, PF/ESI, Termination, Non-compete.', useCases: ['HR compliance, employment contracts'], strengths: ['India employment law expert'], weaknesses: ['India-specific'], estimatedLatencyMs: [3000, 10000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK'], romaLevel: 3, implementationPattern: '[POSH|Shops|PF|Term|NonCompete] → Employment Report' },
  { id: 'spec-006', name: 'GCC Sharia Finance Swarm', category: 'specialized', agentCount: 4, maxAgents: 6, description: 'Sharia-compliant financing agents: murabaha, ijara, sukuk, compliance advisor.', useCases: ['Islamic finance transactions'], strengths: ['Sharia-compliant'], weaknesses: ['GCC-only, specialist domain'], estimatedLatencyMs: [3000, 10000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['GC'], romaLevel: 3, implementationPattern: '[Murabaha|Ijara|Sukuk|Compliance] → Sharia Finance Report' },
  { id: 'spec-007', name: 'Cybercrime Legal Swarm', category: 'specialized', agentCount: 4, maxAgents: 6, description: 'IT Act 2000, CERT-In regulations, data breach, cyber forensics, FIR drafting agents.', useCases: ['Cybercrime cases, data breach response'], strengths: ['IT Act expert'], weaknesses: ['Fast-evolving law'], estimatedLatencyMs: [3000, 10000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 3, implementationPattern: '[IT Act|CERT|Breach|Forensics|FIR] → Cyber Report' },
  { id: 'spec-008', name: 'Environment Law Swarm', category: 'specialized', agentCount: 4, maxAgents: 6, description: 'EIA, CRZ, NGT, Pollution Board, Carbon credits — specialized environmental agents.', useCases: ['Infrastructure projects, ESG compliance'], strengths: ['Environmental compliance expert'], weaknesses: ['State-specific clearance processes'], estimatedLatencyMs: [3000, 12000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','EU'], romaLevel: 3, implementationPattern: '[EIA|CRZ|NGT|Pollution|Carbon] → Env Clearance Report' },
  { id: 'spec-009', name: 'Startup/VC Legal Swarm', category: 'specialized', agentCount: 5, maxAgents: 8, description: 'DPIIT recognition, ESOP, Term Sheet, SHA, SPA agents for startup legal work.', useCases: ['Startup funding, equity documents'], strengths: ['Startup-ecosystem expertise'], weaknesses: ['Fast-evolving startup law'], estimatedLatencyMs: [4000, 12000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','US','SG'], romaLevel: 3, implementationPattern: '[DPIIT|ESOP|TermSheet|SHA|SPA] → Startup Legal Package' },
  { id: 'spec-010', name: 'Patent Prosecution Swarm', category: 'specialized', agentCount: 5, maxAgents: 8, description: 'Patent search, claims drafting, specification, prior art, IPO filing agents.', useCases: ['Patent applications, IP prosecution'], strengths: ['Patent law expertise'], weaknesses: ['Technical domain knowledge required'], estimatedLatencyMs: [5000, 18000], costMultiplier: 3.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU'], romaLevel: 4, implementationPattern: '[Search|Claims|Spec|PriorArt|IPO] → Patent Application' },
  { id: 'spec-011', name: 'GST Litigation Swarm', category: 'specialized', agentCount: 4, maxAgents: 6, description: 'GSTN, SCN, AAR, GSTAT, HC/SC appeal agents for GST disputes.', useCases: ['GST disputes, advance ruling'], strengths: ['GST litigation expert'], weaknesses: ['India-only'], estimatedLatencyMs: [4000, 12000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 3, implementationPattern: '[GSTN|SCN|AAR|GSTAT|Appeal] → GST Strategy' },
  { id: 'spec-012', name: 'International Trade Swarm', category: 'specialized', agentCount: 5, maxAgents: 8, description: 'WTO, customs, anti-dumping, trade remedy, FTA specialist agents.', useCases: ['Import/export, trade disputes'], strengths: ['International trade expert'], weaknesses: ['Multi-jurisdiction complexity'], estimatedLatencyMs: [4000, 14000], costMultiplier: 3.0, grpoCompatible: false, jurisdictions: ['IN','EU','US'], romaLevel: 4, implementationPattern: '[WTO|Customs|AntiDump|TradeFTA] → Trade Strategy' },

  // ─── HYBRID (15) ─────────────────────────────────────────────────────────
  { id: 'hyb-001', name: 'Fan-Out + Consensus Hybrid', category: 'hybrid', agentCount: 6, maxAgents: 12, description: 'Fan out to parallel agents, then run consensus voting on results.', useCases: ['High-confidence analysis'], strengths: ['Speed + quality'], weaknesses: ['High cost'], estimatedLatencyMs: [2500, 8000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 4, implementationPattern: 'Query → [Parallel×N] → Consensus → Best Answer' },
  { id: 'hyb-002', name: 'Hierarchical + Iterative Hybrid', category: 'hybrid', agentCount: 5, maxAgents: 10, description: 'Hierarchical task decomposition, then iterative refinement of each sub-task.', useCases: ['Complex multi-part legal opinions'], strengths: ['Structure + quality'], weaknesses: ['High latency'], estimatedLatencyMs: [6000, 22000], costMultiplier: 4.5, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 5, implementationPattern: 'Manager → Workers[N] → [Critique-Revise×N] → Report' },
  { id: 'hyb-003', name: 'Competitive + Consensus Hybrid', category: 'hybrid', agentCount: 6, maxAgents: 10, description: 'N agents compete, then survivors enter consensus round.', useCases: ['Legal opinion, contract drafting'], strengths: ['Darwin-style quality filter'], weaknesses: ['Very high cost'], estimatedLatencyMs: [5000, 18000], costMultiplier: 5.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: '[Compete×N] → Top-K → Consensus → Final' },
  { id: 'hyb-004', name: 'Specialist + Generalist Hybrid', category: 'hybrid', agentCount: 4, maxAgents: 8, description: 'Specialist agents handle domain parts; generalist synthesizes.', useCases: ['Multi-domain legal advisory'], strengths: ['Domain depth + synthesis'], weaknesses: ['Synthesis agent is bottleneck'], estimatedLatencyMs: [4000, 14000], costMultiplier: 3.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 4, implementationPattern: '[Spec1..N] → Generalist Synthesizer → Advice' },
  { id: 'hyb-005', name: 'GRPO + Consensus Hybrid', category: 'hybrid', agentCount: 4, maxAgents: 8, description: 'GRPO-scored generation, then consensus among top-K outputs.', useCases: ['Highest quality legal reasoning'], strengths: ['SOTA quality'], weaknesses: ['Highest compute'], estimatedLatencyMs: [6000, 20000], costMultiplier: 5.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: '[Generate×N] → GRPO Score → Top-K → Consensus → Final' },
  { id: 'hyb-006', name: 'Language-Aware Hierarchical', category: 'hybrid', agentCount: 5, maxAgents: 10, description: 'Auto-detect language → route to language-specialist hierarchy → translate result.', useCases: ['Multilingual legal platform'], strengths: ['Language + domain expertise'], weaknesses: ['Translation overhead'], estimatedLatencyMs: [3000, 12000], costMultiplier: 3.0, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: 'LangDetect → LangHierarchy → LegalResult → Translate' },
  { id: 'hyb-007', name: 'Sequential + Fan-Out Hybrid', category: 'hybrid', agentCount: 5, maxAgents: 10, description: 'Sequential preprocessing then fan-out to parallel specialist agents.', useCases: ['Long contract review'], strengths: ['Structured + parallel'], weaknesses: ['Two-phase latency'], estimatedLatencyMs: [3500, 12000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 3, implementationPattern: 'Preprocess → Segment → [Parallel Agents×N] → Merge' },
  { id: 'hyb-008', name: 'Cost-Quality Adaptive', category: 'hybrid', agentCount: 3, maxAgents: 8, description: 'Adaptive topology: simple queries → cheap linear, complex queries → expensive consensus.', useCases: ['Cost-optimized production deployment'], strengths: ['Optimal cost-quality tradeoff'], weaknesses: ['Complexity classifier overhead'], estimatedLatencyMs: [1000, 10000], costMultiplier: 1.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: 'Query → ComplexityClassify → [Linear|FanOut|Consensus]' },
  { id: 'hyb-009', name: 'ROMA L5 + Specialist Hybrid', category: 'hybrid', agentCount: 6, maxAgents: 12, description: 'ROMA L5 orchestrator dispatches to domain specialists, aggregates with ROMA scoring.', useCases: ['Production ROMA L5 deployment'], strengths: ['ROMA-compliant + specialized'], weaknesses: ['ROMA L5 overhead'], estimatedLatencyMs: [4000, 14000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'ROMA Orch → [Spec×N] → ROMA Score → Report' },
  { id: 'hyb-010', name: 'Red-Blue + Consensus Hybrid', category: 'hybrid', agentCount: 5, maxAgents: 8, description: 'Red-Blue team attack/defense followed by consensus judgment.', useCases: ['High-stakes contract negotiation'], strengths: ['Adversarial + democratic'], weaknesses: ['Complex orchestration'], estimatedLatencyMs: [5000, 16000], costMultiplier: 4.5, grpoCompatible: false, jurisdictions: ['IN','UK','US'], romaLevel: 4, implementationPattern: '[Red|Blue] → Judge → [Consensus×N] → Decision' },
  { id: 'hyb-011', name: 'Iterative + Fan-Out Hybrid', category: 'hybrid', agentCount: 4, maxAgents: 8, description: 'Initial draft → fan out for parallel critique → aggregate critiques → revise → repeat.', useCases: ['Complex legal brief writing'], strengths: ['Parallelized improvement'], weaknesses: ['High iteration cost'], estimatedLatencyMs: [5000, 18000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US'], romaLevel: 4, implementationPattern: 'Draft → [Critique×N] → Aggregate → Revise × iterations' },
  { id: 'hyb-012', name: 'Verified HITL Hybrid', category: 'hybrid', agentCount: 3, maxAgents: 6, description: 'AI generates → AI verifies → if uncertain, HITL expert confirms → certified output.', useCases: ['Regulatory filings, court submissions'], strengths: ['AI speed + human reliability'], weaknesses: ['HITL introduces latency'], estimatedLatencyMs: [2000, 120000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'AI Gen → AI Verify → [OK→Deliver | Uncertain→HITL→Certify]' },
  { id: 'hyb-013', name: 'Streaming + Consensus Hybrid', category: 'hybrid', agentCount: 4, maxAgents: 8, description: 'Stream partial results to user while consensus completes in background.', useCases: ['UX-critical legal platforms'], strengths: ['Perceived speed + background quality'], weaknesses: ['Streaming complexity'], estimatedLatencyMs: [500, 8000], costMultiplier: 2.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 3, implementationPattern: 'Stream Partial → [Consensus BG] → Replace with Final' },
  { id: 'hyb-014', name: 'Quantum-GRPO Hybrid', category: 'hybrid', agentCount: 5, maxAgents: 10, description: 'Quantum-inspired optimization selects agent configurations, GRPO refines quality.', useCases: ['Research mode, optimal agent selection'], strengths: ['Theoretically optimal configuration'], weaknesses: ['Experimental, high compute'], estimatedLatencyMs: [8000, 30000], costMultiplier: 6.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'QOpt → Agent Config → [Execute] → GRPO → Improve' },
  { id: 'hyb-015', name: 'Multi-Modal Legal Hybrid', category: 'hybrid', agentCount: 4, maxAgents: 6, description: 'Text + OCR + Audio (WhatsApp) agents work together for multi-modal legal intake.', useCases: ['Legal intake via multiple channels'], strengths: ['Omni-channel legal AI'], weaknesses: ['Multi-modal overhead'], estimatedLatencyMs: [2000, 10000], costMultiplier: 3.0, grpoCompatible: false, jurisdictions: ['IN'], romaLevel: 3, implementationPattern: '[Text|OCR|Audio|Vision] → Normalize → Legal Engine → Response' },

  // ─── QUANTUM-READY (8) ────────────────────────────────────────────────────
  { id: 'qr-001', name: 'Quantum Key Distribution Legal', category: 'quantum_ready', agentCount: 2, maxAgents: 4, description: 'Quantum-safe (ML-KEM-512) encrypted agent communications for sensitive legal data.', useCases: ['State secrets, attorney-client privilege'], strengths: ['Post-quantum security'], weaknesses: ['Encryption overhead'], estimatedLatencyMs: [1500, 5000], costMultiplier: 1.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Query → QKD Encrypt → Agent → QKD Decrypt → Result' },
  { id: 'qr-002', name: 'ZKP Evidence Chain', category: 'quantum_ready', agentCount: 3, maxAgents: 5, description: 'Zero-Knowledge Proof (PLONK) based evidence verification without revealing sensitive contents.', useCases: ['Whistleblower protection, sensitive evidence'], strengths: ['Privacy-preserving verification'], weaknesses: ['ZKP circuit complexity'], estimatedLatencyMs: [2000, 8000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK','EU'], romaLevel: 5, implementationPattern: 'Evidence → ZKP Proof → Verify without Reveal → Legal Action' },
  { id: 'qr-003', name: 'Quantum Random Legal Sampling', category: 'quantum_ready', agentCount: 3, maxAgents: 6, description: 'Quantum random sampling for unbiased precedent selection in complex cases.', useCases: ['Objective precedent sampling, audit'], strengths: ['True randomness, unbiased'], weaknesses: ['Quantum RNG dependency'], estimatedLatencyMs: [1000, 3000], costMultiplier: 1.5, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 4, implementationPattern: 'PrecedentPool → QRandom Sample → Analysis → Report' },
  { id: 'qr-004', name: 'CRYSTALS-Dilithium Signature', category: 'quantum_ready', agentCount: 2, maxAgents: 2, description: 'Quantum-safe digital signatures (CRYSTALS-Dilithium) for legal documents.', useCases: ['Electronic signatures, notarization'], strengths: ['Quantum-resistant signatures'], weaknesses: ['Larger signature size'], estimatedLatencyMs: [500, 2000], costMultiplier: 1.2, grpoCompatible: false, jurisdictions: ['IN','UK','EU','SG'], romaLevel: 5, implementationPattern: 'Document → Dilithium Sign → Verify → Certify' },
  { id: 'qr-005', name: 'Quantum-Enhanced Search', category: 'quantum_ready', agentCount: 4, maxAgents: 6, description: 'Grover-inspired vector search for faster precedent retrieval from large databases.', useCases: ['Large corpus legal research'], strengths: ['Theoretical √N speedup'], weaknesses: ['Requires quantum vector DB'], estimatedLatencyMs: [500, 2000], costMultiplier: 2.0, grpoCompatible: false, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Query → QSearch[√N] → Precedents → Analysis' },
  { id: 'qr-006', name: 'Quantum Optimization Agent Selection', category: 'quantum_ready', agentCount: 5, maxAgents: 20, description: 'QAOA-inspired agent selection optimization for best agent-task assignment.', useCases: ['High-volume agent routing'], strengths: ['Near-optimal assignment'], weaknesses: ['QAOA approximation'], estimatedLatencyMs: [2000, 8000], costMultiplier: 2.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Tasks → QAOA → Optimal Agent Assignment → Execute' },
  { id: 'qr-007', name: 'Homomorphic Encrypted Compliance', category: 'quantum_ready', agentCount: 2, maxAgents: 3, description: 'Run compliance checks on homomorphically encrypted legal data without decryption.', useCases: ['Data sovereignty, cross-border privacy'], strengths: ['Compute on encrypted data'], weaknesses: ['HE performance overhead'], estimatedLatencyMs: [3000, 15000], costMultiplier: 3.0, grpoCompatible: false, jurisdictions: ['EU','UK','SG'], romaLevel: 5, implementationPattern: 'Encrypt(Doc) → HE-Compliance-Check → Decrypt(Result)' },
  { id: 'qr-008', name: 'Quantum Digital Twin Legal', category: 'quantum_ready', agentCount: 4, maxAgents: 8, description: 'Quantum-state digital twin of legal entity for multi-scenario Monte Carlo simulation.', useCases: ['Risk modeling, scenario planning'], strengths: ['Multi-scenario analysis'], weaknesses: ['Simulation complexity'], estimatedLatencyMs: [4000, 18000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Entity → QuantumTwin → MonteCarlo × N → Risk Report' },

  // ─── ROMA L5 (10) ─────────────────────────────────────────────────────────
  { id: 'roma-001', name: 'ROMA L5 Standard', category: 'roma_l5', agentCount: 5, maxAgents: 10, description: 'Full ROMA L5 protocol: routing, orchestration, monitoring, action, quality assurance.', useCases: ['Production ROMA L5 deployment'], strengths: ['ROMA-compliant, auditable, quality-gated'], weaknesses: ['Complex setup'], estimatedLatencyMs: [3000, 10000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'R→O→M→A+GRPO→QA→L5 Response' },
  { id: 'roma-002', name: 'ROMA L5 + GRPO Turbo', category: 'roma_l5', agentCount: 6, maxAgents: 12, description: 'ROMA L5 with GRPO reward optimization enabled — highest quality output.', useCases: ['Supreme Court research, high-stakes advice'], strengths: ['Best quality'], weaknesses: ['Highest cost'], estimatedLatencyMs: [5000, 18000], costMultiplier: 5.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'ROMA-L5 → GRPO Loop × 5 → Best' },
  { id: 'roma-003', name: 'ROMA L5 India Focus', category: 'roma_l5', agentCount: 5, maxAgents: 10, description: 'ROMA L5 optimized for Indian legal system: BNS, IPC, CPC, IBC, SEBI, RBI.', useCases: ['India-specific complex matters'], strengths: ['India-tuned ROMA L5'], weaknesses: ['India-only'], estimatedLatencyMs: [3000, 10000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['IN'], romaLevel: 5, implementationPattern: 'ROMA-L5[IN] → BNS/IPC/CPC/IBC → Report' },
  { id: 'roma-004', name: 'ROMA L5 UK/EU Cross', category: 'roma_l5', agentCount: 5, maxAgents: 10, description: 'ROMA L5 for UK/EU post-Brexit dual compliance.', useCases: ['UK-EU cross-border matters'], strengths: ['UK GDPR + EU GDPR compliance'], weaknesses: ['Post-Brexit complexity'], estimatedLatencyMs: [3500, 12000], costMultiplier: 3.5, grpoCompatible: true, jurisdictions: ['UK','EU'], romaLevel: 5, implementationPattern: 'ROMA-L5[UK+EU] → Cross-border → Report' },
  { id: 'roma-005', name: 'ROMA L5 GCC Sharia', category: 'roma_l5', agentCount: 5, maxAgents: 10, description: 'ROMA L5 with Sharia-compliance layer for GCC jurisdictions.', useCases: ['UAE, Saudi, Qatar legal matters'], strengths: ['GCC-compliant, Sharia-aware'], weaknesses: ['GCC-only'], estimatedLatencyMs: [3500, 12000], costMultiplier: 3.5, grpoCompatible: true, jurisdictions: ['GC'], romaLevel: 5, implementationPattern: 'ROMA-L5[GCC] → Sharia Layer → Report' },
  { id: 'roma-006', name: 'ROMA L5 US Federal', category: 'roma_l5', agentCount: 5, maxAgents: 10, description: 'ROMA L5 for US federal and state law compliance.', useCases: ['US legal matters, SEC, FCPA'], strengths: ['US-tuned ROMA L5'], weaknesses: ['State-law variations'], estimatedLatencyMs: [3000, 10000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['US'], romaLevel: 5, implementationPattern: 'ROMA-L5[US] → Federal+State → Report' },
  { id: 'roma-007', name: 'ROMA L5 Singapore', category: 'roma_l5', agentCount: 5, maxAgents: 10, description: 'ROMA L5 for Singapore law: PDPA, Companies Act, IAA, SFA.', useCases: ['Singapore corporate, arbitration'], strengths: ['SG-tuned ROMA L5'], weaknesses: ['SG-only'], estimatedLatencyMs: [3000, 10000], costMultiplier: 3.0, grpoCompatible: true, jurisdictions: ['SG'], romaLevel: 5, implementationPattern: 'ROMA-L5[SG] → PDPA/Companies/SFA → Report' },
  { id: 'roma-008', name: 'ROMA L5 Multi-Lingual', category: 'roma_l5', agentCount: 6, maxAgents: 12, description: 'ROMA L5 with 47-language auto-routing layer.', useCases: ['Pan-India multilingual legal platform'], strengths: ['ROMA L5 + 47-language coverage'], weaknesses: ['Translation overhead'], estimatedLatencyMs: [4000, 15000], costMultiplier: 4.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'LangDetect → ROMA-L5 → Translate Back' },
  { id: 'roma-009', name: 'ROMA L5 + Digital Twin', category: 'roma_l5', agentCount: 6, maxAgents: 12, description: 'ROMA L5 orchestration with Digital Twin monitoring for live legal entity simulation.', useCases: ['Enterprise legal departments'], strengths: ['Real-time legal entity simulation'], weaknesses: ['Complex integration'], estimatedLatencyMs: [4000, 14000], costMultiplier: 4.5, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'ROMA-L5 → DigitalTwin Monitor → Report + Alerts' },
  { id: 'roma-010', name: 'ROMA L5 Full Autonomous', category: 'roma_l5', agentCount: 10, maxAgents: 20, description: 'Fully autonomous ROMA L5 — no HITL required. Self-monitors, self-corrects, self-reports.', useCases: ['Automated legal monitoring, compliance reporting'], strengths: ['Zero-touch automation'], weaknesses: ['No human oversight (use carefully)'], estimatedLatencyMs: [5000, 20000], costMultiplier: 5.0, grpoCompatible: true, jurisdictions: ['IN','UK','US','EU','GC','SG'], romaLevel: 5, implementationPattern: 'Auto-ROMA-L5 → Self-Correct → Self-Monitor → Autonomous Report' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NV-TOPOLOGY-DISPATCH-001 — map each topology category to the Queen's
 * structural orchestration mode so the 107 topologies ACTUALLY shape execution
 * (via the Queen's forced-mode decomposition path) instead of being a catalog
 * label. Categories collapse onto the five real executor shapes the Queen
 * supports (sequential / parallel / hierarchical / dag / swarm).
 */
const TOPOLOGY_CATEGORY_TO_MODE: Record<
  TopologyCategory,
  'single_agent' | 'sequential' | 'parallel' | 'dag' | 'swarm' | 'hierarchical'
> = {
  linear: 'sequential',        // A → B → C pipeline
  fan_out: 'parallel',         // branch + merge
  hierarchical: 'hierarchical',// manager → workers
  round_robin: 'parallel',     // load-balanced pool
  competitive: 'swarm',        // best-of-N / tournament
  consensus: 'swarm',          // vote / aggregate
  iterative: 'sequential',     // critique → revise loop
  specialized: 'parallel',     // fan to domain specialists
  hybrid: 'dag',               // mixed strategy graph
  quantum_ready: 'parallel',   // small multi-agent
  roma_l5: 'hierarchical',     // ROMA orchestrator → specialists
};

function resolveAgentsForTopology(topology: SwarmTopology, jurisdiction: string, explicitAgents?: string[]): string[] {
  if (explicitAgents?.length) return explicitAgents.slice(0, topology.maxAgents);
  const pool = getAgentsByJurisdiction(jurisdiction);
  const source = pool.length > 0 ? pool : getAllAgents();
  return source
    .filter(agent => agent.status === 'active')
    .slice(0, Math.min(topology.agentCount, topology.maxAgents))
    .map(agent => agent.id);
}

async function executeTopology(request: SwarmExecutionRequest): Promise<SwarmExecutionResult> {
  const topology = SWARM_TOPOLOGIES.find(t => t.id === request.topologyId);
  if (!topology) {
    throw new Error(`Unknown swarm topology: ${request.topologyId}`);
  }

  const started = Date.now();
  const agentsUsed = resolveAgentsForTopology(topology, request.jurisdiction, request.agents);
  if (agentsUsed.length === 0) {
    throw new Error(`No active v5.1.0 registry agents for jurisdiction ${request.jurisdiction}`);
  }

  const orchestrationMode = TOPOLOGY_CATEGORY_TO_MODE[topology.category];

  logger.info('[SwarmTopology] executing via Queen orchestrator', {
    topologyId: topology.id,
    category: topology.category,
    orchestrationMode,
    agents: agentsUsed.length,
    jurisdiction: request.jurisdiction,
  });

  const algorithmPlan = getTopologyAlgorithmPlan(topology.category);

  // NV-TOPOLOGY-SHAPE-001: per-topology decomposition — each of the 107 shapes
  const topologyContext = [
    `Topology ID: ${topology.id}`,
    `Category: ${topology.category}`,
    `Algorithm: ${algorithmPlan.algorithm}`,
    `Pattern: ${topology.implementationPattern}`,
    `Agent budget: ${agentsUsed.length}/${topology.agentCount} (max ${topology.maxAgents})`,
    `ROMA level: L${topology.romaLevel}`,
    `Cost multiplier: ${topology.costMultiplier}x`,
    `GRPO-compatible: ${topology.grpoCompatible ? 'yes' : 'no'}`,
    `Latency envelope: ${topology.estimatedLatencyMs[0]}–${topology.estimatedLatencyMs[1]}ms`,
    `Use cases: ${topology.useCases.join('; ')}`,
  ].join('\n');

  const queenResult = await queenOrchestrator.orchestrate({
    prompt: `[Swarm topology ${topology.id} — ${topology.name}]\n${algorithmPlan.promptPrefix}\n${topology.description}\n\n${topologyContext}\n\nQuery:\n${request.query}`,
    type: 'analysis',
    jurisdiction: request.jurisdiction,
    userId: request.userId,
    priority: topology.romaLevel >= 4 ? 'critical' : topology.romaLevel >= 3 ? 'high' : 'medium',
    taskType: `swarm:${topology.category}:${topology.id}`,
    orchestrationMode,
  });

  const individualResults: TopologyAgentResult[] = refineAgentResults(
    topology.category,
    (queenResult.executions || []).map(exec => ({
      agentId: exec.agentId || 'unknown',
      result: String(exec.output || '').slice(0, 2000),
      score: exec.status === 'completed' ? 0.85 : 0.5,
      latencyMs: exec.endTime && exec.startTime ? exec.endTime - exec.startTime : 0,
    })),
  );

  const aggregated = aggregateTopologyResults(
    topology.category,
    individualResults,
    queenResult.synthesizedOutput || '',
  );

  return {
    topologyId: topology.id,
    topologyName: topology.name,
    agentsUsed,
    individualResults,
    aggregatedResult: aggregated.aggregatedResult,
    consensusScore: aggregated.consensusScore,
    executionMs: Date.now() - started,
    romaLevel: topology.romaLevel,
    catalogOnly: false,
    orchestrationPattern: queenResult.taskDecomposition?.orchestrationPattern,
    queenStatus: queenResult.success ? 'completed' : 'failed',
    topologyAlgorithm: aggregated.algorithm,
    algorithmMetadata: aggregated.metadata,
  };
}

export const nvSwarmTopologyService = {
  getAll: () => SWARM_TOPOLOGIES.map(t => ({ ...t, catalogOnly: true as const })),
  getById: (id: string) => {
    const topology = SWARM_TOPOLOGIES.find(t => t.id === id) ?? null;
    return topology ? { ...topology, catalogOnly: true as const } : null;
  },
  getByCategory: (cat: TopologyCategory) =>
    SWARM_TOPOLOGIES.filter(t => t.category === cat).map(t => ({ ...t, catalogOnly: true as const })),
  getByJurisdiction: (j: string) =>
    SWARM_TOPOLOGIES.filter(t => t.jurisdictions.includes(j)).map(t => ({ ...t, catalogOnly: true as const })),
  getByRomaLevel: (level: number) =>
    SWARM_TOPOLOGIES.filter(t => t.romaLevel === level).map(t => ({ ...t, catalogOnly: true as const })),
  getGRPOCompatible: () =>
    SWARM_TOPOLOGIES.filter(t => t.grpoCompatible).map(t => ({ ...t, catalogOnly: true as const })),
  search: (query: string) => SWARM_TOPOLOGIES.filter(t =>
    t.name.toLowerCase().includes(query.toLowerCase()) ||
    t.description.toLowerCase().includes(query.toLowerCase()) ||
    t.useCases.some(u => u.toLowerCase().includes(query.toLowerCase()))
  ).map(t => ({ ...t, catalogOnly: true as const })),
  executeTopology,
  stats: () => ({
    total: SWARM_TOPOLOGIES.length,
    catalogOnly: true,
    executionSupported: true,
    executionEngine: 'queen-orchestrator',
    registryAgents: getRegistryStats().totalAgents,
    registryVersion: getRegistryStats().registryVersion,
    byCategory: Object.fromEntries(
      (['linear','fan_out','hierarchical','round_robin','competitive','consensus','iterative','specialized','hybrid','quantum_ready','roma_l5'] as TopologyCategory[])
        .map(c => [c, SWARM_TOPOLOGIES.filter(t => t.category === c).length])
    ),
    grpoCompatible: SWARM_TOPOLOGIES.filter(t => t.grpoCompatible).length,
    avgAgentCount: Math.round(SWARM_TOPOLOGIES.reduce((s, t) => s + t.agentCount, 0) / SWARM_TOPOLOGIES.length),
  }),
};

export default nvSwarmTopologyService;
