/**
 * Jurexio CitizenClient — typed wrapper around the Jurexio gateway for the 3
 * NYM-specific agents:
 *   - mitra-conversational
 *   - clause-classifier
 *   - case-brief-generator
 *
 * Delegates HTTP/auth/retries to `@jurexio/client-sdk`'s `JrxClient.agents.run()`
 * — we don't re-implement transport here.
 */

import { JrxClient, JrxError } from '@jurexio/client-sdk';
import type {
  CaseBriefIntake,
  CaseBriefResponse,
  ClauseClassifyRequest,
  ClauseClassifyResponse,
  MitraChatRequest,
  MitraChatResponse,
  Jurexio CitizenClientConfig,
  Jurexio CitizenLanguage,
} from './types.js';

const NYM_AGENT_IDS = {
  conversational: 'mitra-conversational',
  classifier:     'clause-classifier',
  caseBrief:      'case-brief-generator',
} as const;

/** Loose JSON object — agent outputs are validated structurally below, never trusted by shape. */
type JsonObj = Record<string, unknown>;

function isObj(v: unknown): v is JsonObj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export class Jurexio CitizenClient {
  static readonly VERSION = '5.1.2';

  private readonly nyv: JrxClient;
  private readonly defaultLanguage: Jurexio CitizenLanguage;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: Jurexio CitizenClientConfig) {
    if (!config?.apiKey) {
      throw new Error('Jurexio CitizenClient: apiKey is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://api.jurexio.example').replace(/\/$/, '');
    this.timeoutMs = config.timeout ?? 120_000;
    this.nyv = new JrxClient({
      apiKey: config.apiKey,
      baseUrl: this.baseUrl,
      timeout: this.timeoutMs,
      defaultJurisdiction: 'IN',
      defaultPlatform: 'jurexio-citizen',
    });
    this.defaultLanguage = config.defaultLanguage ?? 'hi';
  }

  /** Underlying JrxClient — exposed for advanced use (custom agents, knowledge, etc). */
  get inner(): JrxClient { return this.nyv; }

  /* ── 1. mitra-conversational ───────────────────────────────────────── */

  async chat(req: MitraChatRequest): Promise<MitraChatResponse> {
    if (!req?.message?.trim()) throw new Error('chat: message is required');
    if (!req?.sessionId)        throw new Error('chat: sessionId is required');

    const language = req.language ?? this.defaultLanguage;
    const raw = await this.exec(NYM_AGENT_IDS.conversational, {
      message: req.message,
      language,
      sessionId: req.sessionId,
      history: (req.history ?? []).slice(-20),
      intake: req.intake ?? {},
      options: req.options ?? {},
    });

    return {
      content: extractString(raw, ['content', 'reply', 'message', 'output']) ?? '',
      followUps: extractStringArray(raw, ['followUps', 'follow_ups', 'suggestions']),
      escalation: extractEscalation(raw),
      traceId: extractString(raw, ['traceId', 'trace_id']),
      modelUsed: extractString(raw, ['modelUsed', 'model']),
      language,
    };
  }

  /* ── 2. clause-classifier ──────────────────────────────────────────── */

  async classifyClauses(req: ClauseClassifyRequest): Promise<ClauseClassifyResponse> {
    if (!req?.documentText?.trim()) throw new Error('classifyClauses: documentText is required');
    const language = req.language ?? this.defaultLanguage;

    const raw = await this.exec(NYM_AGENT_IDS.classifier, {
      documentText: req.documentText,
      documentType: req.documentType ?? 'other',
      language,
    });

    const o = isObj(raw) ? raw : {};
    const clausesIn: unknown[] = Array.isArray(o.clauses) ? o.clauses : [];
    const clauses = clausesIn.filter(isObj).map((c) => ({
      text:        String(c.text ?? ''),
      label:       String(c.label ?? c.type ?? 'Unclassified'),
      risk:        normalizeRisk(c.risk ?? c.riskLevel ?? 'low'),
      explanation: String(c.explanation ?? c.summary ?? ''),
      citations:   Array.isArray(c.citations) ? (c.citations as unknown[]).map(String) : undefined,
    }));

    return {
      clauses,
      overallRisk: normalizeRisk(o.overallRisk ?? worstRisk(clauses)),
      summary: extractString(raw, ['summary']) ?? '',
      traceId: extractString(raw, ['traceId', 'trace_id']),
    };
  }

  /* ── 3. case-brief-generator ───────────────────────────────────────── */

  async generateCaseBrief(intake: CaseBriefIntake): Promise<CaseBriefResponse> {
    if (!intake?.narrative?.trim()) throw new Error('generateCaseBrief: narrative is required');
    const language = intake.language ?? this.defaultLanguage;

    const raw = await this.exec(NYM_AGENT_IDS.caseBrief, {
      narrative: intake.narrative,
      facts: intake.facts ?? [],
      documentIds: intake.documentIds ?? [],
      language,
    });

    const o = isObj(raw) ? raw : {};

    const lawsIn: unknown[] = Array.isArray(o.applicableLaws) ? o.applicableLaws : [];
    const applicableLaws = lawsIn.filter(isObj).map((l) => ({
      name: String(l.name ?? ''),
      section: l.section != null ? String(l.section) : undefined,
      rationale: String(l.rationale ?? l.reason ?? ''),
    }));

    const stepsIn: unknown[] = Array.isArray(o.nextSteps) ? o.nextSteps : [];
    const nextSteps = stepsIn.filter(isObj).map((s) => ({
      action: String(s.action ?? s.title ?? ''),
      detail: String(s.detail ?? s.description ?? ''),
      dueDate: typeof s.dueDate === 'string' ? s.dueDate : null,
    }));

    return {
      summary: extractString(raw, ['summary']) ?? '',
      applicableLaws,
      nextSteps,
      recommendedLawyerType:
        typeof o.recommendedLawyerType === 'string' ? o.recommendedLawyerType : null,
      estimatedCostBandInr: normalizeCostBand(o.estimatedCostBandInr),
      language,
      traceId: extractString(raw, ['traceId', 'trace_id']),
    };
  }

  /* ── 4. Patra Mitra (document parse + ask) ─────────────────────────── */

  /**
   * Upload a document (base64) or plain text → OCR/parse + fields + summary.
   * JRX: POST /api/jrx/v1/sdk/patra-mitra/sessions
   */
  async openPatraMitra(req: {
    base64?: string;
    content?: string;
    fileName?: string;
    mimeType?: string;
    jurisdiction?: string;
  }): Promise<Record<string, unknown>> {
    if (!req?.base64 && !req?.content) {
      throw new Error('openPatraMitra: base64 or content is required');
    }
    return this.patraRequest('POST', '/api/jrx/v1/sdk/patra-mitra/sessions', {
      base64: req.base64,
      content: req.content,
      fileName: req.fileName,
      mimeType: req.mimeType,
      jurisdiction: req.jurisdiction ?? 'IN',
    });
  }

  /** Ask a question grounded in an open Patra Mitra session. */
  async askPatraMitra(sessionId: string, message: string, jurisdiction = 'IN'): Promise<{
    answer: string;
    session: Record<string, unknown>;
  }> {
    if (!sessionId) throw new Error('askPatraMitra: sessionId is required');
    if (!message?.trim()) throw new Error('askPatraMitra: message is required');
    return this.patraRequest(
      'POST',
      `/api/jrx/v1/sdk/patra-mitra/sessions/${encodeURIComponent(sessionId)}/chat`,
      { message, jurisdiction },
    ) as Promise<{ answer: string; session: Record<string, unknown> }>;
  }

  private async patraRequest(method: string, path: string, body?: unknown): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
          'X-JRX-Platform': 'nym',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        throw new JrxError({
          code: 'PATRA_MITRA_ERROR',
          message: json?.error || json?.message || `HTTP ${res.status}`,
          status: res.status,
        });
      }
      return json?.data !== undefined ? json.data : json;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── transport helper ──────────────────────────────────────────────── */

  /**
   * Calls the gateway's agent-execution endpoint via the public AgentsApi
   * `run({ agentId, task, context })` surface. The NYM payload becomes the
   * `context` envelope; the user-facing string (message / narrative / doc
   * text) becomes the `task` so it shows up correctly in audit logs.
   *
   * Returns either:
   *   - the agent's typed `output` (if the execution completed inline), or
   *   - the full execution object (so the caller can poll if needed).
   */
  private async exec(agentId: string, payload: Record<string, unknown>): Promise<unknown> {
    try {
      const task = pickTaskString(payload, agentId);
      const exec = await this.nyv.agents.run({
        agentId,
        task,
        jurisdiction: 'IN',
        context: payload,
      });
      // Prefer the structured `output` slot if present, otherwise return the
      // whole execution envelope and let the per-method normalizer extract.
      const out = isObj(exec) ? (exec as JsonObj).output : undefined;
      return isObj(out) ? out : exec;
    } catch (e) {
      if (e instanceof JrxError) throw e;
      throw new Error(`Jurexio CitizenClient.${agentId} failed: ${(e as Error)?.message ?? e}`);
    }
  }
}

