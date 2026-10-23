import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

import { nv } from '@/lib/jrx-api-paths';
// ──────────────────────────────────────────────────────────────────────────────
// 22 ROMA L5 AGENT PATTERNS
// ──────────────────────────────────────────────────────────────────────────────
export const AGENT_PATTERNS = [
  {
    id: 'react', name: 'ReAct', category: 'Reasoning',
    icon: '🔄', color: '#3b82f6',
    description: 'Reason-Act-Observe loop. Agent reasons about what to do, acts via tools, observes results, and iterates.',
    useCase: 'Legal research with tool calls (statute lookup, case search, citation retrieval)',
    strengths: ['Multi-step reasoning', 'Tool integration', 'Adaptive iteration'],
    systemPromptTemplate: `You are a legal AI agent operating in ReAct mode for {{jurisdiction}} jurisdiction.

## Reasoning Protocol
For every user request:
1. **THOUGHT**: Analyse the legal question. Identify what information is needed.
2. **ACTION**: Invoke the appropriate tool (statute_lookup, case_search, precedent_finder, etc.)
3. **OBSERVATION**: Review tool output critically.
4. **REPEAT**: Continue until sufficient information gathered.
5. **ANSWER**: Synthesise final legally sound response with citations.

## Constraints
- Always cite section numbers and case names.
- Flag jurisdictional limitations explicitly.
- Language: {{language}} | Jurisdiction: {{jurisdiction}} | Platform: {{platform}}`
  },
  {
    id: 'cot', name: 'Chain-of-Thought', category: 'Reasoning',
    icon: '🧠', color: '#8b5cf6',
    description: 'Step-by-step explicit reasoning before answering. Agent shows full reasoning chain.',
    useCase: 'Complex legal analysis requiring structured argument construction',
    strengths: ['Transparent reasoning', 'Explainability', 'Error reduction'],
    systemPromptTemplate: `You are a legal reasoning agent using Chain-of-Thought methodology for {{platform}}.

## CoT Protocol
Before providing any legal answer, explicitly reason through:

**Step 1 — Identify the legal issue**: What area of law applies? Which statute governs?
**Step 2 — Gather facts**: What facts are legally relevant? What is missing?
**Step 3 — Apply law to facts**: Methodically apply each legal element.
**Step 4 — Consider counter-arguments**: What arguments oppose this position?
**Step 5 — Reach conclusion**: Synthesise with confidence level (High/Medium/Low).
**Step 6 — Cite authority**: Every conclusion needs statutory or case authority.

Jurisdiction: {{jurisdiction}} | Language: {{language}}`
  },
  {
    id: 'tot', name: 'Tree of Thoughts', category: 'Reasoning',
    icon: '🌳', color: '#10b981',
    description: 'Explores multiple reasoning branches simultaneously, evaluates each, and selects the best path.',
    useCase: 'Multi-party disputes, complex contract analysis with multiple interpretations',
    strengths: ['Explores alternatives', 'Best-path selection', 'Complex problems'],
    systemPromptTemplate: `You are a legal AI agent using Tree of Thoughts reasoning for {{jurisdiction}}.

## ToT Protocol
For complex legal questions, generate and evaluate MULTIPLE reasoning paths:

**Branch A** — Most conservative legal interpretation
**Branch B** — Most plaintiff-favourable interpretation  
**Branch C** — Most defendant-favourable interpretation
**Branch D** — Novel or emerging legal theory

### Evaluation Criteria (score each 1–10):
- Legal precedent support
- Statutory text alignment  
- Practical enforceability
- Risk level

**Selected Path**: Choose highest-scoring branch and explain selection.

Platform: {{platform}} | Jurisdiction: {{jurisdiction}}`
  },
  {
    id: 'self-reflect', name: 'Self-Reflection', category: 'Quality',
    icon: '🪞', color: '#f59e0b',
    description: 'Agent generates initial answer, then critically reviews it for errors, gaps, and improves it.',
    useCase: 'High-stakes legal opinions, compliance certificates, court submissions',
    strengths: ['Error self-correction', 'Quality assurance', 'Hallucination reduction'],
    systemPromptTemplate: `You are a self-reflecting legal AI agent for {{platform}} ({{jurisdiction}}).

## Reflection Protocol
**Draft Phase**: Generate initial legal analysis.
**Reflection Phase**: Critically review your draft:
- Are all citations accurate and verifiable?
- Did you miss any relevant statutes or precedents?
- Is the reasoning logically sound?
- Are there jurisdictional limitations you should flag?
- Is the language appropriate for {{language}} speakers?
**Revision Phase**: Produce improved final output.

Always mark your final answer with [FINAL REVIEWED RESPONSE].
Confidence Level must be included: [HIGH/MEDIUM/LOW] with justification.`
  },
  {
    id: 'critic-actor', name: 'Critic-Actor', category: 'Quality',
    icon: '⚖️', color: '#ef4444',
    description: 'Two roles: Actor produces content; Critic evaluates and requests improvements until quality threshold met.',
    useCase: 'Contract drafting, legal brief generation, regulatory submission preparation',
    strengths: ['Highest quality output', 'Iterative refinement', 'Structured QA'],
    systemPromptTemplate: `You are operating in Critic-Actor mode for {{platform}} legal tasks.

## ACTOR ROLE
Generate the requested legal document/analysis for {{jurisdiction}}.
Include all required elements, citations, and clauses.

## CRITIC ROLE (after Actor output)
Evaluate against:
1. Legal accuracy — correct statute citations?
2. Completeness — all required elements present?
3. Clarity — understandable in {{language}}?
4. Risk — any dangerous omissions or ambiguities?
5. Compliance — meets {{jurisdiction}} regulatory requirements?

**Score**: If CRITIC score < 85/100, ACTOR must revise.
**Max iterations**: 3
**Final**: Include CRITIC approval note with final score.`
  },
  {
    id: 'planner-executor', name: 'Planner-Executor', category: 'Orchestration',
    icon: '📋', color: '#6366f1',
    description: 'Agent creates a detailed step-by-step plan first, then executes each step sequentially.',
    useCase: 'Multi-step legal workflows: due diligence, M&A review, litigation strategy',
    strengths: ['Complex task management', 'Structured execution', 'Progress tracking'],
    systemPromptTemplate: `You are a Planner-Executor legal agent for {{platform}} ({{jurisdiction}}).

## PLANNING PHASE
Before executing, create a detailed execution plan:
1. Break the task into discrete legal sub-tasks
2. Identify dependencies between tasks
3. Estimate complexity: [Simple/Medium/Complex/Expert]
4. List required tools and information sources
5. Flag any HITL checkpoints needed

## EXECUTION PHASE
Execute each planned step:
- Report progress: "Step N of M: [description]"
- Cite sources for each step
- Flag blockers immediately
- Summarise completion

Language: {{language}} | Platform: {{platform}}`
  },
  {
    id: 'grpo', name: 'GRPO', category: 'Learning',
    icon: '📈', color: '#ec4899',
    description: 'Group Relative Policy Optimisation — agent learns from grouped comparisons to improve response quality over time.',
    useCase: 'Adaptive legal answering, jurisdiction-specific response calibration',
    strengths: ['Self-improvement', 'Quality calibration', 'Group learning'],
    systemPromptTemplate: `You are a GRPO-optimised legal AI agent for {{platform}}.

## GRPO Behaviour
You have been trained on grouped comparisons of legal responses. Your responses are scored against:
- Citation accuracy (weight: 30%)
- Legal reasoning quality (weight: 25%)
- Jurisdiction specificity (weight: 20%)
- Language clarity for {{language}} (weight: 15%)
- Risk flag completeness (weight: 10%)

Generate your response to maximise this composite score.
Always include: confidence score, citation list, jurisdiction scope, risk flags.

Jurisdiction: {{jurisdiction}} | GRPO Score Target: ≥92/100`
  },
  {
    id: 'a2a', name: 'A2A Collaborative', category: 'Multi-Agent',
    icon: '🤝', color: '#14b8a6',
    description: 'Agent-to-Agent protocol enabling structured handoffs and collaborative workflows between specialised agents.',
    useCase: 'Complex matters requiring multiple specialists: tax + IP + labour law analysis',
    strengths: ['Specialist coordination', 'Parallel processing', 'Comprehensive coverage'],
    systemPromptTemplate: `You are an A2A-enabled legal agent in the Jurexio swarm for {{platform}}.

## A2A Protocol
**Your Role**: {{agentRole}} specialist for {{jurisdiction}}
**Accepts from**: [list of upstream agents]
**Sends to**: [list of downstream agents]

## Handoff Format
When receiving from another agent, confirm:
- Agent ID that sent task
- Task context received
- Your specialisation being applied

When sending to another agent, include:
- Your agent ID: {{agentId}}
- Confidence score: [0-100]
- Completeness: [PARTIAL/COMPLETE]
- Recommended next agent
- Context package (JSON)

Language: {{language}} | Topology: {{topology}}`
  },
  {
    id: 'rag', name: 'RAG Specialist', category: 'Knowledge',
    icon: '📚', color: '#f97316',
    description: 'Retrieval-Augmented Generation — grounds all responses in retrieved legal documents and precedents.',
    useCase: 'Statute interpretation, precedent research, regulatory compliance queries',
    strengths: ['Factual grounding', 'Hallucination prevention', 'Citation accuracy'],
    systemPromptTemplate: `You are a RAG-specialised legal knowledge agent for {{jurisdiction}} on {{platform}}.

## RAG Protocol
For every query:
1. **RETRIEVE**: Search legal corpus (statutes, cases, regulations) for relevant passages
2. **RANK**: Score retrieved passages by relevance, recency, authority level
3. **AUGMENT**: Use top-K passages as primary source (K=5 by default)
4. **GENERATE**: Synthesise response ONLY from retrieved context
5. **CITE**: Every claim must have [Source: Document, Section, Date]

## Retrieval Scope
- Primary corpus: {{jurisdiction}} statutes and regulations
- Secondary corpus: Judicial decisions and tribunal orders
- Tertiary: Academic commentary and bar council guidance

If no relevant document found: "No authoritative source found for this query. Please consult a licensed legal professional."`
  },
  {
    id: 'tool-augmented', name: 'Tool-Augmented', category: 'Tools',
    icon: '🔧', color: '#84cc16',
    description: 'Heavy emphasis on function calling and tool use. Agent orchestrates multiple MCP tools to complete tasks.',
    useCase: 'E-filing, document generation, court database queries, compliance checks',
    strengths: ['Real-world integration', 'Automation', 'Data accuracy'],
    systemPromptTemplate: `You are a Tool-Augmented legal agent with access to the full Jurexio MCP tool suite for {{platform}}.

## Available Tools (invoke as needed)
- statute_lookup(query, jurisdiction) → statutory text
- case_search(query, court, date_range) → case list  
- efiling_submit(document, court, case_type) → filing receipt
- document_generate(template, data) → PDF/DOCX
- compliance_check(domain, framework, jurisdiction) → report
- translation(text, source_lang, target_lang) → translated text
- court_schedule(court, date) → hearing list
- lawyer_search(specialization, location) → lawyer list

## Tool Usage Protocol
1. Identify which tools are needed for the request
2. Call tools with precise parameters
3. Validate tool outputs before using in response
4. If tool fails, fallback gracefully and inform user

Jurisdiction: {{jurisdiction}} | Language: {{language}}`
  },
  {
    id: 'bmad', name: 'BMAD Decomposition', category: 'Orchestration',
    icon: '💡', color: '#a78bfa',
    description: 'Breakthrough Method Agentic Decomposition — breaks complex problems into atomic sub-problems solved by specialist micro-agents.',
    useCase: 'Large-scale due diligence, M&A legal audit, multi-jurisdiction compliance',
    strengths: ['Maximum decomposition', 'Parallel specialists', 'Comprehensive output'],
    systemPromptTemplate: `You are operating in BMAD mode on {{platform}} for {{jurisdiction}} legal tasks.

## BMAD Protocol
**Phase 1 — BREAKTHROUGH**: Identify the core legal question beneath the surface request
**Phase 2 — METHOD**: Choose optimal approach (precedent / statute / principle-based)
**Phase 3 — AGENT DESIGN**: Determine which specialist micro-agents are needed
**Phase 4 — DECOMPOSE**: Break into atomic tasks, each solvable independently

### Atomic Task Format:
- Task ID: BMAD-{{agentId}}-001
- Specialist Required: [Legal Researcher / Drafter / Compliance Checker / Translator]
- Input: [specific input needed]
- Output: [specific output format]
- Dependencies: [prior task IDs]

**Phase 5 — SYNTHESISE**: Combine all micro-agent outputs into coherent deliverable`
  },
  {
    id: 'debate', name: 'Debate/Adversarial', category: 'Quality',
    icon: '🗣️', color: '#f43f5e',
    description: 'Multiple agent personas argue opposing positions; final response emerges from structured debate with consensus.',
    useCase: 'Risk assessment, contract negotiation positions, litigation strategy',
    strengths: ['Balanced analysis', 'Risk exposure', 'Devil\'s advocate'],
    systemPromptTemplate: `You are running a legal debate protocol for {{platform}} ({{jurisdiction}}).

## DEBATE STRUCTURE

**Advocate A — Plaintiff/Favourable Position**:
Present the strongest possible case FOR the client's position. Use all available precedents.

**Advocate B — Defence/Counter Position**:
Present the strongest possible COUNTER-ARGUMENTS. Identify all weaknesses.

**Expert C — Neutral Legal Expert**:
Evaluate both positions objectively. Apply {{jurisdiction}} law strictly.

**CONSENSUS**:
Synthesise a balanced legal risk assessment:
- Probability of success: [%]
- Key risk factors: [list]
- Recommended approach: [strategy]
- Confidence level: [High/Medium/Low]`
  },
  {
    id: 'constitutional', name: 'Constitutional AI', category: 'Safety',
    icon: '🛡️', color: '#0ea5e9',
    description: 'Self-corrects against a set of constitutional principles for ethics, accuracy, and safety before responding.',
    useCase: 'All customer-facing agents, jurisdiction-sensitive responses, public legal advice',
    strengths: ['Safety guardrails', 'Ethical compliance', 'Principled responses'],
    systemPromptTemplate: `You are a Constitutional AI legal agent for {{platform}}.

## Core Constitution (apply to EVERY response)
1. **Accuracy**: Never state legal facts without authority. If unsure, say so.
2. **Non-harm**: Never advise on clearly illegal activities.
3. **Jurisdiction Clarity**: Always specify which jurisdiction applies.
4. **Disclaimer**: For citizen-facing advice, always recommend consulting a qualified lawyer.
5. **Language Respect**: Respond in {{language}} with appropriate cultural sensitivity.
6. **Confidentiality**: Never repeat user's personal information back unnecessarily.
7. **Scope Limitation**: Stay within legal domain. Redirect medical/financial queries.
8. **Bias Check**: Ensure responses are free from gender, religion, or caste bias.

## Self-Review
After generating response, check against each principle. Revise if any principle is violated.
Mark violations found with [REVISED: reason].`
  },
  {
    id: 'hitl', name: 'HITL-Gated', category: 'Safety',
    icon: '🙋', color: '#d97706',
    description: 'Human-in-the-Loop checkpoints at critical decision stages. Agent pauses and requests human approval before proceeding.',
    useCase: 'High-stakes filings, irreversible actions, sensitive client matters',
    strengths: ['Human oversight', 'Error prevention', 'Compliance'],
    systemPromptTemplate: `You are a HITL-Gated legal agent for {{platform}} ({{jurisdiction}}).

## HITL Checkpoints
Before performing HIGH-RISK actions, pause and request human approval:

**CHECKPOINT A — Document Filing**: Before submitting any document to court/authority
**CHECKPOINT B — Legal Advice**: Before giving specific legal advice to vulnerable persons
**CHECKPOINT C — Contract Execution**: Before finalising any binding agreement
**CHECKPOINT D — Data Access**: Before accessing sensitive personal legal records

## Checkpoint Format
When a checkpoint is triggered:
[HITL-CHECKPOINT]
Action: [what agent intends to do]
Risk Level: [HIGH/CRITICAL]
Reason: [why human review needed]
Proceed? [YES/NO/MODIFY]
[/HITL-CHECKPOINT]

Resume execution only after human approval recorded.`
  },
  {
    id: 'memory-cam', name: 'Memory-Augmented (CAM)', category: 'Knowledge',
    icon: '🧩', color: '#7c3aed',
    description: 'Context-Aware Memory — maintains episodic, semantic, and procedural memory across sessions for personalised legal assistance.',
    useCase: 'Long-running client matters, repeat users, ongoing litigation support',
    strengths: ['Session continuity', 'Client context retention', 'Personalisation'],
    systemPromptTemplate: `You are a Memory-Augmented (CAM) legal agent for {{platform}} serving {{jurisdiction}}.

## CAM Memory Layers
**Episodic Memory**: Recall previous interactions with this client
- Last consultation: [date]
- Prior matters discussed: [list]
- Unresolved questions: [list]

**Semantic Memory**: Client's legal situation profile
- Matter type: [type]
- Jurisdiction: {{jurisdiction}}
- Key parties: [names]
- Critical dates: [deadlines]

**Procedural Memory**: Steps already completed
- Documents filed: [list]
- Actions taken: [list]
- Pending actions: [list]

Always reference relevant memory at start of response.
Update memory summary at end of each interaction.
Language: {{language}}`
  },
  {
    id: 'legal-researcher', name: 'Legal Research Expert', category: 'Specialist',
    icon: '🔍', color: '#059669',
    description: 'Specialist in deep legal research with multi-source citation, precedent analysis, and scholarly commentary.',
    useCase: 'Precedent research, statute interpretation, academic legal analysis',
    strengths: ['Comprehensive research', 'Multi-source citation', 'Scholarly depth'],
    systemPromptTemplate: `You are the Jurexio Legal Research Expert for {{jurisdiction}} on {{platform}}.

## Research Mandate
Conduct exhaustive legal research following the Jurexio Research Protocol:

### Source Hierarchy (in order of authority)
1. Constitutional provisions ({{jurisdiction}})
2. Legislation and statutes (current consolidated version)
3. Supreme/High Court judgements (most recent binding)
4. Tribunal decisions (authoritative)
5. Regulatory guidance and circulars
6. Academic commentary (peer-reviewed)

### Research Output Format
**Issue Identification**: [precise legal question]
**Applicable Law**: [statute + section with full text quote]
**Binding Precedents**: [case name, citation, year, holding]
**Contradictory Precedents**: [if any, with analysis]
**Scholarly Commentary**: [key academic positions]
**Research Confidence**: [High/Medium/Low]
**Gaps Identified**: [areas needing further research]

Language: {{language}} | Depth: Comprehensive`
  },
  {
    id: 'compliance-monitor', name: 'Compliance Monitor', category: 'Specialist',
    icon: '📊', color: '#dc2626',
    description: 'Continuously monitors regulatory changes and evaluates client situations against multiple compliance frameworks.',
    useCase: 'Corporate compliance programs, regulatory surveillance, audit preparation',
    strengths: ['Multi-framework compliance', 'Regulatory change tracking', 'Risk scoring'],
    systemPromptTemplate: `You are the Jurexio Compliance Monitor for {{platform}} ({{jurisdiction}}).

## Compliance Frameworks Active
- ISO 42001 (AI Management)
- ISO 27001 (Information Security)
- SOC 2 Type II
- GDPR / DPDP 2023 (data privacy)
- {{jurisdiction}}-specific regulations

## Monitoring Protocol
For every compliance check:
1. **Framework Mapping**: Which frameworks apply to this situation?
2. **Gap Analysis**: What is required vs what exists?
3. **Risk Scoring**: Rate each gap: [CRITICAL/HIGH/MEDIUM/LOW]
4. **Remediation**: Specific steps to achieve compliance
5. **Timeline**: Regulatory deadline if applicable

## Alert Format
[COMPLIANCE ALERT — {{jurisdiction}}]
Framework: [name]
Gap: [description]
Risk: [CRITICAL/HIGH/MEDIUM/LOW]
Remediation: [steps]
Deadline: [date or "Ongoing"]`
  },
  {
    id: 'validator', name: 'Validator/Fact-Checker', category: 'Quality',
    icon: '✅', color: '#16a34a',
    description: 'Verifies claims, citations, and legal facts produced by other agents. Acts as quality gate before output delivery.',
    useCase: 'Post-processing pipeline stage, citation verification, legal opinion QA',
    strengths: ['Accuracy verification', 'Hallucination detection', 'Citation validation'],
    systemPromptTemplate: `You are the Jurexio Validator/Fact-Checker for {{platform}}.

## Validation Protocol
You receive output from other legal AI agents. Your role is VERIFICATION ONLY.

### Validation Checklist
- [ ] All cited cases exist and are correctly named
- [ ] Section numbers match the cited statutes  
- [ ] Dates and years are accurate
- [ ] Jurisdiction scope is correctly stated
- [ ] No contradictory claims within the document
- [ ] Mathematical calculations (if any) are correct
- [ ] Regulatory references are current (not superseded)
- [ ] Language is appropriate for {{language}} audience

### Output Format
**VALIDATION REPORT**
Pass/Fail: [PASS / FAIL / CONDITIONAL PASS]
Issues Found: [count]
Critical Issues: [list with correction]
Minor Issues: [list]
Confidence in Original Output: [0–100%]
Recommendation: [APPROVE / REVISE / REJECT]`
  },
  {
    id: 'orchestrator', name: 'Orchestrator/Queen', category: 'Multi-Agent',
    icon: '👑', color: '#b45309',
    description: 'Queen agent in swarm topology. Coordinates worker agents, manages task distribution, and aggregates results.',
    useCase: 'Complex multi-agent workflows, swarm coordination, enterprise legal operations',
    strengths: ['Swarm management', 'Task allocation', 'Result synthesis'],
    systemPromptTemplate: `You are the Jurexio Orchestrator (Queen Agent) for {{platform}} swarm.

## Orchestration Mandate
You coordinate {{agentCount}} worker agents across {{jurisdiction}} legal domains.

## Worker Agent Fleet
{{agentRoster}}

## Orchestration Protocol
1. **Analyse Request**: Decompose into specialist sub-tasks
2. **Allocate**: Assign each sub-task to optimal worker agent
3. **Monitor**: Track completion status of each worker
4. **Aggregate**: Combine worker outputs into unified deliverable
5. **QA**: Pass final output through Validator agent
6. **Deliver**: Return synthesised response to user

## Status Tracking
Maintain real-time status of each worker:
[WORKER-STATUS: agentId | task | status | ETA | blockers]

Topology: {{topology}} | Priority: {{priority}}`
  },
  {
    id: 'sequential', name: 'Sequential Pipeline', category: 'Orchestration',
    icon: '➡️', color: '#0369a1',
    description: 'Linear agent handoff chain. Each agent processes output of previous agent and passes enriched result to next.',
    useCase: 'Document processing pipelines, progressive legal analysis, step-gated workflows',
    strengths: ['Clear flow', 'Progressive enrichment', 'Debuggability'],
    systemPromptTemplate: `You are operating in Sequential Pipeline mode for {{platform}} ({{jurisdiction}}).

## Pipeline Position: Stage {{stageNumber}} of {{totalStages}}
**Stage Name**: {{stageName}}
**Receives From**: Stage {{prevStage}} — {{prevAgentName}}
**Sends To**: Stage {{nextStage}} — {{nextAgentName}}

## Stage Protocol
1. Accept input from previous stage (validate format)
2. Apply your specialised processing: {{stageFunction}}
3. Enrich with stage-specific information
4. Package output in standardised format for next stage
5. Include processing metadata

## Pipeline Package Format (JSON)
{
  "pipeline_id": "{{pipelineId}}",
  "stage": {{stageNumber}},
  "agent": "{{agentId}}",
  "input_received": true,
  "processing_complete": true,
  "output": { ... },
  "confidence": 0.0,
  "flags": []
}`
  },
  {
    id: 'parallel', name: 'Parallel Ensemble', category: 'Multi-Agent',
    icon: '⚡', color: '#0891b2',
    description: 'Multiple agents process the same query simultaneously with different approaches; outputs merged via voting or synthesis.',
    useCase: 'High-accuracy legal opinions, multi-jurisdictional analysis, risk assessment',
    strengths: ['Maximum coverage', 'Consensus accuracy', 'Redundancy'],
    systemPromptTemplate: `You are one of {{ensembleSize}} parallel agents in a Jurexio Ensemble for {{platform}}.

## Your Ensemble Role: {{ensembleRole}}
Approach: {{approachType}} (distinct from other ensemble members)

## Parallel Processing Protocol
1. Process the query independently — do NOT wait for or reference other agents
2. Apply YOUR specific approach: {{approachType}}
3. Generate complete analysis
4. Rate your own confidence: [0–100%]
5. Flag where other approaches may differ from yours

## Ensemble Output Format
{
  "agent_id": "{{agentId}}",
  "approach": "{{approachType}}",
  "analysis": "...",
  "key_findings": [],
  "confidence": 0,
  "agrees_with_consensus": null,
  "unique_insights": []
}

Merger agent will synthesise all {{ensembleSize}} outputs via weighted voting.`
  },
  {
    id: 'adaptive-hybrid', name: 'Adaptive Hybrid', category: 'Advanced',
    icon: '🎯', color: '#7c3aed',
    description: 'Dynamically selects and switches between patterns based on query complexity, context, and real-time performance.',
    useCase: 'General-purpose agents, consumer platforms, unpredictable query types',
    strengths: ['Versatility', 'Optimal per-query performance', 'Self-optimising'],
    systemPromptTemplate: `You are an Adaptive Hybrid legal agent for {{platform}} ({{jurisdiction}}).

## Adaptive Selection Matrix
Based on query type, activate the appropriate pattern:

| Query Type | Pattern | Reason |
|-----------|---------|--------|
| Simple fact lookup | RAG Specialist | Speed + accuracy |
| Complex analysis | CoT or ToT | Thoroughness |
| Multi-step task | Planner-Executor | Structure |
| High-stakes output | Critic-Actor | Quality gate |
| Multi-party dispute | Debate/Adversarial | Balance |
| Long-running matter | Memory-Augmented | Continuity |
| Tool-heavy task | Tool-Augmented | Efficiency |
| Safety-sensitive | Constitutional AI | Guardrails |

## Selection Decision
State which pattern you've selected and why before beginning:
[PATTERN SELECTED: {{patternName}} — Reason: {{reason}}]

Then execute that pattern's protocol fully.
Language: {{language}} | Adaptation Threshold: Auto`
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────────────────────

const JURISDICTIONS = ['IN', 'UK', 'GCC', 'EU', 'US', 'SG'];
const PLATFORMS_LIST = ['Jurexio Citizen', 'NS Professional™', 'NS Institutional™', 'NS Academy™', 'NS Governance™', 'All Platforms'];
const PRACTICE_AREAS = ['Constitutional Law', 'Criminal Law', 'Corporate & Commercial', 'Civil Litigation', 'Family Law', 'IP Law', 'Tax Law', 'Labour & Employment', 'Real Estate & Property', 'International Law', 'Data Privacy & Cybersecurity', 'Regulatory & Compliance'];
const LLM_OPTIONS = [
  // OpenAI — GPT-4.1 Series (Apr 2025, 1M context, real API IDs)
  { id: 'gpt-4.1',      name: 'GPT-4.1',           provider: 'OpenAI',    tier: 'Expert',       ctx: '1M', cost: '$2/$8' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini',      provider: 'OpenAI',    tier: 'Standard',     ctx: '1M', cost: '$0.4/$1.6' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano',      provider: 'OpenAI',    tier: 'Budget',       ctx: '1M', cost: '$0.1/$0.4' },
  // OpenAI — Reasoning Series
  { id: 'o4-mini',      name: 'o4-mini',            provider: 'OpenAI',    tier: 'Professional', ctx: '200K', cost: '$1.1/$4.4' },
  { id: 'o3',           name: 'o3',                 provider: 'OpenAI',    tier: 'Expert',       ctx: '200K', cost: '$10/$40' },
  { id: 'o3-mini',      name: 'o3-mini',            provider: 'OpenAI',    tier: 'Professional', ctx: '200K', cost: '$1.1/$4.4' },
  { id: 'o3-pro',       name: 'o3-pro',             provider: 'OpenAI',    tier: 'Expert',       ctx: '200K', cost: '$20/$80' },
  // Anthropic — Claude 4.6 (Feb 2026, 1M context)
  { id: 'claude-opus-4-6',   name: 'Claude Opus 4.6',   provider: 'Anthropic', tier: 'Expert',       ctx: '1M',   cost: '$5/$25' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'Anthropic', tier: 'Professional', ctx: '1M',   cost: '$3/$15' },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  provider: 'Anthropic', tier: 'Standard',     ctx: '200K', cost: '$0.25/$1.25' },
  // Google — Gemini 3.1 (Feb 2026)
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro',       provider: 'Google',    tier: 'Expert',       ctx: '1M', cost: '$3/$12' },
  { id: 'gemini-2.5-pro',         name: 'Gemini 2.5 Pro',        provider: 'Google',    tier: 'Expert',       ctx: '1M', cost: '$1.25/$5' },
  { id: 'gemini-2.5-flash',       name: 'Gemini 2.5 Flash',      provider: 'Google',    tier: 'Standard',     ctx: '1M', cost: '$0.075/$0.3' },
  { id: 'gemini-2.5-flash-lite',  name: 'Gemini 2.5 Flash Lite', provider: 'Google',    tier: 'Budget',       ctx: '1M', cost: '$0.02/$0.08' },
  // Sarvam — Indian Language Specialist
  { id: 'sarvam-2b', name: 'Sarvam 2B', provider: 'Sarvam', tier: 'Specialist', ctx: '32K', cost: '$0.2/$0.4' },
  { id: 'sarvam-m',  name: 'Sarvam-M',  provider: 'Sarvam', tier: 'Specialist', ctx: '32K', cost: '$0.5/$1.0' },
  // DeepSeek
  { id: 'deepseek-v3',        name: 'DeepSeek V3',        provider: 'DeepSeek', tier: 'Expert',     ctx: '128K', cost: '$0.27/$1.1' },
  { id: 'deepseek-r1',        name: 'DeepSeek R1',        provider: 'DeepSeek', tier: 'Expert',     ctx: '128K', cost: '$0.55/$2.19' },
  { id: 'deepseek-prover-v2', name: 'DeepSeek Prover V2', provider: 'DeepSeek', tier: 'Specialist', ctx: '128K', cost: '$0.5/$2.0' },
  // Meta Llama 4
  { id: 'llama-4-maverick', name: 'Llama 4 Maverick', provider: 'Meta', tier: 'Expert',       ctx: '1M',  cost: '$0.18/$0.59' },
  { id: 'llama-4-scout',    name: 'Llama 4 Scout',    provider: 'Meta', tier: 'Professional', ctx: '10M', cost: '$0.09/$0.29' },
  // Mistral
  { id: 'mistral-large-2512', name: 'Mistral Large 3',  provider: 'Mistral', tier: 'Expert',     ctx: '128K', cost: '$2/$6' },
  { id: 'devstral-medium',    name: 'Devstral Medium',  provider: 'Mistral', tier: 'Specialist', ctx: '128K', cost: '$0.3/$0.9' },
  { id: 'codestral-2508',     name: 'Codestral 2508',   provider: 'Mistral', tier: 'Specialist', ctx: '256K', cost: '$0.3/$0.9' },
  // AgentZero — Always-on fallback
  { id: 'agentzero', name: 'AgentZero (Fallback)', provider: 'AgentZero', tier: 'Fallback', ctx: '∞', cost: '$0' },
];
const LANGUAGES_LIST = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'ur', 'ar', 'fr', 'de', 'es'];
const CATEGORIES = ['All', ...Array.from(new Set(AGENT_PATTERNS.map(p => p.category)))];

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface AgentConfig {
  name: string; description: string; organization: string;
  platform: string; jurisdiction: string; practiceArea: string;
  language: string; version: string; tags: string;
  patternId: string; temperature: number; maxTokens: number;
  enableMemory: boolean; enableTools: boolean; enableHITL: boolean;
  systemPrompt: string;
  primaryLLM: string; fallbackLLM: string; costBudget: string;
  testPrompt: string; testResponse: string; testLoading: boolean;
}

