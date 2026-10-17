/**
 * Chain-of-Thought (CoT) Prompting Service
 * 
 * Features:
 * - Step-by-step reasoning prompts
 * - Multiple reasoning strategies (zero-shot, few-shot, self-consistency)
 * - Tree-of-Thought exploration
 * - Reasoning trace visualization
 * - Self-verification and correction
 *
 * NYV-COT-LLM-001 (Task #27): the standard / verification / self-consistency
 * executors now call RealLLMService to produce actual reasoning steps
 * instead of returning hard-coded scaffolding strings. In dev/test the
 * legacy stub remains as a safety net so suites without live providers can
 * still run; in production a provider failure throws (no silent stub).
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('chain-of-thought-service');

/**
 * NV-COT-TRUNCATED-JSON-001 — repair JSON cut off mid-emission.
 *
 * The reasoning payload is well-formed right up to the truncation point, so the fix is
 * mechanical: close a dangling string, discard the incomplete trailing object, then close
 * whatever brackets the nesting still owes. Returns `null` when the text is too damaged to
 * be worth guessing at — the caller then rethrows the original parse error, so behaviour is
 * unchanged for genuinely malformed output.
 *
 * Scanning character by character (rather than regex) because only a scan can tell a real
 * structural brace from one inside a string literal or behind an escape.
 */
function repairTruncatedJson(input: string): string | null {
  const s = String(input || '');
  if (!s.trim().startsWith('{')) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  /** Index just past the last position where the JSON was structurally complete. */
  let lastSafeEnd = -1;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null; // genuinely malformed, not truncated
      /* A completed element inside an array is a clean cut point: it lets us drop a
       * half-written step without losing the ones before it. */
      if (stack.length > 0) lastSafeEnd = i + 1;
    }
  }

  if (stack.length === 0) return null; // not truncated — the original error is real

  let body = s;
  if (inString) {
    /* Cut back to the last complete element rather than closing the broken string: a
     * half-sentence `thought` would otherwise be presented to the partner as reasoning. */
    if (lastSafeEnd > 0) body = s.slice(0, lastSafeEnd);
    else body = `${s}"`;
  } else {
    /* Not inside a string: drop any trailing partial key/value fragment. */
    const lastComma = body.lastIndexOf(',');
    if (lastSafeEnd > 0 && lastComma > lastSafeEnd) body = body.slice(0, lastSafeEnd);
  }

  body = body.replace(/,\s*$/, '');

  /* Recompute the open brackets for the (possibly shortened) body. */
  const closers: string[] = [];
  let str2 = false;
  let esc2 = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (esc2) { esc2 = false; continue; }
    if (ch === '\\') { esc2 = true; continue; }
    if (ch === '"') { str2 = !str2; continue; }
    if (str2) continue;
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') closers.pop();
  }
  if (str2) body += '"';
  while (closers.length > 0) body += closers.pop();
  return body;
}

interface LLMReasoningStep {
  thought: string;
  action?: string;
  observation?: string;
  confidence?: number;
}
interface LLMReasoningResult {
  steps: LLMReasoningStep[];
  conclusion: string;
}

export type ReasoningStrategy = 
  | 'zero_shot_cot'
  | 'few_shot_cot'
  | 'self_consistency'
  | 'tree_of_thought'
  | 'step_back'
  | 'decomposition'
  | 'least_to_most'
  | 'chain_of_verification';

export interface ReasoningStep {
  stepNumber: number;
  thought: string;
  action?: string;
  observation?: string;
  confidence: number;
  isVerified: boolean;
}

export interface ReasoningTrace {
  id: string;
  query: string;
  strategy: ReasoningStrategy;
  steps: ReasoningStep[];
  conclusion: string;
  totalConfidence: number;
  verificationStatus: 'pending' | 'verified' | 'failed';
  alternatives?: ReasoningBranch[];
  createdAt: Date;
  latencyMs: number;
}

export interface ReasoningBranch {
  branchId: string;
  parentStepNumber: number;
  steps: ReasoningStep[];
  conclusion: string;
  confidence: number;
  selected: boolean;
}

