/**
 * NV-MEM-BUDGET-001 — the single place memory becomes prompt text.
 *
 * `memoryCharCap` has existed in `jrx-context-budgets.ts` since NV-CTX-BUDGET-001
 * but the specialist path interpolated raw node content, so the injected block
 * ran 4–8× over the declared budget on every request. A budget that is declared
 * in one file and ignored at the interpolation site is not a budget; this module
 * makes the cap a contract enforced where the characters are actually spent.
 *
 * Two properties matter for a legal prompt:
 *  - Whole items are dropped by relevance rather than the block being sliced.
 *    Slicing mid-sentence can truncate "Section 318(4)" to "Section 318(",
 *    which fabricates a citation — strictly worse than omitting the memory.
 *  - The cap is per item AND for the block, so N items cannot each sit at the
 *    cap and collectively blow the request budget.
 *
 * Used by both the specialist path (`jrx-client`) and Queen Step-0 so there is
 * exactly one assembler (NV-NO-DUPLICATE-001).
 */
import type { MemoryNode } from './graph-memory-service.js';

export interface MemoryInjectionBudget {
  /** Per-item character ceiling from `ContextBudgets.memoryCharCap`. */
  memoryCharCap: number;
  /** Max items to render. Defaults to `ContextBudgets.memorySlice`. */
  maxItems?: number;
  /**
   * Ceiling for the whole rendered block. Defaults to
   * `memoryCharCap × maxItems`, which is what keeps per-item caps from summing
   * into an unbounded block.
   */
  blockCharCap?: number;
}

export interface MemoryInjectionResult {
  /** Prompt-ready block, or '' when nothing fits. */
  block: string;
  itemsRendered: number;
  itemsDropped: number;
  charsRendered: number;
  /** Characters the un-capped interpolation would have emitted. */
  charsBeforeCap: number;
}

/** §0 L3 — platform-authenticated memory; safe to restate when the user asks. */
const MEMORY_BLOCK_HEADER = '[L3 — Platform Memory (authenticated session; user-provided facts may be restated on request)]';
const GRAPH_BLOCK_HEADER = '[Legal Concept Relationships — GraphRAG]';

/**
 * Trim to `maxChars` on a sentence boundary, else a word boundary. Never cuts
 * inside a token — see the citation-fabrication note above.
 */
export function clipToBudget(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;

  const slice = normalized.slice(0, maxChars);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('; '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
  );
  if (sentenceEnd > maxChars * 0.5) return slice.slice(0, sentenceEnd + 1).trim();

  const wordEnd = slice.lastIndexOf(' ');
  if (wordEnd > maxChars * 0.5) return `${slice.slice(0, wordEnd).trim()}…`;
  return `${slice.trim()}…`;
}

function resolveCaps(budget: MemoryInjectionBudget): { perItem: number; maxItems: number; block: number } {
  const perItem = Math.max(0, Math.floor(budget.memoryCharCap));
  const maxItems = Math.max(0, Math.floor(budget.maxItems ?? 5));
  const block = Math.max(0, Math.floor(budget.blockCharCap ?? perItem * Math.max(1, maxItems)));
  return { perItem, maxItems, block };
}

/**
 * Render recalled memory nodes under the caller's character budget.
 *
 * Nodes are expected in descending relevance order (that is what `recall()`
 * returns). Items are admitted greedily so the highest-relevance memory always
 * survives, and a node that cannot fit whole is dropped rather than sliced.
 */
