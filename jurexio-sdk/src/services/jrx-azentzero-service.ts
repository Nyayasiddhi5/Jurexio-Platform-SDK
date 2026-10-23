/**
 * Azentzero Sovereign LLM/LRM Service — Jurexio Enterprise Platform 3.1.2
 * JRX-SVC-AZENTZERO-001
 *
 * Role: FINAL BACKUP LLM + BACKUP LRM for the Jurexio platform.
 *   - Engaged ONLY when all 19 upstream providers (OpenRouter, OpenAI, Anthropic, Google,
 *     xAI, Perplexity, KIMI-K2, DeepSeek, Groq, Together AI, Replicate, Cohere, Mistral,
 *     ElevenLabs, Meta, Sarvam, OpenManus, AgentZero, Relative AI) are unavailable.
 *   - Self-hosted sovereign endpoint — PII can remain un-redacted (no external data egress).
 *   - LRM fallback: replaces NS-LRM when primary SLM chain is exhausted.
 *
 * Env vars:
 *   JRX_AZENTZERO_API_KEY      — Bearer token for Azentzero endpoint
 *   JRX_AZENTZERO_BASE_URL     — e.g. https://azentzero.jurexio.com/v1
 *   JRX_AZENTZERO_TIMEOUT_MS   — Per-request timeout in ms (default: 60000)
 *   JRX_AZENTZERO_MAX_RETRIES  — Max retry attempts (default: 3)
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { secureRandom } from '../utils/jrx-secure-random.js';

const logger = createLogger('./jrx-azentzero');

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface AzentzeroMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AzentzeroRequest {
  model?: string;
  messages: AzentzeroMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  jurisdiction?: string;
  template_mode?: 'STRICT' | 'GUIDED' | 'MENTOR';
  metadata?: Record<string, unknown>;
}

export interface AzentzeroResponse {
  id: string;
  model: string;
  content: string;
  tokens: { input: number; output: number; total: number };
  latencyMs: number;
  provider: 'azentzero';
  fallbackLevel: 20;
  sovereign: true;
  jurisdiction?: string;
}

export interface AzentzeroHealth {
  status: 'healthy' | 'degraded' | 'offline' | 'unconfigured';
  endpoint: string;
  responseTimeMs: number;
  lastChecked: string;
  available: boolean;
  errorMessage?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Supported Models
// ────────────────────────────────────────────────────────────────────────────

export const AZENTZERO_MODELS = Object.freeze([
  'azentzero-legal-v1',        // Primary — India legal domain, BNS/BNSS/BSA specialised
  'azentzero-legal-v2',        // Next-gen — multi-jurisdiction, 200K context
  'azentzero-reasoning-v1',    // Reasoning model — multi-step chain-of-thought
  'azentzero-draft-v1',        // Document drafting — contracts, pleadings, opinions
  'azentzero-compliance-v1',   // Compliance — DPDPA, GDPR, ISO 27001 mapping
  'azentzero-multilingual-v1', // 47-language support — 22 Indian + 25 global
  'azentzero-fast-v1',         // Ultra-low latency (< 500 ms P95)
]);

export const DEFAULT_AZENTZERO_MODEL = 'azentzero-legal-v1';

// ────────────────────────────────────────────────────────────────────────────
// Service Class
// ────────────────────────────────────────────────────────────────────────────

class AzentzeroService extends EventEmitter {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  private health: AzentzeroHealth;
  private requestCount = 0;
  private successCount = 0;
  private totalLatencyMs = 0;

  constructor() {
    super();
    this.apiKey = process.env.JRX_AZENTZERO_API_KEY ?? null;
    this.baseUrl = (process.env.JRX_AZENTZERO_BASE_URL ?? 'https://azentzero.jurexio.com/v1').replace(/\/$/, '');
    this.timeoutMs = Number(process.env.JRX_AZENTZERO_TIMEOUT_MS ?? '60000');
    this.maxRetries = Number(process.env.JRX_AZENTZERO_MAX_RETRIES ?? '3');

    this.health = {
      status: this.apiKey ? 'healthy' : 'unconfigured',
      endpoint: this.baseUrl,
      responseTimeMs: 0,
      lastChecked: new Date().toISOString(),
      available: Boolean(this.apiKey),
    };

    if (this.apiKey) {
      logger.info('[Azentzero] ✅ Sovereign LLM/LRM service initialized as final backup provider', {
        baseUrl: this.baseUrl,
        models: AZENTZERO_MODELS.length,
        timeoutMs: this.timeoutMs,
      });
    } else {
      logger.warn('[Azentzero] ⚠️ JRX_AZENTZERO_API_KEY not set — Azentzero backup LLM inactive. Set this env var to enable sovereign final fallback.');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  get isAvailable(): boolean {
    return Boolean(this.apiKey) && this.health.status !== 'offline';
  }

  get providerConfig() {
    return {
      id: 'azentzero',
      name: 'Azentzero Sovereign LLM',
      models: [...AZENTZERO_MODELS],
      cost: 'sovereign',
      capabilities: ['text', 'reasoning', 'legal', 'multilingual', 'compliance', 'drafting'],
      maxTokens: 200000,
      priority: 20,
      sovereign: true,
      piiSafe: true,
      description: 'Final backup LLM/LRM — sovereign self-hosted, no external data egress',
    };
  }

  /**
   * Execute a completion request against Azentzero.
   * Retries with exponential backoff up to maxRetries times.
   */
  async complete(req: AzentzeroRequest): Promise<AzentzeroResponse> {
    if (!this.apiKey) {
      logger.warn('[Azentzero] JRX_AZENTZERO_API_KEY not configured — returning schema-valid mock AzentzeroResponse');
      const id = `aztz_mock_${Date.now()}`;
      const response: AzentzeroResponse = {
        id,
        model: req.model ?? DEFAULT_AZENTZERO_MODEL,
        content: '[JRX Sovereign Fallback] Azentzero is not configured. Set JRX_AZENTZERO_API_KEY to enable the sovereign final backup.',
        tokens: { input: 0, output: 0, total: 0 },
        latencyMs: 0,
        provider: 'azentzero',
        fallbackLevel: 20,
        sovereign: true,
        jurisdiction: req.jurisdiction,
      };
      return response;
    }

    const model = req.model ?? DEFAULT_AZENTZERO_MODEL;
    const requestId = `aztz_${Date.now()}_${(secureRandom() * 100000).toFixed(0)}`;
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        const result = await this._doRequest(requestId, model, req);
        const latency = Date.now() - attemptStart;

        this.requestCount++;
        this.successCount++;
        this.totalLatencyMs += latency;

        this._updateHealth('healthy', latency);
        this.emit('completion', { requestId, model, latencyMs: latency, attempt });

        logger.info('[Azentzero] ✅ Completion successful', {
          requestId,
          model,
          latencyMs: latency,
          attempt,
          tokens: result.tokens,
        });

        return result;
      } catch (err: any) {
        lastError = err as Error;
        const waitMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);

        logger.warn(`[Azentzero] Attempt ${attempt}/${this.maxRetries} failed — retrying in ${waitMs}ms`, {
          requestId,
          error: lastError.message,
        });

        if (attempt < this.maxRetries) {
          await this._sleep(waitMs);
        }
      }
    }

    this.requestCount++;
    this._updateHealth('degraded', 0, lastError.message);
    this.emit('error', { requestId, model, error: lastError.message });

    throw new Error(`[Azentzero] All ${this.maxRetries} attempts failed. Last error: ${lastError.message}`);
  }

  /**
   * LRM routing via Azentzero — used when NS-LRM chain is exhausted.
   * Returns the jurisdiction-bound SLM routing decision.
   */
  async routeLRM(query: string, jurisdiction: string): Promise<{
    jurisdiction: string;
    model: string;
    rationale: string;
    confidence: number;
  }> {
    const response = await this.complete({
      model: 'azentzero-reasoning-v1',
      messages: [
        {
          role: 'system',
          content: `You are the Azentzero Legal Routing Model (LRM) — the final sovereign backup for Jurexio jurisdiction detection.
Your task: analyse the legal query and return a JSON routing decision.
Supported jurisdictions: IN (India), UK (United Kingdom), GC (GCC/Gulf), EU (European Union), US (United States), SG (Singapore).
Respond ONLY with valid JSON: { "jurisdiction": "<code>", "model": "azentzero-legal-v1", "rationale": "<brief>", "confidence": <0-1> }`,
        },
        { role: 'user', content: `Jurisdiction hint: ${jurisdiction}\n\nQuery: ${query}` },
      ],
      max_tokens: 256,
      temperature: 0.1,
      jurisdiction,
      template_mode: 'STRICT',
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          jurisdiction: parsed.jurisdiction ?? jurisdiction,
          model: parsed.model ?? 'azentzero-legal-v1',
          rationale: parsed.rationale ?? 'Azentzero sovereign LRM routing',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
        };
      }
    } catch {
      // JSON parse failed — return safe default
    }

    return {
      jurisdiction,
      model: 'azentzero-legal-v1',
      rationale: 'Azentzero sovereign LRM — fallback routing (JSON parse failed)',
      confidence: 0.75,
    };
  }

  /**
   * Health check — probes the Azentzero endpoint.
   */
  async checkHealth(): Promise<AzentzeroHealth> {
    if (!this.apiKey) {
      this.health = {
        status: 'unconfigured',
        endpoint: this.baseUrl,
        responseTimeMs: 0,
        lastChecked: new Date().toISOString(),
        available: false,
        errorMessage: 'JRX_AZENTZERO_API_KEY not set',
      };
      return this.health;
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'X-JRX-Platform': '3.1.2' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latency = Date.now() - start;

      if (res.ok) {
        this._updateHealth('healthy', latency);
      } else {
        this._updateHealth('degraded', latency, `HTTP ${res.status}`);
      }
    } catch (err: any) {
      this._updateHealth('degraded', Date.now() - start, (err as Error).message);
    }

    return this.health;
  }

  getStats() {
    return {
      requestCount: this.requestCount,
      successCount: this.successCount,
      successRate: this.requestCount > 0 ? this.successCount / this.requestCount : 1,
      averageLatencyMs: this.requestCount > 0 ? Math.round(this.totalLatencyMs / this.successCount || 0) : 0,
      health: this.health,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async _doRequest(
    requestId: string,
    model: string,
    req: AzentzeroRequest,
  ): Promise<AzentzeroResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model,
      messages: req.messages,
      max_tokens: req.max_tokens ?? 4096,
      temperature: req.temperature ?? 0.3,
      stream: false,
      metadata: {
        ...(req.metadata ?? {}),
        platform: 'jurexio-3.1.2',
        request_id: requestId,
        jurisdiction: req.jurisdiction,
        template_mode: req.template_mode ?? 'STRICT',
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey!}`,
          'X-Request-ID': requestId,
          'X-JRX-Platform': '3.1.2',
          'X-JRX-Sovereign': 'true',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok === false) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Azentzero API error: HTTP ${res.status} — ${errText}`);
    }

    const data = await res.json() as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    return {
      id: data.id ?? requestId,
      model: data.model ?? model,
      content,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      latencyMs: 0,
      provider: 'azentzero',
      fallbackLevel: 20,
      sovereign: true,
      jurisdiction: req.jurisdiction,
    };
  }

  private _updateHealth(
    status: AzentzeroHealth['status'],
    latencyMs: number,
    errorMessage?: string,
  ): void {
    this.health = {
      status,
      endpoint: this.baseUrl,
      responseTimeMs: latencyMs,
      lastChecked: new Date().toISOString(),
      available: status === 'healthy' || status === 'degraded',
      ...(errorMessage ? { errorMessage } : {}),
    };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Singleton Export
// ────────────────────────────────────────────────────────────────────────────

export const azentzeroService = new AzentzeroService();
export default azentzeroService;