const STEP_LABELS = ['Basic Info', 'Pattern', 'Behaviour', 'System Prompt', 'LLM Allocation', 'Testing', 'Save'];

// ──────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ──────────────────────────────────────────────────────────────────────────────

export default function AgentCreationWizard() {
  const { token, user } = useAuth() as any;
  const [step, setStep] = useState<WizardStep>(0);
  const [catFilter, setCatFilter] = useState('All');
  const [savedAgents, setSavedAgents] = useState<any[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  const [cfg, setCfg] = useState<AgentConfig>({
    name: '', description: '', organization: '', platform: 'NS Professional™',
    jurisdiction: 'IN', practiceArea: 'Constitutional Law', language: 'en',
    version: '1.0.0', tags: '',
    patternId: 'react', temperature: 0.3, maxTokens: 2048,
    enableMemory: true, enableTools: true, enableHITL: false,
    systemPrompt: '',
    primaryLLM: 'claude-opus-4-6', fallbackLLM: 'gpt-4.1', costBudget: 'balanced',
    testPrompt: '', testResponse: '', testLoading: false,
  });

  function upd(k: keyof AgentConfig, v: any) { setCfg(c => ({ ...c, [k]: v })); }

  useEffect(() => {
    const tenantId = String(user?.organizationId || user?.orgId || cfg.organization || 'default');
    if (!token) return;
    void fetch(`${nv('orchestrate/custom-agents')}?tenantId=${encodeURIComponent(tenantId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      const rows = j?.data ?? j ?? [];
      if (Array.isArray(rows)) setSavedAgents(rows);
    }).catch(() => undefined);
  }, [token, user, cfg.organization]);

  const selectedPattern = AGENT_PATTERNS.find(p => p.id === cfg.patternId) || AGENT_PATTERNS[0];
  const filteredPatterns = catFilter === 'All' ? AGENT_PATTERNS : AGENT_PATTERNS.filter(p => p.category === catFilter);

  function applyTemplate() {
    const tmpl = selectedPattern.systemPromptTemplate
      .replace(/\{\{jurisdiction\}\}/g, cfg.jurisdiction)
      .replace(/\{\{platform\}\}/g, cfg.platform)
      .replace(/\{\{language\}\}/g, cfg.language)
      .replace(/\{\{agentId\}\}/g, `cust-${cfg.name.toLowerCase().replace(/\s+/g, '-')}-001`)
      .replace(/\{\{agentRole\}\}/g, cfg.practiceArea)
      .replace(/\{\{agentCount\}\}/g, '148')
      .replace(/\{\{topology\}\}/g, 'star')
      .replace(/\{\{priority\}\}/g, 'high')
      .replace(/\{\{stageNumber\}\}/g, '1')
      .replace(/\{\{totalStages\}\}/g, '5')
      .replace(/\{\{stageName\}\}/g, cfg.name)
      .replace(/\{\{prevStage\}\}/g, '0')
      .replace(/\{\{nextStage\}\}/g, '2')
      .replace(/\{\{prevAgentName\}\}/g, 'Input Agent')
      .replace(/\{\{nextAgentName\}\}/g, 'Output Agent')
      .replace(/\{\{stageFunction\}\}/g, cfg.practiceArea)
      .replace(/\{\{pipelineId\}\}/g, 'pipe-001')
      .replace(/\{\{ensembleSize\}\}/g, '3')
      .replace(/\{\{ensembleRole\}\}/g, 'Primary Analyst')
      .replace(/\{\{approachType\}\}/g, 'Statutory Analysis')
      .replace(/\{\{agentRoster\}\}/g, '148 ROMA L5 v2 agents')
      .replace(/\{\{patternName\}\}/g, selectedPattern.name)
      .replace(/\{\{reason\}\}/g, 'Best fit for query complexity');
    upd('systemPrompt', tmpl);
  }

  async function runTest() {
    if (!cfg.testPrompt) return;
    upd('testLoading', true);
    upd('testResponse', '');
    try {
      // Canonical orchestrated LLM endpoint (router → SLM → LLM fallback w/ PII redaction).
      // Earlier `/api/jrx/llm/completions` returned JRX-404 because that path was
      // never mounted; the supported JWT-auth path is `/api/jrx/orchestrate`.
      const res = await fetch(nv('orchestrate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: cfg.testPrompt,
          systemPrompt: cfg.systemPrompt,
          model: cfg.primaryLLM,
          maxTokens: Math.min(cfg.maxTokens, 512),
          temperature: cfg.temperature,
        })
      });
      const data = await res.json();
      // Orchestrate envelope: { success, data: { content, tokens, model, latencyMs, ... } }
      upd('testResponse', data?.data?.content || data?.content || data?.error || JSON.stringify(data, null, 2));
    } catch (e: any) {
      upd('testResponse', `Error: ${e.message}`);
    }
    upd('testLoading', false);
  }

  async function saveAgent() {
    const tenantId = String(user?.organizationId || user?.orgId || cfg.organization || 'default');
    try {
      const res = await fetch(nv('orchestrate/custom-agents'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({
          tenantId,
          createdBy: user?.email || 'unknown',
          agentName: cfg.name,
          description: cfg.description,
          systemPrompt: cfg.systemPrompt,
          temperature: cfg.temperature,
          maxTokens: cfg.maxTokens,
          modelPreference: cfg.primaryLLM,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error?.message || json?.error || `save failed ${res.status}`);
      }
      const listRes = await fetch(`${nv('orchestrate/custom-agents')}?tenantId=${encodeURIComponent(tenantId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      const listJson = await listRes.json().catch(() => ({}));
      const rows = listJson?.data ?? listJson ?? [];
      setSavedAgents(Array.isArray(rows) ? rows : []);
      alert(`Agent "${cfg.name}" saved to /api/jrx/orchestrate/custom-agents`);
    } catch (e: any) {
      alert(`Save failed: ${e?.message || e}`);
    }
  }

  const sty = {
    page: { minHeight: '100vh', background: '#F9FAFB', color: '#0f172a', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
    topBar: { background: '#FFFFFF', borderBottom: '1px solid #e2e8f0', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 },
    main: { maxWidth: 1100, margin: '0 auto', padding: '24px 20px' },
    stepBar: { display: 'flex', gap: 0, marginBottom: 32, background: '#FFFFFF', borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' },
    stepItem: (active: boolean, done: boolean) => ({
      flex: 1, padding: '12px 8px', textAlign: 'center' as const, fontSize: 11, fontWeight: 600,
      background: active ? '#2B384C' : done ? '#dcfce7' : '#FFFFFF',
      color: active ? '#fff' : done ? '#166534' : '#64748b',
      cursor: 'pointer', transition: 'all 0.2s', borderRight: '1px solid #e2e8f0',
    }),
    card: { background: '#FFFFFF', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24, marginBottom: 20 },
    label: { display: 'block', fontSize: 12, color: '#475569', marginBottom: 6, fontWeight: 600 },
    input: { background: '#FFFFFF', border: '1px solid #cbd5e1', borderRadius: 8, color: '#0f172a', padding: '10px 14px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' as const },
    select: { background: '#FFFFFF', border: '1px solid #cbd5e1', borderRadius: 8, color: '#0f172a', padding: '10px 14px', fontSize: 13, outline: 'none', width: '100%' },
    btn: (c: string, t = '#fff') => ({ background: c, border: 'none', borderRadius: 8, color: t, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }),
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
    patternCard: (selected: boolean, color: string) => ({
      background: selected ? color + '15' : '#FFFFFF',
      border: `2px solid ${selected ? color : '#e2e8f0'}`,
      borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'all 0.15s',
    }),
    navBtns: { display: 'flex', justifyContent: 'space-between', marginTop: 24 },
  };

  return (
    <div style={sty.page}>
      {/* TOP BAR */}
      <div style={sty.topBar}>
        <span style={{ fontSize: 20 }}>🤖</span>
        <span style={{ color: '#f59e0b', fontWeight: 800, fontSize: 16 }}>Agent Creation Wizard</span>
        <span style={{ color: '#6b7280', fontSize: 12, flex: 1 }}>22 ROMA L5 Patterns · Customer Agent Builder · Jurexio Enterprise Platform</span>
        <button onClick={() => setShowSaved(!showSaved)} style={{ ...sty.btn('#1f2937'), fontSize: 11 }}>
          Saved Agents ({savedAgents.length})
        </button>
      </div>

      <div style={sty.main}>
        {/* SAVED AGENTS PANEL */}
        {showSaved && (
          <div style={{ ...sty.card, borderColor: '#f59e0b33' }}>
            <div style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 12 }}>Customer Agents</div>
            {savedAgents.length === 0
              ? <div style={{ color: '#6b7280', fontSize: 13 }}>No custom agents saved yet. Create your first agent below.</div>
              : savedAgents.map((a: any) => (
                <div key={a.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #1f2937', alignItems: 'center' }}>
                  <span style={{ fontSize: 18 }}>{AGENT_PATTERNS.find(p => p.id === a.patternId)?.icon || '🤖'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{a.agent_name || a.name}</div>
                    <div style={{ color: '#6b7280', fontSize: 11 }}>{a.agent_key || a.patternName || 'custom'} · {a.model_preference || a.jurisdiction || ''}</div>
                  </div>
                  <span style={{ fontSize: 10, background: '#065f4622', color: '#6ee7b7', border: '1px solid #065f46', borderRadius: 4, padding: '2px 8px' }}>ACTIVE</span>
                </div>
              ))
            }
          </div>
        )}

        {/* STEP BAR */}
        <div style={sty.stepBar}>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={sty.stepItem(step === i, step > i)} onClick={() => step > i && setStep(i as WizardStep)}>
              {step > i ? '✓ ' : ''}{i + 1}. {label}
            </div>
          ))}
        </div>

        {/* ── STEP 0: BASIC INFO ── */}
        {step === 0 && (
          <div style={sty.card}>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 20 }}>1. Basic Agent Information</div>
            <div style={sty.grid2}>
              <div>
                <label style={sty.label}>Agent Name *</label>
                <input style={sty.input} placeholder="e.g. Acme Legal Researcher IN" value={cfg.name} onInput={(e: any) => upd('name', e.target.value)} />
              </div>
              <div>
                <label style={sty.label}>Organization / Client *</label>
                <input style={sty.input} placeholder="e.g. Acme Law Associates LLP" value={cfg.organization} onInput={(e: any) => upd('organization', e.target.value)} />
              </div>
              <div>
                <label style={sty.label}>Platform</label>
                <select style={sty.select} value={cfg.platform} onChange={(e: any) => upd('platform', e.target.value)}>
                  {PLATFORMS_LIST.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Jurisdiction</label>
                <select style={sty.select} value={cfg.jurisdiction} onChange={(e: any) => upd('jurisdiction', e.target.value)}>
                  {JURISDICTIONS.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Practice Area</label>
                <select style={sty.select} value={cfg.practiceArea} onChange={(e: any) => upd('practiceArea', e.target.value)}>
                  {PRACTICE_AREAS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Primary Language</label>
                <select style={sty.select} value={cfg.language} onChange={(e: any) => upd('language', e.target.value)}>
                  {LANGUAGES_LIST.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Version</label>
                <input style={sty.input} value={cfg.version} onInput={(e: any) => upd('version', e.target.value)} placeholder="1.0.0" />
              </div>
              <div>
                <label style={sty.label}>Tags (comma-separated)</label>
                <input style={sty.input} value={cfg.tags} onInput={(e: any) => upd('tags', e.target.value)} placeholder="legal, research, india" />
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <label style={sty.label}>Description</label>
              <textarea style={{ ...sty.input, height: 80, resize: 'vertical' }} value={cfg.description} onInput={(e: any) => upd('description', e.target.value)} placeholder="What does this agent do? What problems does it solve?" />
            </div>
          </div>
        )}

        {/* ── STEP 1: PATTERN SELECTION ── */}
        {step === 1 && (
          <div style={sty.card}>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>2. Select Agent Pattern (22 ROMA L5 Patterns)</div>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 16 }}>Choose the reasoning and behaviour pattern that best fits your agent's purpose.</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setCatFilter(cat)} style={{ ...sty.btn(catFilter === cat ? '#f59e0b' : '#1f2937', catFilter === cat ? '#000' : '#9ca3af'), fontSize: 11, padding: '6px 14px' }}>{cat}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {filteredPatterns.map(pat => (
                <div key={pat.id} style={sty.patternCard(cfg.patternId === pat.id, pat.color)} onClick={() => upd('patternId', pat.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 22 }}>{pat.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: pat.color }}>{pat.name}</div>
                      <div style={{ fontSize: 10, color: '#6b7280', background: '#1f2937', borderRadius: 3, padding: '1px 6px', display: 'inline-block' }}>{pat.category}</div>
                    </div>
                    {cfg.patternId === pat.id && <span style={{ marginLeft: 'auto', color: pat.color, fontSize: 16 }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>{pat.description}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>💼 {pat.useCase}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {pat.strengths.map(s => <span key={s} style={{ fontSize: 10, background: pat.color + '22', color: pat.color, borderRadius: 3, padding: '2px 6px' }}>{s}</span>)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 16, background: selectedPattern.color + '11', border: `1px solid ${selectedPattern.color}44`, borderRadius: 8 }}>
              <div style={{ color: selectedPattern.color, fontWeight: 700 }}>{selectedPattern.icon} Selected: {selectedPattern.name}</div>
              <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>{selectedPattern.description}</div>
            </div>
          </div>
        )}

        {/* ── STEP 2: BEHAVIOUR CONFIG ── */}
        {step === 2 && (
          <div style={sty.card}>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 20 }}>3. Behaviour Configuration</div>
            <div style={sty.grid2}>
              <div>
                <label style={sty.label}>Temperature ({cfg.temperature})</label>
                <input type="range" min={0} max={1} step={0.05} value={cfg.temperature} onInput={(e: any) => upd('temperature', parseFloat(e.target.value))} style={{ width: '100%' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280' }}><span>Precise (0)</span><span>Creative (1)</span></div>
              </div>
              <div>
                <label style={sty.label}>Max Output Tokens</label>
                <select style={sty.select} value={cfg.maxTokens} onChange={(e: any) => upd('maxTokens', parseInt(e.target.value))}>
                  {[512, 1024, 2048, 4096, 8192, 16384].map(t => <option key={t} value={t}>{t.toLocaleString()} tokens</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 20 }}>
              <div style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Capabilities</div>
              {[
                { key: 'enableMemory', label: '🧩 Enable CAM Memory', desc: 'Persist context across sessions' },
                { key: 'enableTools', label: '🔧 Enable MCP Tools', desc: 'Access 53 live MCP tools (statute lookup, e-filing, etc.)' },
                { key: 'enableHITL', label: '🙋 Enable HITL Checkpoints', desc: 'Require human approval for high-stakes actions' },
              ].map(opt => (
                <div key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #1f2937' }}>
                  <input type="checkbox" checked={(cfg as any)[opt.key]} onChange={() => upd(opt.key as any, !(cfg as any)[opt.key])} style={{ width: 16, height: 16 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{opt.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20, padding: 16, background: '#1f2937', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>Pattern: {selectedPattern.name} · Recommended Temperature: {selectedPattern.id === 'validator' ? '0.0' : selectedPattern.id === 'adaptive-hybrid' ? '0.5' : selectedPattern.category === 'Reasoning' ? '0.1–0.3' : '0.3–0.7'}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {selectedPattern.strengths.map(s => <span key={s} style={{ fontSize: 11, background: selectedPattern.color + '22', color: selectedPattern.color, borderRadius: 4, padding: '3px 8px' }}>{s}</span>)}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: SYSTEM PROMPT ── */}
        {step === 3 && (
          <div style={sty.card}>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>4. System Prompt</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button onClick={applyTemplate} style={{ ...sty.btn('#1e3a5f'), fontSize: 12 }}>📄 Load {selectedPattern.name} Template</button>
              <button onClick={() => upd('systemPrompt', '')} style={{ ...sty.btn('#1f2937'), fontSize: 12 }}>🗑️ Clear</button>
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 11, color: '#6b7280' }}>
              <span>Jurisdiction: <b style={{ color: '#f59e0b' }}>{cfg.jurisdiction}</b></span>
              <span>Platform: <b style={{ color: '#f59e0b' }}>{cfg.platform}</b></span>
              <span>Language: <b style={{ color: '#f59e0b' }}>{cfg.language}</b></span>
            </div>
            <textarea
              style={{ ...sty.input, height: 420, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.7 }}
              value={cfg.systemPrompt}
              onInput={(e: any) => upd('systemPrompt', e.target.value)}
              placeholder={`Click "Load ${selectedPattern.name} Template" to auto-fill the system prompt, or write your own...`}
            />
            <div style={{ color: '#6b7280', fontSize: 11, marginTop: 8 }}>
              {cfg.systemPrompt.length} chars · ~{Math.ceil(cfg.systemPrompt.length / 4)} tokens
            </div>
          </div>
        )}

        {/* ── STEP 4: LLM ALLOCATION ── */}
        {step === 4 && (
          <div style={sty.card}>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 20 }}>5. LLM Allocation</div>
            <div style={sty.grid2}>
              <div>
                <label style={sty.label}>Primary LLM</label>
                <select style={sty.select} value={cfg.primaryLLM} onChange={(e: any) => upd('primaryLLM', e.target.value)}>
                  {LLM_OPTIONS.map(m => <option key={m.id} value={m.id}>[{m.provider}] {m.name} — {m.tier}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Fallback LLM</label>
                <select style={sty.select} value={cfg.fallbackLLM} onChange={(e: any) => upd('fallbackLLM', e.target.value)}>
                  {LLM_OPTIONS.map(m => <option key={m.id} value={m.id}>[{m.provider}] {m.name} — {m.tier}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Cost Budget</label>
                <select style={sty.select} value={cfg.costBudget} onChange={(e: any) => upd('costBudget', e.target.value)}>
                  {[['minimal', 'Minimal (fastest + cheapest)'], ['balanced', 'Balanced (quality + cost)'], ['premium', 'Premium (best quality)'], ['unlimited', 'Unlimited']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 24 }}>
              <div style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>LLM Routing Matrix</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#1f2937' }}>
                      {['Provider', 'Model', 'Tier', 'Context', 'Jurisdiction Strength', 'Indian Languages'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#9ca3af', borderBottom: '1px solid #374151' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {LLM_OPTIONS.filter(m => m.id !== 'agentzero').map(m => (
                      <tr key={m.id} style={{ borderBottom: '1px solid #1f2937', background: (cfg.primaryLLM === m.id || cfg.fallbackLLM === m.id) ? m.tier === 'Specialist' ? '#0a291422' : '#1e3a5f22' : 'transparent' }}>
                        <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{m.provider}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 600 }}>{m.name}{cfg.primaryLLM === m.id ? ' ★' : cfg.fallbackLLM === m.id ? ' ↩' : ''}</td>
                        <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 10, background: '#1f2937', borderRadius: 3, padding: '2px 6px', color: '#9ca3af' }}>{m.tier}</span></td>
                        <td style={{ padding: '8px 12px', color: '#6b7280' }}>
                          {m.provider === 'OpenAI' ? '128K' : m.provider === 'Anthropic' ? '200K' : m.provider === 'Google' ? '1M' : m.provider === 'Sarvam' ? '32K' : '64K'}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#6b7280' }}>
                          {m.provider === 'OpenAI' ? '⭐⭐⭐' : m.provider === 'Anthropic' ? '⭐⭐⭐' : m.provider === 'Google' ? '⭐⭐⭐' : m.provider === 'Sarvam' ? '⭐⭐⭐⭐⭐' : '⭐⭐'}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#6b7280' }}>
                          {m.provider === 'Sarvam' ? '✅ Native' : m.provider === 'Google' ? '✅ Good' : '⚠️ Limited'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 16, padding: 12, background: '#0a1628', borderRadius: 8, fontSize: 12, color: '#6b7280' }}>
                <span style={{ color: '#10b981' }}>★ Primary</span> · <span style={{ color: '#3b82f6' }}>↩ Fallback</span> · AgentZero (agentzero-small) is always the final-level fallback when no LLM is available.
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 5: TESTING ── */}
        {step === 5 && (
          <div style={sty.card}>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>6. Live Agent Testing</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
              Test your agent configuration live using the real LLM API before saving.
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={sty.label}>Test Prompt</label>
              <textarea style={{ ...sty.input, height: 100, resize: 'vertical' }}
                value={cfg.testPrompt} onInput={(e: any) => upd('testPrompt', e.target.value)}
                placeholder={`Test your ${selectedPattern.name} agent with a realistic query for ${cfg.jurisdiction} / ${cfg.practiceArea}...`} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button onClick={runTest} disabled={cfg.testLoading || !cfg.testPrompt} style={{ ...sty.btn('#f59e0b', '#000'), opacity: (cfg.testLoading || !cfg.testPrompt) ? 0.6 : 1 }}>
                {cfg.testLoading ? '⏳ Testing...' : '▶ Run Test'}
              </button>
              <div style={{ fontSize: 11, color: '#6b7280', alignSelf: 'center' }}>
                Model: {cfg.primaryLLM} · System prompt: {cfg.systemPrompt.length} chars
              </div>
            </div>
            {cfg.testResponse && (
              <div>
                <div style={{ color: '#10b981', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>✅ Agent Response</div>
                <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, fontSize: 13, lineHeight: 1.7, color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' }}>
                  {cfg.testResponse}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 6: SAVE ── */}
        {step === 6 && (
          <div style={sty.card}>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 20 }}>7. Review & Save</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {[
                ['Agent Name', cfg.name || '(not set)'],
                ['Organization', cfg.organization || '(not set)'],
                ['Platform', cfg.platform],
                ['Jurisdiction', cfg.jurisdiction],
                ['Practice Area', cfg.practiceArea],
                ['Language', cfg.language],
                ['Pattern', selectedPattern.name],
                ['Primary LLM', cfg.primaryLLM],
                ['Fallback LLM', cfg.fallbackLLM],
                ['Temperature', cfg.temperature.toString()],
                ['Max Tokens', cfg.maxTokens.toString()],
                ['Memory Enabled', cfg.enableMemory ? 'Yes' : 'No'],
                ['Tools Enabled', cfg.enableTools ? 'Yes' : 'No'],
                ['HITL Enabled', cfg.enableHITL ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: '#6b7280', fontSize: 12, minWidth: 120 }}>{k}:</span>
                  <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: 16, background: '#0a291422', border: '1px solid #065f46', borderRadius: 8, marginBottom: 20 }}>
              <div style={{ color: '#6ee7b7', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>📍 Storage</div>
              <div style={{ color: '#9ca3af', fontSize: 12 }}>
                This agent will be saved to <b>Customer Agents</b> — separate from the 148 platform agents. It carries your organization, platform, jurisdiction, and language configuration.
              </div>
            </div>
            <button onClick={saveAgent} disabled={!cfg.name || !cfg.organization} style={{ ...sty.btn('#10b981'), padding: '14px 32px', fontSize: 14, opacity: (!cfg.name || !cfg.organization) ? 0.5 : 1 }}>
              💾 Save Agent to Customer Registry
            </button>
            {(!cfg.name || !cfg.organization) && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>⚠️ Agent Name and Organization are required.</div>}
          </div>
        )}

        {/* NAVIGATION */}
        <div style={sty.navBtns}>
          <button onClick={() => setStep(s => Math.max(0, s - 1) as WizardStep)} disabled={step === 0} style={{ ...sty.btn('#1f2937'), opacity: step === 0 ? 0.4 : 1 }}>← Previous</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6b7280', fontSize: 12 }}>
            Step {step + 1} of {STEP_LABELS.length}
          </div>
          {step < 6
            ? <button onClick={() => setStep(s => Math.min(6, s + 1) as WizardStep)} style={sty.btn('#f59e0b', '#000')}>Next →</button>
            : null
          }
        </div>
      </div>
    </div>
  );
}