export function buildMemoryInjectionBlock(
  nodes: Array<Pick<MemoryNode, 'type' | 'content'>>,
  budget: MemoryInjectionBudget,
  scope?: { matterId?: string; orgId?: string },
): MemoryInjectionResult {
  const itemLabel = (type: string) => scope?.matterId
    ? `[L3 matter_id=${scope.matterId}${scope.orgId ? ` org_id=${scope.orgId}` : ''} ${type}] `
    : `[L3 Platform Memory (${type})] `;
  const charsBeforeCap = nodes.reduce(
    (sum, n) => sum + itemLabel(n.type) + n.content.length + 1,
    0,
  );
  const { perItem, maxItems, block } = resolveCaps(budget);

  if (nodes.length === 0 || perItem === 0 || maxItems === 0 || block === 0) {
    return { block: '', itemsRendered: 0, itemsDropped: nodes.length, charsRendered: 0, charsBeforeCap };
  }

  const lines: string[] = [];
  let used = MEMORY_BLOCK_HEADER.length + 1;
  let rendered = 0;

  for (const node of nodes) {
    if (rendered >= maxItems) break;
    const label = itemLabel(node.type);
    const contentBudget = Math.min(perItem, block - used - label.length - 1);
    if (contentBudget <= 0) break;

    const clipped = clipToBudget(node.content, contentBudget);
    // A clip that leaves only an ellipsis carries no recall value; skip it
    // rather than spending characters on a stub.
    if (clipped.replace(/…$/, '').trim().length < 12) continue;

    const line = `${label}${clipped}`;
    lines.push(line);
    used += line.length + 1;
    rendered++;
  }

  if (lines.length === 0) {
    return { block: '', itemsRendered: 0, itemsDropped: nodes.length, charsRendered: 0, charsBeforeCap };
  }

  const blockText = `${MEMORY_BLOCK_HEADER}\n${lines.join('\n')}`;
  return {
    block: blockText,
    itemsRendered: rendered,
    itemsDropped: nodes.length - rendered,
    charsRendered: blockText.length,
    charsBeforeCap,
  };
}

/**
 * Render GraphRAG chains under the same budget discipline. Chains are already
 * short, so the cap here mainly bounds how many are admitted.
 */
export function buildGraphInjectionBlock(
  chains: string[],
  budget: MemoryInjectionBudget,
): MemoryInjectionResult {
  const charsBeforeCap = chains.reduce((sum, c) => sum + c.length + 1, 0);
  const { perItem, maxItems, block } = resolveCaps(budget);

  if (chains.length === 0 || perItem === 0 || maxItems === 0 || block === 0) {
    return { block: '', itemsRendered: 0, itemsDropped: chains.length, charsRendered: 0, charsBeforeCap };
  }

  const lines: string[] = [];
  let used = GRAPH_BLOCK_HEADER.length + 1;

  for (const chain of chains) {
    if (lines.length >= maxItems) break;
    const contentBudget = Math.min(perItem, block - used - 1);
    if (contentBudget <= 0) break;
    // Relationship arrows must survive intact for the chain to mean anything,
    // so a chain that does not fit whole is dropped.
    if (chain.length > contentBudget) continue;
    lines.push(chain);
    used += chain.length + 1;
  }

  if (lines.length === 0) {
    return { block: '', itemsRendered: 0, itemsDropped: chains.length, charsRendered: 0, charsBeforeCap };
  }

  const blockText = `${GRAPH_BLOCK_HEADER}\n${lines.join('\n')}`;
  return {
    block: blockText,
    itemsRendered: lines.length,
    itemsDropped: chains.length - lines.length,
    charsRendered: blockText.length,
    charsBeforeCap,
  };
}

const CODEWORD_STORE_PATTERNS = [
  /(?:remember\s+(?:this\s+)?codeword\s+exactly:\s*|remember\s+codeword\s+|codeword:\s*)([A-Za-z0-9][A-Za-z0-9_-]{3,})/i,
  /(MEMORY-PROBE-[A-Za-z0-9_-]+)/,
  /(mem-probe-[A-Za-z0-9_-]+)/i,
];

/**
 * NV-MEM-DIRECT-RECALL-001 — when L3 already holds the answer and the user asks
 * for a verbatim restatement (partner codeword probe), serve from memory without
 * an LLM call. Frontier models often refuse codeword replay as a credential trick
 * even when §0 L3 marks the fact as gateway-authenticated.
 */
export function extractDirectMemoryRecall(
  prompt: string,
  nodes: Array<Pick<MemoryNode, 'content'>>,
): string | null {
  if (!/\b(codeword|reply with.*codeword|that codeword only|platform memory)\b/i.test(prompt)) {
    return null;
  }
  for (const node of nodes) {
    const content = String(node.content ?? '');
    for (const pattern of CODEWORD_STORE_PATTERNS) {
      const match = content.match(pattern);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}