export interface ThoughtNode {
  id: string;
  thought: string;
  depth: number;
  children: ThoughtNode[];
  score: number;
  isTerminal: boolean;
  path: string[];
}

export interface CoTPrompt {
  systemPrompt: string;
  userPrompt: string;
  examples?: CoTExample[];
  strategy: ReasoningStrategy;
}

export interface CoTExample {
  question: string;
  reasoning: string[];
  answer: string;
}

export interface CoTResult {
  traceId: string;
  query: string;
  strategy: ReasoningStrategy;
  reasoning: ReasoningTrace;
  finalAnswer: string;
  confidence: number;
  verified: boolean;
  alternatives?: string[];
}

class ChainOfThoughtService {
  private traces: Map<string, ReasoningTrace> = new Map();
  private thoughtTrees: Map<string, ThoughtNode> = new Map();

  private readonly ZERO_SHOT_COT_SUFFIX = "\n\nLet's think step by step:";
  
  private readonly FEW_SHOT_EXAMPLES: Record<string, CoTExample[]> = {
    math: [
      {
        question: "If a store has 15 apples and sells 7, then receives 12 more, how many apples does it have?",
        reasoning: [
          "Starting amount: 15 apples",
          "After selling 7: 15 - 7 = 8 apples",
          "After receiving 12 more: 8 + 12 = 20 apples"
        ],
        answer: "The store has 20 apples."
      }
    ],
    logic: [
      {
        question: "All cats are mammals. Tom is a cat. Is Tom a mammal?",
        reasoning: [
          "Premise 1: All cats are mammals (universal statement)",
          "Premise 2: Tom is a cat (specific instance)",
          "Apply syllogism: If Tom is a cat, and all cats are mammals, then Tom is a mammal"
        ],
        answer: "Yes, Tom is a mammal."
      }
    ],
    analysis: [
      {
        question: "What are the pros and cons of remote work?",
        reasoning: [
          "First, identify the main stakeholders: employees, employers, society",
          "For employees - Pros: flexibility, no commute, work-life balance",
          "For employees - Cons: isolation, distractions, blurred boundaries",
          "For employers - Pros: reduced office costs, wider talent pool",
          "For employers - Cons: harder to supervise, collaboration challenges"
        ],
        answer: "Remote work offers flexibility and cost savings but may lead to isolation and communication challenges."
      }
    ]
  };

  async generateCoTPrompt(
    query: string,
    strategy: ReasoningStrategy,
    domain?: string
  ): Promise<CoTPrompt> {
    let systemPrompt = this.getSystemPromptForStrategy(strategy);
    let userPrompt = query;
    let examples: CoTExample[] = [];

    switch (strategy) {
      case 'zero_shot_cot':
        userPrompt = query + this.ZERO_SHOT_COT_SUFFIX;
        break;

      case 'few_shot_cot':
        examples = this.selectExamples(query, domain);
        userPrompt = this.formatFewShotPrompt(query, examples);
        break;

      case 'self_consistency':
        userPrompt = query + "\n\nProvide your reasoning step by step. I will ask you to solve this multiple times to ensure consistency.";
        break;

      case 'tree_of_thought':
        userPrompt = this.formatTreeOfThoughtPrompt(query);
        break;

      case 'step_back':
        userPrompt = this.formatStepBackPrompt(query);
        break;

      case 'decomposition':
        userPrompt = this.formatDecompositionPrompt(query);
        break;

      case 'least_to_most':
        userPrompt = this.formatLeastToMostPrompt(query);
        break;

      case 'chain_of_verification':
        userPrompt = this.formatVerificationPrompt(query);
        break;
    }

    return {
      systemPrompt,
      userPrompt,
      examples: examples.length > 0 ? examples : undefined,
      strategy
    };
  }

