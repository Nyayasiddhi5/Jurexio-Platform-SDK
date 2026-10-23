/**
 * NYS model-call adapter — NV-LLM-001 cutover hook.
 *
 * When NYV_MODEL_CALL_URL (+ optional NYV_MODEL_CALL_API_KEY) is set, generative
 * paths (agent draft / AI judge / chat) POST to Nyayavigya's safety-ring
 * completions instead of calling Anthropic/Bedrock directly.
 *
 * When unset, callers keep the existing integrations-anthropic-ai client
 * (dev / standalone NYS mode).
 */
import { logger } from "./logger";

export type NyvModelMessage = { role: "system" | "user" | "assistant"; content: string };

export interface NyvModelCallResult {
  content: string;
  model?: string;
  provider?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export function nyvModelCallConfigured(): boolean {
  return Boolean((process.env.NYV_MODEL_CALL_URL ?? "").trim());
}

/**
 * Invoke Nyayavigya intelligent-router / orchestrate-style completion.
 * Expected URL shapes (operator-configured):
 *   https://api.nyayasiddhi.online/api/nv/completions
 *   or an internal east-west shim that accepts { messages, maxTokens }.
 */
export async function callNyvModel(opts: {
  messages: NyvModelMessage[];
  maxTokens?: number;
  jurisdiction?: string;
  taskType?: string;
}): Promise<NyvModelCallResult | null> {
  const url = (process.env.NYV_MODEL_CALL_URL ?? "").trim();
  if (!url) return null;

  const apiKey = (process.env.NYV_MODEL_CALL_API_KEY ?? process.env.NYS_KNOWLEDGE_API_KEY ?? "").trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 4096,
        jurisdiction: opts.jurisdiction ?? "IN",
        taskType: opts.taskType ?? "legal-work",
        // Hint for NYV routes that support safety-ring wrappers
        enableRAG: false,
      }),
      signal: AbortSignal.timeout(Number(process.env.NYV_MODEL_CALL_TIMEOUT_MS ?? "120000")),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text: text.slice(0, 200) }, "NYV model call failed");
      return null;
    }
    const data = (await res.json()) as any;
    const content =
      data?.content ??
      data?.choices?.[0]?.message?.content ??
      data?.data?.content ??
      data?.result?.content ??
      "";
    if (!content) return null;
    return {
      content: String(content),
      model: data?.model,
      provider: data?.provider ?? "nyayavigya",
      usage: data?.usage,
    };
  } catch (err) {
    logger.warn({ err }, "NYV model call error");
    return null;
  }
}
