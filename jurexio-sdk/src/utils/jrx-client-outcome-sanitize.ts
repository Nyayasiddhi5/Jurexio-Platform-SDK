/**
 * NV-CLIENT-OUTCOME-SANITIZE-001 — Never expose orchestration internals
 * (Queen/swarm/agents/timeouts/retrieval policy) to frontend platforms.
 *
 * Client-facing payloads must carry the legal **outcome** only.
 * Diagnostics stay in server logs / optional admin flag.
 */
import { createLogger } from './logger.js';

const logger = createLogger('./jrx-client-outcome-sanitize');

/** When true, allow executions / pattern / failed-branch diagnostics in API JSON. */
export function isOrchestrationDiagnosticsExposed(): boolean {
  const v = String(process.env.JRX_EXPOSE_ORCHESTRATION_DIAGNOSTICS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

const ORCH_HEADER_RE =
  /^#\s*Orchestrated Response\b[\s\S]*?(?=^---\s*$|^##\s|^```|\*\*[A-Z]|\n\n)/im;

const FAILED_BRANCHES_RE =
  /\n*-{3,}\s*\n+\s*##?\s*[⚠️⚠]?\s*Failed Branches[\s\S]*$/i;

const FAILED_BRANCHES_INLINE_RE =
  /\n+##?\s*[⚠️⚠]?\s*Failed Branches\s*\(\d+\)[\s\S]*$/i;

const META_LINE_RE =
  /^\*\*(Request|Pattern|Agents Used|Algorithm|Orchestration|Queen|Swarm)\*\*\s*:.*$/gim;

const RETRIEVAL_POLICY_LEAK_RE =
  /§\s*RETRIEVAL POLICY[\s\S]{0,800}?(?=\n\n|\*\*Pattern\*\*|\*\*Agents Used\*\*|```|$)/i;

/** Model/provider thinking blocks that must never reach partner `content`. */
const THINKING_XML_BLOCK_RE = /<thinking\b[\s\S]*?<\/thinking>/gi;
const REDACTED_REASONING_BLOCK_RE =
  /<\|(?:redacted_)?reasoning\|>[\s\S]*?(?:<\|\/(?:redacted_)?reasoning\|>|(?:redacted_)?reasoning\|>)/gi;

/** Common CoT preamble lines the model sometimes emits before the legal answer. */
const THINKING_PREAMBLE_LINE_RE =
  /^\s*(?:let me think(?: about this)?|i(?:'ll| will) think(?: through this)?|thinking(?: aloud)?:)\s*[^\n]*\n+/gim;

/**
 * Unwrap agent envelope JSON → plain legal outcome text.
 * Handles `{ output: "..." }` / `{ content: "..." }` / `{ answer: "..." }`.
 */
export function unwrapAgentOutcomeEnvelope(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';

  // Fenced JSON
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  const candidate = fence ? fence[1].trim() : text;

  if (!(candidate.startsWith('{') && candidate.endsWith('}'))) return text;

  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return text;

    const looksLikeAgentEnvelope =
      'agentId' in obj
      || 'agentName' in obj
      || 'patternUsed' in obj
      || 'auditId' in obj
      || 'grpoSignals' in obj
      || 'matterId' in obj
      || 'hitlRequired' in obj;

    const pick =
      (typeof obj.output === 'string' && obj.output.trim())
      || (typeof obj.content === 'string' && obj.content.trim())
      || (typeof obj.answer === 'string' && obj.answer.trim())
      || (typeof obj.result === 'string' && obj.result.trim())
      || '';

    if (looksLikeAgentEnvelope && pick) return pick;
    if (pick && (looksLikeAgentEnvelope || Object.keys(obj).length >= 4)) return pick;
  } catch {
    /* keep raw */
  }
  return text;
}

/**
 * If content embeds a fenced agent JSON envelope, prefer its `output` field.
 */
function extractEmbeddedAgentOutcome(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    const unwrapped = unwrapAgentOutcomeEnvelope(fenceMatch[1].trim());
    if (unwrapped && unwrapped !== fenceMatch[1].trim()) return unwrapped;
    // Even without full unwrap heuristics, prefer .output from parseable JSON
    try {
      const obj = JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
      if (typeof obj?.output === 'string' && obj.output.trim()) return obj.output.trim();
    } catch { /* ignore */ }
  }

  // Bare JSON object with agentId somewhere in the blob
  const brace = text.indexOf('{');
  if (brace >= 0 && text.includes('"agentId"') && text.includes('"output"')) {
    const candidate = text.slice(brace).trim();
    // Try progressively shorter suffixes if trailing chrome after JSON
    for (const end of [candidate.length, candidate.lastIndexOf('}') + 1].filter((n) => n > 2)) {
      try {
        const obj = JSON.parse(candidate.slice(0, end)) as Record<string, unknown>;
        if (typeof obj?.output === 'string' && obj.output.trim()) return obj.output.trim();
      } catch { /* try next */ }
    }
  }
  return null;
}

/**
 * Strip orchestration chrome from a content string. Idempotent.
 */
export function sanitizeOrchestrationContentForClient(content: unknown): string {
  let text = String(content ?? '');
  if (!text.trim()) return '';

  // Prefer embedded agent outcome before stripping chrome (legacy leak format)
  const embedded = extractEmbeddedAgentOutcome(text);
  if (embedded) {
    text = embedded;
  } else {
    text = unwrapAgentOutcomeEnvelope(text);
  }

  // Drop model thinking / CoT blocks before orchestration chrome
  text = text.replace(THINKING_XML_BLOCK_RE, '');
  text = text.replace(REDACTED_REASONING_BLOCK_RE, '');
  text = text.replace(THINKING_PREAMBLE_LINE_RE, '');

  // Drop full Orchestrated Response preamble (Request/Pattern/Agents/Algorithm)
  text = text.replace(ORCH_HEADER_RE, '');
  text = text.replace(/^#\s*Orchestrated Response\s*\n+/im, '');
  text = text.replace(META_LINE_RE, '');
  text = text.replace(RETRIEVAL_POLICY_LEAK_RE, '');
  text = text.replace(FAILED_BRANCHES_RE, '');
  text = text.replace(FAILED_BRANCHES_INLINE_RE, '');

  // Residual swarm / queen failure lines
  text = text.replace(
    /^\s*[·•\-]\s*\*\*?swarm-agent-[^*]*\*\*?.*$/gim,
    '',
  );
  text = text.replace(
    /^\s*[·•\-]\s*\*\*?.*Queen Orchestration Engine.*$/gim,
    '',
  );
  text = text.replace(
    /Error:\s*policy:\s*per-node timeout after \d+ms/gi,
    '',
  );

  // Collapse excess blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  // If after stripping we only have junk JSON leftovers, try unwrap again
  if (text.startsWith('{') && text.includes('"agentId"')) {
    text = unwrapAgentOutcomeEnvelope(text);
  }

  return text;
}

const CLIENT_BLOCKED_KEYS = new Set([
  'executions',
  'taskDecomposition',
  'failedBranches',
  'failed_branches',
  'decomposition',
  'subtasks',
  'queenTrace',
  'agentTrace',
  'grpoSignals',
  'patternUsed',
  'orchestrationTrace',
  'swarm',
  'swarmAgents',
  /** NV-COT-PARTNER-STRIP-001 — internal reasoning; partners render `content` only. */
  'chainOfThought',
  'explainability',
  /** SDK safety-ring wrapper — duplicates `cost` / trust fields with CoT inside. */
  'orchestration',
]);

/**
 * Remove orchestration diagnostic fields from an API data object.
 * Preserves content/curated/citations/cost (cost keeps model name only).
 */
export function sanitizeOrchestrationPayloadForClient<T extends Record<string, unknown>>(
  data: T,
): T {
  if (!data || typeof data !== 'object') return data;
  if (isOrchestrationDiagnosticsExposed()) return data;

  const out: Record<string, unknown> = { ...data };

  if (typeof out.content === 'string') {
    out.content = sanitizeOrchestrationContentForClient(out.content);
  }

  if (out.curated && typeof out.curated === 'object') {
    const curated = { ...(out.curated as Record<string, unknown>) };
    if (typeof curated.summary === 'string') {
      curated.summary = sanitizeOrchestrationContentForClient(curated.summary);
    }
    if (Array.isArray(curated.sections)) {
      curated.sections = curated.sections.map((s: any) => ({
        ...s,
        body: typeof s?.body === 'string' ? sanitizeOrchestrationContentForClient(s.body) : s?.body,
        title: typeof s?.title === 'string' && /orchestrated response/i.test(s.title)
          ? 'Answer'
          : s?.title,
      }));
    }
    out.curated = curated;
  }

  for (const k of CLIENT_BLOCKED_KEYS) {
    delete out[k];
  }

  // Soften routing / depth — keep path label only, drop internal reason strings
  if (out.routing && typeof out.routing === 'object') {
    const r = { ...(out.routing as Record<string, unknown>) };
    if (typeof r.reason === 'string') {
      r.reason = 'processed';
    }
    delete r.primaryCapabilityIds;
    out.routing = r;
  }

  delete out.orchestrationPattern;
  delete out.agentsUsed;
  delete out.autoOrchestrated;
  delete out.osDepth;
  delete out.orchestrationMode;
  delete out.totalTokens;
  delete out.contextEngineering;
  delete out.queenCotApplied;
  delete out.queenCotCaptureFailed;
  delete out.queenCotCaptureError;
  delete out.verbalizedConfidence;
  /* NV-COMPLETION-DRIVEN-001 — `queenCotSkippedProgression` names an internal
   * stage, so it is stripped like the other CoT internals above. Its
   * partner-safe projection is `optionalDegraded`, which says "an optional
   * enrichment was dropped" without naming which engine did it.
   *
   * `requestPhase` and `optionalDegraded` are deliberately NOT deleted: they are
   * the only supported way for a partner to tell "still working" from "failed",
   * and stripping them is what forced NSP to infer failure from an HTTP abort. */
  delete out.queenCotSkippedProgression;

  // Soften safetyVerdict — keep pass/fail only for partners
  if (out.safetyVerdict && typeof out.safetyVerdict === 'object') {
    const sv = out.safetyVerdict as Record<string, unknown>;
    out.safetyVerdict = {
      passed: sv.passed !== false && sv.ok !== false,
      level: sv.level || sv.severity || undefined,
    };
  }

  // Always keep partner trust fields if present (never strip)
  // riskBadge / auditHash / trust / qualityEnvelope / citations / grounding stay.

  // Provider label for partners — generic, not "queen-orchestrator"
  if (typeof out.provider === 'string' && /queen|swarm|orchestrat/i.test(out.provider)) {
    out.provider = 'jurexio';
  }
  if (out.cost && typeof out.cost === 'object') {
    const c = { ...(out.cost as Record<string, unknown>) };
    if (typeof c.provider === 'string' && /queen|swarm|orchestrat/i.test(c.provider)) {
      c.provider = 'jurexio';
    }
    if (typeof c.path === 'string' && /queen|swarm/i.test(c.path)) {
      c.path = 'legal-ai';
    }
    out.cost = c;
  }

  return out as T;
}

/** Client-safe error when orchestration / Queen / swarm fails. */
export function sanitizeOrchestrationErrorForClient(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();

  if (
    /timeout|timed out|per-node timeout|etimedout|abort/i.test(lower)
  ) {
    return 'The request took too long to complete. Please retry.';
  }
  if (
    /queen|swarm|orchestrat|agent execution|failed branches|decomposition|maker.?checker|policy:/i.test(
      lower,
    )
  ) {
    return 'Unable to complete this legal request right now. Please retry.';
  }
  if (/rate.?limit|429|quota|capacity/i.test(lower)) {
    return 'Service is busy. Please retry shortly.';
  }

  // Fall through to generic — never echo raw orchestration stacks
  if (raw.length > 120 || /Error:|at\s+\w+|node_modules/i.test(raw)) {
    return 'Unable to complete this legal request right now. Please retry.';
  }
  return 'Unable to complete this legal request right now. Please retry.';
}

export function logOrchestrationFailureInternal(
  context: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  logger.warn(`[ORCH-INTERNAL] ${context}`, { err: msg.slice(0, 400), ...meta });
}