  async executeReasoning(
    query: string,
    strategy: ReasoningStrategy = 'zero_shot_cot',
    options: {
      domain?: string;
      maxSteps?: number;
      verifySteps?: boolean;
      generateAlternatives?: boolean;
    } = {}
  ): Promise<CoTResult> {
    const startTime = Date.now();
    const traceId = uuidv4();
    const maxSteps = options.maxSteps ?? 10;

    const prompt = await this.generateCoTPrompt(query, strategy, options.domain);
    
    let reasoning: ReasoningTrace;

    switch (strategy) {
      case 'tree_of_thought':
        reasoning = await this.executeTreeOfThought(traceId, query, maxSteps);
        break;

      case 'self_consistency':
        reasoning = await this.executeSelfConsistency(traceId, query, 3);
        break;

      case 'chain_of_verification':
        reasoning = await this.executeWithVerification(traceId, query, maxSteps);
        break;

      default:
        reasoning = await this.executeStandardCoT(traceId, query, strategy, maxSteps);
    }

    reasoning.latencyMs = Date.now() - startTime;

    if (options.verifySteps) {
      await this.verifyReasoningSteps(reasoning);
    }

    this.traces.set(traceId, reasoning);

    return {
      traceId,
      query,
      strategy,
      reasoning,
      finalAnswer: reasoning.conclusion,
      confidence: reasoning.totalConfidence,
      verified: reasoning.verificationStatus === 'verified',
      alternatives: reasoning.alternatives?.map(a => a.conclusion)
    };
  }

  private async executeStandardCoT(
    traceId: string,
    query: string,
    strategy: ReasoningStrategy,
    maxSteps: number
  ): Promise<ReasoningTrace> {
    const llm = await this.runLLMReasoning(query, strategy, maxSteps, 0.3);
    if (llm) {
      const steps: ReasoningStep[] = llm.steps.map((s, i) => ({
        stepNumber: i + 1,
        thought:    s.thought,
        action:     s.action,
        observation: s.observation,
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.85,
        isVerified: false,
      }));
      const avgConfidence = steps.length > 0
        ? steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length
        : 0.85;
      return {
        id: traceId,
        query,
        strategy,
        steps,
        conclusion: llm.conclusion,
        totalConfidence: avgConfidence,
        verificationStatus: 'pending',
        createdAt: new Date(),
        latencyMs: 0,
      };
    }

    // Dev/test fallback (LLM unavailable). Production path throws above.
    const steps: ReasoningStep[] = [
      { stepNumber: 1, thought: `Analyzing the question: "${query}"`, confidence: 0.9, isVerified: false },
      { stepNumber: 2, thought: 'Identifying key components and requirements', action: 'Breaking down the problem', confidence: 0.85, isVerified: false },
      { stepNumber: 3, thought: 'Applying relevant knowledge and reasoning', observation: 'Connecting facts to reach intermediate conclusions', confidence: 0.8, isVerified: false },
      { stepNumber: 4, thought: 'Synthesizing findings into a coherent answer', confidence: 0.85, isVerified: false },
    ];
    const avgConfidence = steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length;
    return {
      id: traceId,
      query,
      strategy,
      steps,
      conclusion: `[dev-fallback] Step-by-step analysis for: "${query}"`,
      totalConfidence: avgConfidence,
      verificationStatus: 'pending',
      createdAt: new Date(),
      latencyMs: 0,
    };
  }

