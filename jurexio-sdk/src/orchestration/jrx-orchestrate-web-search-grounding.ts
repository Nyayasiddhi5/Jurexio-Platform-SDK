/**
 * NV-WEB-SEARCH-STREAM-PARITY-001 — shared live SERP grounding for sync + stream orchestrate.
 */
import { queryNeedsLiveWebData } from '../utils/jrx-platform-temporal-context.js';

export interface OrchestrateWebSearchMeta {
  provider?: string;
  resultCount?: number;
  attemptedProviders?: string[];
  error?: string;
}

export interface WebSearchGroundingInput {
  body: Record<string, unknown> | undefined;
  taskType?: string;
  groundedPrompt: string;
  rawPrompt?: string;
  primaryCapabilityIds?: string[];
}

export function resolveOrchestrateWantsWebSearch(input: WebSearchGroundingInput): boolean {
  const toolsRaw = input.body?.tools;
  const toolsList = Array.isArray(toolsRaw)
    ? toolsRaw.map((t) => String(t).toLowerCase())
    : typeof toolsRaw === 'string'
      ? [toolsRaw.toLowerCase()]
      : [];
  const taskType = String(input.taskType || '');
  const promptForHeuristics = String(input.rawPrompt || input.groundedPrompt || '');
  const caps = input.primaryCapabilityIds ?? [];
  return (
    toolsList.some((t) => /web[-_]?search|legal[-_]?database|serp|tavily/.test(t))
    || /^(web[_-]?search|trending|market[_-]?intel|legal[_-]?research|case[_-]?search)/i.test(taskType)
    || caps.includes('enterprise.web-search')
    || queryNeedsLiveWebData(promptForHeuristics)
    || /\b(leading\s+(?:Supreme\s+Court\s+)?authorit|cite\s+the\s+cases|reporter\s+citation|presumption\s+under\s+section)\b/i.test(
      promptForHeuristics,
    )
    || /\b(latest\s+(case|judgment|judgement|order|amendment|news|notification)|recent\s+(case|judgment|judgement|order|ruling|legislation)|legal\s+news|case\s+search|full\s+details|template|checklist|counsel\s+draft)\b/i.test(
      promptForHeuristics,
    )
  );
}

export async function applyOrchestrateWebSearchGrounding(
  groundedPrompt: string,
  logContext: { requestId?: string; runId?: string; route: 'sync' | 'stream' },
): Promise<{ prompt: string; meta?: OrchestrateWebSearchMeta }> {
  try {
    const { realWebSearchService } = await import('../services/enterprise-platform/real-web-search-service.js');
    const web = await realWebSearchService.search(String(groundedPrompt).slice(0, 500), {
      limit: 5,
      searchDepth: 'basic',
    });
    const lines = (web.results || []).map(
      (r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${String(r.snippet || '').slice(0, 280)}`,
    );
    const answer = web.answer ? `\nGrounded summary:\n${String(web.answer).slice(0, 1200)}\n` : '';
    const prompt =
      `${groundedPrompt}\n\n--- LIVE WEB SEARCH (${web.provider}, do not invent case titles) ---\n` +
      `${answer}${lines.join('\n')}\n--- END WEB SEARCH ---\n` +
      'Synthesize a concise answer citing only the sources above. When citing Indian cases, include a reporter citation in standard format — e.g. (2013) 2 SCC 641, AIR 2013 SC 2456, or 2013 SCC OnLine SC 123 — alongside the case name. If sources are thin or lack reporter cites, say so honestly rather than inventing citations.';
    const meta: OrchestrateWebSearchMeta = {
      provider: web.provider,
      resultCount: web.results?.length || 0,
      attemptedProviders: web.attemptedProviders,
    };
    return { prompt, meta };
  } catch (webErr: unknown) {
    const msg = webErr instanceof Error ? webErr.message : String(webErr);
    const prompt =
      `${groundedPrompt}\n\n[WEB SEARCH UNAVAILABLE: ${msg.slice(0, 160)}. ` +
      'Do NOT invent case titles, URLs, or reporter citations. State that live web search is unavailable.]';
    return {
      prompt,
      meta: { error: msg.slice(0, 200) },
    };
  }
}