/* ── tiny extractors used by the response normalizers ────────────────── */

function extractString(raw: unknown, keys: string[]): string | undefined {
  if (!isObj(raw)) return undefined;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function extractStringArray(raw: unknown, keys: string[]): string[] | undefined {
  if (!isObj(raw)) return undefined;
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v) && v.every((x): x is string => typeof x === 'string')) return v;
  }
  return undefined;
}

type EscalationKind = 'safety' | 'lawyer-required' | 'human-required';
const ESCALATION_KINDS: readonly EscalationKind[] = ['safety', 'lawyer-required', 'human-required'];
function isEscalationKind(v: unknown): v is EscalationKind {
  return typeof v === 'string' && (ESCALATION_KINDS as readonly string[]).includes(v);
}

function extractEscalation(raw: unknown): MitraChatResponse['escalation'] {
  if (!isObj(raw)) return null;
  const e = raw.escalation;
  if (!e) return null;
  if (typeof e === 'string') return { kind: 'human-required', reason: e };
  if (isObj(e) && isEscalationKind(e.kind) && typeof e.reason === 'string') {
    return { kind: e.kind, reason: e.reason };
  }
  return null;
}

type CostBand = '0-1000' | '1000-10000' | '10000-50000' | '50000+';
const COST_BANDS: readonly CostBand[] = ['0-1000', '1000-10000', '10000-50000', '50000+'];
function normalizeCostBand(v: unknown): CostBand | undefined {
  return typeof v === 'string' && (COST_BANDS as readonly string[]).includes(v)
    ? (v as CostBand)
    : undefined;
}