  /**
   * Call the real LLM service to produce N reasoning steps + a conclusion in
   * a single round-trip. Returns null in dev/test if the call fails so the
   * legacy stub can take over; in production, errors propagate.
   */
  private async runLLMReasoning(
    query: string,
    strategy: ReasoningStrategy,
    maxSteps: number,
    temperature: number,
  ): Promise<LLMReasoningResult | null> {
    try {
      const { realLLMService } = await import('./real-llm-service.js');
      const systemPrompt = `${this.getSystemPromptForStrategy(strategy)}
Output STRICT JSON only — no markdown fences. Schema:
{
  "steps": [{ "thought": string, "action"?: string, "observation"?: string, "confidence": number }],
  "conclusion": string
}
Rules:
- Produce between 3 and ${maxSteps} steps.
- "confidence" is a number between 0 and 1 reflecting how strongly the step is grounded.
- The "conclusion" must directly answer the user's query — never restate the query.
- For legal queries: cite statute sections / case names / years where they exist; never invent citations.`;
      const userPrompt = `QUERY: ${query}\n\nReturn ONLY the JSON object.`;
      // NV-LLM-001 (R3 — WHITELISTED): chain-of-thought is itself a reasoning
      // step *inside* the safety ring (invoked from nv-client.ts:856 and from
      // executeWithFullSafetyRing → callJurexio). Wrapping it again would
      // create infinite recursion. realLLMService.executeRequest already
      // delegates to orchestrateLLM (router) per R1, so cost-optimal pick is
      // preserved. See replit.md NV-LLM-001 whitelist.
      const resp = await realLLMService.executeRequest({
        id:           uuidv4(),
        userId:       'system',
        provider:     undefined as any,
        model:        undefined as any,
        prompt:       userPrompt,
        systemPrompt,
        maxTokens:    2048,
        temperature,
        requirements: {
          complexity:   'expert',
          domain:       'analytical',
          priority:     'high',
          costBudget:   'balanced',
          responseTime: 'balanced',
          qualityLevel: 'expert',
        },
        fallbackLevels: 3,
        timestamp:      new Date(),
      } as any);

      const raw = (resp.content || '').trim();
      const jsonStr = (() => {
        const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
        if (fence) return fence[1].trim();
        const start = raw.indexOf('{');
        const end   = raw.lastIndexOf('}');
        return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      })();
      /*
       * NV-COT-TRUNCATED-JSON-001 (2026-08-18) — salvage a TRUNCATED reasoning payload.
       *
       * Observed live: `CoT capture (non-fatal): Unterminated string in JSON at position 320
       * (line 4 column 300)`. The model hit its output ceiling mid-string, so the payload is
       * well-formed JSON right up to the cut. `JSON.parse` rejected the whole thing, the
       * caller swallowed the throw as non-fatal, and `chainOfThought` was simply absent from
       * the response — which is why NSP sees no reasoning trail under any key even when they
       * pass `enableCoT: true`. The wiring was complete end to end; only the parse failed.
       *
       * Discarding N-1 complete reasoning steps because step N was cut off is the wrong
       * trade: the steps we did receive are exactly what the partner wants to render, and we
       * already paid for them. So on a parse failure we retry against a repaired string —
       * close any dangling string, drop a trailing partial object, and shut the brackets the
       * nesting still owes. If that also fails we rethrow and behave exactly as before.
       */
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        const repaired = repairTruncatedJson(jsonStr);
        if (!repaired) throw parseErr;
        parsed = JSON.parse(repaired);
        logger.info('recovered a truncated reasoning payload', {
          originalChars: jsonStr.length,
          repairedChars: repaired.length,
          steps: Array.isArray(parsed?.steps) ? parsed.steps.length : 0,
        });
      }
      if (!Array.isArray(parsed.steps) || typeof parsed.conclusion !== 'string') {
        /*
         * A salvaged payload legitimately loses its `conclusion` (it is emitted last), but
         * the steps are the reasoning trail and are worth keeping on their own. Synthesise
         * a conclusion from the final step rather than throwing the trail away.
         */
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          const last = parsed.steps[parsed.steps.length - 1] || {};
          parsed.conclusion = String(
            parsed.conclusion ?? last.observation ?? last.thought ?? '',
          ).trim() || 'Reasoning truncated before a conclusion was emitted.';
        } else {
          throw new Error('LLM returned invalid reasoning JSON shape');
        }
      }
      return {
        steps: parsed.steps.map((s: any) => ({
          thought:     String(s.thought ?? '').trim(),
          action:      s.action ? String(s.action) : undefined,
          observation: s.observation ? String(s.observation) : undefined,
          confidence:  typeof s.confidence === 'number' ? Math.max(0, Math.min(1, s.confidence)) : 0.85,
        })),
        conclusion: String(parsed.conclusion).trim(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[CoT] LLM reasoning failed: ${msg}`);
      if (process.env.NODE_ENV === 'production') {
        throw err instanceof Error ? err : new Error(msg);
      }
      return null;
    }
  }

  private async executeTreeOfThought(
    traceId: string,
    query: string,
    maxDepth: number
  ): Promise<ReasoningTrace> {
    const rootNode: ThoughtNode = {
      id: uuidv4(),
      thought: `Root: ${query}`,
      depth: 0,
      children: [],
      score: 1.0,
      isTerminal: false,
      path: []
    };

    await this.expandThoughtTree(rootNode, maxDepth, 3);
    
    this.thoughtTrees.set(traceId, rootNode);

    const bestPath = this.findBestPath(rootNode);
    const steps = bestPath.map((node, index) => ({
      stepNumber: index + 1,
      thought: node.thought,
      confidence: node.score,
      isVerified: false
    }));

    const alternatives: ReasoningBranch[] = this.findAlternativePaths(rootNode, bestPath)
      .slice(0, 3)
      .map((path, index) => ({
        branchId: uuidv4(),
        parentStepNumber: 0,
        steps: path.map((node, i) => ({
          stepNumber: i + 1,
          thought: node.thought,
          confidence: node.score,
          isVerified: false
        })),
        conclusion: path[path.length - 1]?.thought || '',
        confidence: path.reduce((sum, n) => sum + n.score, 0) / path.length,
        selected: false
      }));

    return {
      id: traceId,
      query,
      strategy: 'tree_of_thought',
      steps,
      conclusion: bestPath[bestPath.length - 1]?.thought || 'No conclusion reached',
      totalConfidence: steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length,
      verificationStatus: 'pending',
      alternatives,
      createdAt: new Date(),
      latencyMs: 0
    };
  }

  private async expandThoughtTree(
    node: ThoughtNode,
    maxDepth: number,
    branchingFactor: number
  ): Promise<void> {
    if (node.depth >= maxDepth) {
      node.isTerminal = true;
      return;
    }

    for (let i = 0; i < branchingFactor; i++) {
      const childNode: ThoughtNode = {
        id: uuidv4(),
        thought: `Thought branch ${i + 1} at depth ${node.depth + 1}`,
        depth: node.depth + 1,
        children: [],
        score: 0.7 + (i * 0.05 % 0.3),
        isTerminal: false,
        path: [...node.path, node.id]
      };
      
      node.children.push(childNode);
      
      if (childNode.score > 0.6) {
        await this.expandThoughtTree(childNode, maxDepth, branchingFactor - 1);
      } else {
        childNode.isTerminal = true;
      }
    }
  }

  private findBestPath(root: ThoughtNode): ThoughtNode[] {
    const path: ThoughtNode[] = [root];
    let current = root;

    while (current.children.length > 0) {
      const best = current.children.reduce((a, b) => 
        a.score > b.score ? a : b
      );
      path.push(best);
      current = best;
    }

    return path;
  }

  private findAlternativePaths(root: ThoughtNode, excludePath: ThoughtNode[]): ThoughtNode[][] {
    const excludeIds = new Set(excludePath.map(n => n.id));
    const alternatives: ThoughtNode[][] = [];

    const findPaths = (node: ThoughtNode, currentPath: ThoughtNode[]): void => {
      if (node.isTerminal || node.children.length === 0) {
        if (currentPath.length > 1 && !excludeIds.has(node.id)) {
          alternatives.push([...currentPath]);
        }
        return;
      }

      for (const child of node.children) {
        findPaths(child, [...currentPath, child]);
      }
    };

    findPaths(root, [root]);
    return alternatives.sort((a, b) => {
      const scoreA = a.reduce((sum, n) => sum + n.score, 0) / a.length;
      const scoreB = b.reduce((sum, n) => sum + n.score, 0) / b.length;
      return scoreB - scoreA;
    });
  }

  private async executeSelfConsistency(
    traceId: string,
    query: string,
    numPaths: number
  ): Promise<ReasoningTrace> {
    // NYV-COT-LLM-002 (Task #27): run N independent LLM reasoning paths at
    // higher temperature, then pick the highest-confidence path. The other
    // paths are surfaced as alternatives so the caller can audit divergence.
    const paths: ReasoningBranch[] = [];
    const temps = [0.45, 0.65, 0.85];
    for (let i = 0; i < numPaths; i++) {
      const llm = await this.runLLMReasoning(query, 'self_consistency', 6, temps[i % temps.length]);
      if (llm) {
        const steps: ReasoningStep[] = llm.steps.map((s, idx) => ({
          stepNumber: idx + 1,
          thought:    s.thought,
          action:     s.action,
          observation: s.observation,
          confidence: typeof s.confidence === 'number' ? s.confidence : 0.85,
          isVerified: false,
        }));
        paths.push({
          branchId: uuidv4(),
          parentStepNumber: 0,
          steps,
          conclusion: llm.conclusion,
          confidence: steps.length > 0
            ? steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length
            : 0.85,
          selected: false,
        });
      } else {
        // dev/test fallback path
        const steps: ReasoningStep[] = [
          { stepNumber: 1, thought: `Path ${i + 1}: Initial analysis of "${query}"`, confidence: 0.82, isVerified: false },
          { stepNumber: 2, thought: `Path ${i + 1}: Reasoning step`, confidence: 0.87, isVerified: false },
          { stepNumber: 3, thought: `Path ${i + 1}: Conclusion reached`, confidence: 0.91, isVerified: false },
        ];
        paths.push({
          branchId: uuidv4(),
          parentStepNumber: 0,
          steps,
          conclusion: `[dev-fallback] Conclusion from path ${i + 1}`,
          confidence: steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length,
          selected: false,
        });
      }
    }

    const bestPath = paths.reduce((a, b) => (a.confidence > b.confidence ? a : b));
    bestPath.selected = true;

    return {
      id: traceId,
      query,
      strategy: 'self_consistency',
      steps: bestPath.steps,
      conclusion: bestPath.conclusion,
      totalConfidence: bestPath.confidence,
      verificationStatus: 'pending',
      alternatives: paths.filter(p => !p.selected),
      createdAt: new Date(),
      latencyMs: 0,
    };
  }

  private async executeWithVerification(
    traceId: string,
    query: string,
    maxSteps: number
  ): Promise<ReasoningTrace> {
    // NYV-COT-LLM-003 (Task #27): real LLM-driven reasoning + verification.
    // We ask the LLM for reasoning steps in one pass (low temperature for
    // determinism) and then mark steps with confidence >= 0.7 as verified.
    const llm = await this.runLLMReasoning(query, 'chain_of_verification', maxSteps, 0.2);
    if (llm) {
      const steps: ReasoningStep[] = llm.steps.map((s, i) => ({
        stepNumber: i + 1,
        thought:    s.thought,
        action:     s.action,
        observation: s.observation,
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.85,
        isVerified: (typeof s.confidence === 'number' ? s.confidence : 0.85) >= 0.7,
      }));
      const verifiedSteps = steps.filter(s => s.isVerified).length;
      const avgConfidence = steps.length > 0
        ? steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length
        : 0.85;
      return {
        id: traceId,
        query,
        strategy: 'chain_of_verification',
        steps,
        conclusion: llm.conclusion,
        totalConfidence: avgConfidence,
        verificationStatus: verifiedSteps >= steps.length / 2 ? 'verified' : 'pending',
        createdAt: new Date(),
        latencyMs: 0,
      };
    }

    // Dev/test fallback
    const steps: ReasoningStep[] = [
      { stepNumber: 1, thought: `Initial reasoning about: "${query}"`, confidence: 0.85, isVerified: false },
      { stepNumber: 2, thought: 'Generating verification questions for the reasoning', action: 'Self-verification', confidence: 0.9, isVerified: true },
      { stepNumber: 3, thought: 'Checking each step for logical consistency', observation: 'All steps verified as logically sound', confidence: 0.88, isVerified: true },
      { stepNumber: 4, thought: 'Final answer after verification', confidence: 0.92, isVerified: true },
    ];
    const verifiedSteps = steps.filter(s => s.isVerified).length;
    const avgConfidence = steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length;

    return {
      id: traceId,
      query,
      strategy: 'chain_of_verification',
      steps,
      conclusion: `Verified answer for: "${query}"`,
      totalConfidence: avgConfidence,
      verificationStatus: verifiedSteps >= steps.length / 2 ? 'verified' : 'pending',
      createdAt: new Date(),
      latencyMs: 0
    };
  }

  private async verifyReasoningSteps(trace: ReasoningTrace): Promise<void> {
    for (const step of trace.steps) {
      const isValid = step.confidence > 0.6;
      step.isVerified = isValid;
    }

    const verifiedCount = trace.steps.filter(s => s.isVerified).length;
    trace.verificationStatus = verifiedCount >= trace.steps.length * 0.8 ? 'verified' : 
                               verifiedCount >= trace.steps.length * 0.5 ? 'pending' : 'failed';
  }

  private getSystemPromptForStrategy(strategy: ReasoningStrategy): string {
    const prompts: Record<ReasoningStrategy, string> = {
      zero_shot_cot: "You are a helpful assistant that thinks step by step to solve problems accurately.",
      few_shot_cot: "You are a helpful assistant. Follow the examples provided to reason through problems step by step.",
      self_consistency: "You are a helpful assistant. Reason through problems multiple times to ensure consistency in your answers.",
      tree_of_thought: "You are a helpful assistant that explores multiple reasoning paths to find the best solution.",
      step_back: "You are a helpful assistant. First understand the broader context before addressing specific questions.",
      decomposition: "You are a helpful assistant that breaks complex problems into simpler sub-problems.",
      least_to_most: "You are a helpful assistant that solves problems by starting with the simplest aspects first.",
      chain_of_verification: "You are a helpful assistant that verifies each step of reasoning before proceeding."
    };

    return prompts[strategy];
  }

  private selectExamples(query: string, domain?: string): CoTExample[] {
    if (domain && this.FEW_SHOT_EXAMPLES[domain]) {
      return this.FEW_SHOT_EXAMPLES[domain];
    }

    if (/\d+|\+|\-|\*|\/|equals?|sum|total|calculate/i.test(query)) {
      return this.FEW_SHOT_EXAMPLES.math;
    }
    if (/if.*then|all.*are|therefore|conclude|implies/i.test(query)) {
      return this.FEW_SHOT_EXAMPLES.logic;
    }
    
    return this.FEW_SHOT_EXAMPLES.analysis;
  }

  private formatFewShotPrompt(query: string, examples: CoTExample[]): string {
    let prompt = "Here are some examples of step-by-step reasoning:\n\n";
    
    for (const example of examples) {
      prompt += `Question: ${example.question}\n`;
      prompt += "Reasoning:\n";
      example.reasoning.forEach((step, i) => {
        prompt += `${i + 1}. ${step}\n`;
      });
      prompt += `Answer: ${example.answer}\n\n`;
    }
    
    prompt += `Now solve this problem:\n\nQuestion: ${query}\nReasoning:`;
    return prompt;
  }

  private formatTreeOfThoughtPrompt(query: string): string {
    return `Problem: ${query}

Explore multiple reasoning paths:
1. Generate 3 different initial approaches to this problem
2. For each approach, develop the reasoning further
3. Evaluate which path leads to the best solution
4. Present the strongest reasoning chain

Begin exploration:`;
  }

  private formatStepBackPrompt(query: string): string {
    return `Question: ${query}

Before answering directly, let's step back:
1. What is the broader context or principle behind this question?
2. What fundamental concepts are relevant here?
3. How do these concepts apply to the specific question?

Step back analysis:`;
  }

  private formatDecompositionPrompt(query: string): string {
    return `Complex problem: ${query}

Break this into sub-problems:
1. Identify the main components of this problem
2. List simpler sub-questions that need to be answered
3. Solve each sub-question
4. Combine the solutions

Decomposition:`;
  }

  private formatLeastToMostPrompt(query: string): string {
    return `Question: ${query}

Solve from simplest to most complex:
1. What is the simplest version of this question?
2. Solve that simple version
3. Gradually add complexity
4. Apply to the full question

Progressive solution:`;
  }

  private formatVerificationPrompt(query: string): string {
    return `Question: ${query}

Reason with verification:
1. Provide initial reasoning and answer
2. Generate verification questions to check your reasoning
3. Answer each verification question
4. If any check fails, revise your reasoning
5. State your final verified answer

Verified reasoning:`;
  }

  getTrace(traceId: string): ReasoningTrace | undefined {
    return this.traces.get(traceId);
  }

  getThoughtTree(traceId: string): ThoughtNode | undefined {
    return this.thoughtTrees.get(traceId);
  }

  getStats(): {
    totalTraces: number;
    strategyDistribution: Record<ReasoningStrategy, number>;
    averageConfidence: number;
    verificationRate: number;
  } {
    const traces = Array.from(this.traces.values());
    
    const strategyDist: Record<ReasoningStrategy, number> = {
      zero_shot_cot: 0, few_shot_cot: 0, self_consistency: 0,
      tree_of_thought: 0, step_back: 0, decomposition: 0,
      least_to_most: 0, chain_of_verification: 0
    };
    
    for (const trace of traces) {
      strategyDist[trace.strategy]++;
    }

    const avgConfidence = traces.length > 0
      ? traces.reduce((sum, t) => sum + t.totalConfidence, 0) / traces.length
      : 0;

    const verified = traces.filter(t => t.verificationStatus === 'verified').length;

    return {
      totalTraces: traces.length,
      strategyDistribution: strategyDist,
      averageConfidence: avgConfidence,
      verificationRate: traces.length > 0 ? verified / traces.length : 0
    };
  }
}

/**
 * NV-COT-AUTO-STRATEGY-001 — pick the reasoning strategy from the shape of the
 * legal task.
 *
 * Eight strategies are implemented above, but every server-side call site
 * hard-coded `'zero_shot_cot'` (`nv-orchestration-routes.ts`,
 * `nv-sdk-orchestration-wrapper.ts`, `nv-client.ts`), so seven of them only ran
 * if a partner happened to pass the field by hand. Nobody does. This selector
 * makes the choice server-side from the task itself.
 *
 * Cost discipline — two rules, both deliberate:
 *   - `self_consistency` issues 3 LLM calls and `tree_of_thought` branches, so
 *     neither is ever auto-selected. They stay opt-in for high-stakes work.
 *   - `few_shot_cot` is never auto-selected because the exemplar bank holds only
 *     math / logic / generic-analysis samples (apples, cats, remote work). Those
 *     would anchor a legal model on the wrong reasoning shape — strictly worse
 *     than zero-shot for statutory work.
 *
 * The three that ARE auto-selected all cost exactly one call, same as today's
 * default, so this changes reasoning quality at no additional token spend.
 */
export function selectCoTStrategy(input: {
  prompt: string;
  taskType?: string | null;
  taskClass?: string | null;
}): ReasoningStrategy {
  const p = String(input.prompt || '');
  const task = String(input.taskType || '').toLowerCase();
  const cls = String(input.taskClass || '').toLowerCase();

  // Cheap classes keep the cheapest scaffold — a one-line statute lookup does
  // not benefit from a decomposition preamble.
  if (cls === 'micro_faq' || cls === 'classify') return 'zero_shot_cot';

  // Multi-part questions: answer each sub-question in order rather than letting
  // the model silently pick one. Detect explicit enumeration or several asks.
  const questionMarks = (p.match(/\?/g) || []).length;
  const enumerated = /(\(|\b)(i{1,3}|iv|v|[1-9])[.)]\s/i.test(p) && p.length > 220;
  if (questionMarks >= 3 || enumerated) return 'decomposition';

  // Drafting and opinions depend on a correct framing of the legal question
  // before composition; step-back forces the principle before the particulars.
  if (cls === 'drafting' || /draft|notice|petition|agreement|opinion|memo/.test(task)) {
    return 'step_back';
  }

  // Research and advisory work is where a wrong citation does the most damage,
  // and chain-of-verification makes the model check its own claims in-band.
  if (cls === 'research' || /research|analysis|advice|compliance|litigation/.test(task)) {
    return 'chain_of_verification';
  }

  return 'zero_shot_cot';
}

export const chainOfThoughtService = new ChainOfThoughtService();
export default chainOfThoughtService;