function normalizeRisk(v: unknown): 'low' | 'medium' | 'high' | 'critical' {
  const s = String(v ?? 'low').toLowerCase();
  if (s.startsWith('crit')) return 'critical';
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med'))  return 'medium';
  return 'low';
}

function worstRisk(clauses: { risk: 'low' | 'medium' | 'high' | 'critical' }[]): 'low' | 'medium' | 'high' | 'critical' {
  const order = { low: 0, medium: 1, high: 2, critical: 3 } as const;
  let worst: 'low' | 'medium' | 'high' | 'critical' = 'low';
  for (const c of clauses) if (order[c.risk] > order[worst]) worst = c.risk;
  return worst;
}

/**
 * Each NYM agent has a different "user-visible task" field. Pick the right
 * one so it shows up correctly in the gateway's audit log + dashboards.
 */
function pickTaskString(payload: Record<string, unknown>, agentId: string): string {
  if (agentId === 'mitra-conversational') return String(payload.message ?? '');
  if (agentId === 'clause-classifier') {
    const t = String(payload.documentText ?? '');
    return t.length > 240 ? `${t.slice(0, 240)}…` : t;
  }
  if (agentId === 'case-brief-generator') return String(payload.narrative ?? '');
  return JSON.stringify(payload).slice(0, 240);
}
